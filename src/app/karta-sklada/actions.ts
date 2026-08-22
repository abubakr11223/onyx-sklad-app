"use server";

// ТЗ №6 — редактирование сетки склада (блоки + ориентиры). ТОЛЬКО Владелец
// (getRealSessionUser, как /accounts — defense-in-depth). Удаление блока — только
// если он пустой (нет камня: BatchLocation по букве блока). Все правки → редирект
// обратно в режим редактирования с ok/err.
import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { isLatinBlockCode, normalizeBlockLetter } from "@/lib/block-letter";
import { MAX_DECIMAL_12_3, parseBoundedDecimal } from "@/lib/decimal";
import { requireWarehouseMapEditor } from "@/lib/session";

const BACK = "/karta-sklada?edit=1";

/**
 * ТЗ №18 §9.1 — код назначения при переименовании уже занят.
 *
 * Отдельный класс, а не Prisma-ошибка: занять код может не только строка сетки
 * (её ловит @unique → P2002), но и ОДИН ТОЛЬКО КАМЕНЬ — блок, заведённый
 * приёмкой, живёт как BatchLocation/Slab/Piece без строки WarehouseBlock.
 * Переименование в такой код проходило молча и сливало два блока в один:
 * количество камня сходилось, а информация о том, где он лежал, исчезала без
 * следа — адрес уже не восстановить. Объединение блоков — это отдельное
 * осознанное решение, а не побочный эффект опечатки в поле «буква».
 */
class BlockCodeTakenError extends Error {}

// Аудит ТЗ №7 #13 — общий gate из lib/session.ts (был локальный дубль).
// ТЗ №17 §6 — карту правит владелец ИЛИ зав. складом (canEditWarehouseMap).
// ТЗ №17 §7 — возвращаем actorId: изменения карты пишутся в Историю (кто, что).
async function requireMapEditor(): Promise<string> {
  return requireWarehouseMapEditor(`${BACK}&err=denied`);
}

/**
 * ТЗ №17 §7 — изменения карты попадают в Историю. Отдельный помощник, чтобы
 * каждое действие писало запись одинаковой формы: entityType «WarehouseBlock»,
 * payload.kind = KARTA_* — по нему История отличает складские правки от
 * товарных ADJUSTMENT'ов.
 */
async function logKarta(
  actorId: string,
  entityId: string,
  kind: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.auditLog.create({
    data: {
      userId: actorId,
      action: "ADJUSTMENT",
      entityType: "WarehouseBlock",
      entityId,
      payload: { kind, ...payload },
    },
  });
}

/**
 * Варианты написания кода блока: нормализованный + исходный. Аудит ТЗ №7 #16 —
 * legacy-строки в BatchLocation могли быть записаны ДО ввода нормализации; их
 * фактическое значение и есть ключ поиска. Дедуп через Set: если нормализация —
 * no-op, список из одного кода.
 */
function letterVariants(rawLetter: string): string[] {
  return [
    ...new Set([rawLetter, normalizeBlockLetter(rawLetter)].filter(Boolean)),
  ];
}

/**
 * Есть ли камень в блоке — для защиты удаления.
 *
 * ТЗ №17 §7: раньше проверялся ТОЛЬКО BatchLocation. Но плита (Slab) и кусок
 * (Piece) хранят СВОЮ локацию — после разбития/переноса плита может лежать в
 * блоке, где партийной локации уже нет. Такой блок считался «пустым» и удалялся
 * вместе с ориентирами, а плита оставалась с адресом на несуществующий блок.
 * Теперь проверяем все три источника.
 */
async function blockHasStone(rawLetter: string): Promise<boolean> {
  const where = { block: { in: letterVariants(rawLetter) } };
  const [locs, slabs, pieces] = await Promise.all([
    db.batchLocation.count({ where }),
    db.slab.count({ where }),
    db.piece.count({ where }),
  ]);
  return locs + slabs + pieces > 0;
}

/**
 * Есть ли камень на конкретном ориентире блока — защита удаления ориентира
 * (ТЗ №17 §7). Раньше removeLandmark удалял безусловно: флажок исчезал, а
 * камень оставался с адресом «Блок A1 · ориентир 5», которого нет в справочнике.
 */
async function landmarkHasStone(
  rawLetter: string,
  number: string,
): Promise<boolean> {
  const where = { block: { in: letterVariants(rawLetter) }, landmark: number };
  const [locs, slabs, pieces] = await Promise.all([
    db.batchLocation.count({ where }),
    db.slab.count({ where }),
    db.piece.count({ where }),
  ]);
  return locs + slabs + pieces > 0;
}

/**
 * ТЗ №7 §4 — «материализация» авто-блока. Блоки, появившиеся из приёмки
 * (BatchLocation по букве, без строки WarehouseBlock), должны редактироваться
 * так же, как ручные. При первой правке создаём для буквы строку WarehouseBlock
 * и переносим существующие ориентиры из BatchLocation, затем возвращаем её id.
 * Если строка уже есть (ручной блок или уже материализованный) — просто её id.
 *
 * Аудит ТЗ №7 #16: нормализуем букву — если fromLetter пришёл ненормализованным
 * (curl / legacy), в сетке сохраняется каноническая форма (кириллица, верхний
 * регистр). Ориентиры собираем из BatchLocation по обеим формам, чтобы не
 * потерять legacy-строки, а материализуемый блок называем нормализованным.
 */
/**
 * Собирает уникальные ориентиры этой буквы из BatchLocation по ОБЕИМ формам
 * (нормализованная + сырая) — legacy-строки не теряются. Пустые обрезаются.
 * Общий помощник для materializeBlock и addBlock (ТЗ №7 #18).
 */
async function collectLandmarksFromLocations(
  letter: string,
  rawLetter: string,
): Promise<string[]> {
  const variants = [...new Set([letter, rawLetter].filter(Boolean))];
  const locs = await db.batchLocation.findMany({
    where: { block: { in: variants } },
    select: { landmark: true },
  });
  return [
    ...new Set(locs.map((l) => l.landmark.trim()).filter((s) => s !== "")),
  ];
}

async function materializeBlock(rawLetter: string): Promise<string> {
  const letter = normalizeBlockLetter(rawLetter) || rawLetter;
  const existing = await db.warehouseBlock.findUnique({
    where: { letter },
    select: { id: true },
  });
  if (existing) return existing.id;

  const numbers = await collectLandmarksFromLocations(letter, rawLetter);
  const max = await db.warehouseBlock.aggregate({ _max: { sortOrder: true } });

  // Аудит ТЗ №7 #17 — раньше пара findUnique→create была неатомарной: два
  // параллельных первых-редактирования одного и того же авто-блока (две вкладки
  // владельца / двойной submit) оба видели existing=null, оба шли в create, и
  // второй словил бы P2002 (@unique letter). Unhandled Prisma-error → 500.
  // Данных не портит (unique держит), но UX не должен показывать 500 на редком
  // double-submit. Ловим P2002 и повторно читаем — победитель уже создал строку,
  // берём её id (никогда не создаём дубль).
  try {
    const created = await db.warehouseBlock.create({
      data: {
        letter,
        sortOrder: (max._max.sortOrder ?? 0) + 1,
        landmarks: { create: numbers.map((number) => ({ number })) },
      },
      select: { id: true },
    });
    return created.id;
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      const winner = await db.warehouseBlock.findUnique({
        where: { letter },
        select: { id: true },
      });
      if (winner) return winner.id;
    }
    throw e;
  }
}

/**
 * id блока для правки: либо явный blockId (ручной/сетевой блок), либо буква
 * авто-блока (fromLetter) — тогда материализуем его в сетку (см. выше).
 */
async function resolveBlockId(formData: FormData): Promise<string> {
  const id = String(formData.get("blockId") ?? "");
  if (id) return id;
  const fromLetter = String(formData.get("fromLetter") ?? "").trim();
  if (!fromLetter) redirect(`${BACK}&err=notfound`);
  return materializeBlock(fromLetter);
}

export async function addBlock(formData: FormData): Promise<void> {
  const actorId = await requireMapEditor();
  // ТЗ №7 §2 (BUG-01) — единый алфавит/регистр (кир/лат дубли).
  const letter = normalizeBlockLetter(String(formData.get("letter") ?? ""));
  if (!letter) redirect(`${BACK}&err=letter`);
  // ТЗ №17 §3.1 — новые коды только латиницей (как на бумажном плане).
  if (!isLatinBlockCode(letter)) redirect(`${BACK}&err=letter_not_latin`);
  // Аудит ТЗ №7 #7 — единый bounded-парсер вместо parseFloat без верхней границы:
  // ввод типа 99999999999 больше не даёт Prisma numeric-overflow → 500, а
  // корректно возвращает ?err=area (allowZero: площадь блока может быть 0).
  const areaRes = parseBoundedDecimal(String(formData.get("areaM2") ?? ""), {
    max: MAX_DECIMAL_12_3,
    allowZero: true,
  });
  if (!areaRes.ok) redirect(`${BACK}&err=area`);
  const areaM2 = areaRes.value;
  try {
    // Аудит ТЗ №7 #18 — если владелец руками добавляет ту же букву, что уже есть
    // как авто-блок из приёмки, сеть должна унаследовать его ориентиры (иначе
    // datalist предложит новую «Д» с ZERO orientирами, хотя физически камень
    // лежит на «1»/«2»). Общий сборщик с materializeBlock — единая семантика.
    const rawLetter = String(formData.get("letter") ?? "").trim();
    const numbers = await collectLandmarksFromLocations(letter, rawLetter);
    const max = await db.warehouseBlock.aggregate({ _max: { sortOrder: true } });
    const created = await db.warehouseBlock.create({
      data: {
        letter,
        areaM2: areaM2 === null ? null : areaM2.toFixed(3),
        sortOrder: (max._max.sortOrder ?? 0) + 1,
        landmarks: { create: numbers.map((number) => ({ number })) },
      },
      select: { id: true },
    });
    await logKarta(actorId, created.id, "KARTA_BLOCK_ADD", {
      letter,
      landmarks: numbers,
      areaM2: areaM2 === null ? null : areaM2.toFixed(3),
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      redirect(`${BACK}&err=block_taken`);
    }
    throw e;
  }
  revalidatePath("/karta-sklada");
  redirect(`${BACK}&ok=block`);
}

export async function renameBlock(formData: FormData): Promise<void> {
  const actorId = await requireMapEditor();
  // ТЗ №7 §2 (BUG-01) — единый алфавит/регистр (кир/лат дубли).
  const letter = normalizeBlockLetter(String(formData.get("letter") ?? ""));
  if (!letter) redirect(`${BACK}&err=letter`);
  // ТЗ №17 §3.1 — переименование ведёт только В латиницу: это и есть путь
  // перевода старых кириллических блоков (Б, В, Е) на коды с плана.
  if (!isLatinBlockCode(letter)) redirect(`${BACK}&err=letter_not_latin`);
  const id = await resolveBlockId(formData);
  try {
    // Аудит ТЗ №7 #6 — раньше renameBlock менял только WarehouseBlock.letter,
    // а BatchLocation/Slab/Piece.block оставались под СТАРОЙ буквой (join —
    // строковое равенство). После переименования камень «терялся»: сетка под
    // «Б», физический склад под «А» — приёмка через datalist слала новые
    // партии в «Б», а старые всплывали как orphan-карта «А». Теперь одна
    // транзакция: читаем oldLetter → правим WarehouseBlock.letter → каскадом
    // переносим все joined-строки. Если новая буква занята другим блоком —
    // отказ (объединение блоков — отдельное решение, не молчаливое слияние).
    await db.$transaction(async (tx) => {
      const cur = await tx.warehouseBlock.findUnique({
        where: { id },
        select: { letter: true },
      });
      if (!cur) throw new Prisma.PrismaClientKnownRequestError("not found", {
        code: "P2025",
        clientVersion: "n/a",
      });
      const oldLetter = cur.letter;
      if (oldLetter === letter) return; // no-op — те же коды после нормализации

      // ТЗ №18 §9.1 — код назначения свободен? Проверяем и сетку, и камень
      // (авто-блок из приёмки строки сетки не имеет). Последовательно, а не
      // Promise.all: внутри интерактивной транзакции запросы идут по одному
      // соединению.
      const takenBlock = await tx.warehouseBlock.findUnique({
        where: { letter },
        select: { id: true },
      });
      if (takenBlock) throw new BlockCodeTakenError();
      const takenLocs = await tx.batchLocation.count({ where: { block: letter } });
      const takenSlabs = await tx.slab.count({ where: { block: letter } });
      const takenPieces = await tx.piece.count({ where: { block: letter } });
      if (takenLocs + takenSlabs + takenPieces > 0) {
        throw new BlockCodeTakenError();
      }
      await tx.warehouseBlock.update({ where: { id }, data: { letter } });
      const [locs, slabs, pieces] = [
        await tx.batchLocation.updateMany({
          where: { block: oldLetter },
          data: { block: letter },
        }),
        await tx.slab.updateMany({
          where: { block: oldLetter },
          data: { block: letter },
        }),
        await tx.piece.updateMany({
          where: { block: oldLetter },
          data: { block: letter },
        }),
      ];
      // ТЗ №17 §7 — в Историю: было → стало и сколько строк камня переехало.
      // Внутри транзакции: если перенос откатится, запись в Истории не останется.
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: "ADJUSTMENT",
          entityType: "WarehouseBlock",
          entityId: id,
          payload: {
            kind: "KARTA_BLOCK_RENAME",
            from: oldLetter,
            to: letter,
            moved: {
              batchLocations: locs.count,
              slabs: slabs.count,
              pieces: pieces.count,
            },
          },
        },
      });
    });
  } catch (e) {
    // ТЗ №18 §9.1 — занятый код: отказ вместо молчаливого слияния.
    if (e instanceof BlockCodeTakenError) redirect(`${BACK}&err=block_taken`);
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2002") redirect(`${BACK}&err=block_taken`);
      if (e.code === "P2025") redirect(`${BACK}&err=notfound`);
    }
    throw e;
  }
  revalidatePath("/karta-sklada");
  redirect(`${BACK}&ok=renamed`);
}

export async function deleteBlock(formData: FormData): Promise<void> {
  const actorId = await requireMapEditor();
  const id = String(formData.get("blockId") ?? "");
  // Авто-блок (только буква): строки WarehouseBlock ещё нет — материализовать
  // ради удаления бессмысленно. Камень в нём есть всегда (он и породил блок),
  // поэтому правило «только пустой» его и так заблокирует.
  if (!id) {
    const fromLetter = String(formData.get("fromLetter") ?? "").trim();
    if (!fromLetter) redirect(`${BACK}&err=notfound`);
    if (await blockHasStone(fromLetter)) redirect(`${BACK}&err=block_has_stone`);
    // Камня нет и строки нет — удалять нечего, считаем выполненным.
    redirect(`${BACK}&ok=deleted`);
  }
  const block = await db.warehouseBlock.findUnique({
    where: { id },
    select: { letter: true },
  });
  if (!block) redirect(`${BACK}&err=notfound`);
  // Защита данных: удаляем только пустой блок (нет камня по этой букве).
  if (await blockHasStone(block.letter)) redirect(`${BACK}&err=block_has_stone`);
  await db.warehouseBlock.delete({ where: { id } }); // landmarks — cascade
  await logKarta(actorId, id, "KARTA_BLOCK_DELETE", { letter: block.letter });
  revalidatePath("/karta-sklada");
  redirect(`${BACK}&ok=deleted`);
}

export async function setBlockMeta(formData: FormData): Promise<void> {
  const actorId = await requireMapEditor();
  const id = await resolveBlockId(formData);
  const note = String(formData.get("note") ?? "").trim() || null;
  const isFull = formData.get("isFull") === "1";
  // Аудит ТЗ №7 #7 — единый bounded-парсер (см. addBlock).
  const areaRes = parseBoundedDecimal(String(formData.get("areaM2") ?? ""), {
    max: MAX_DECIMAL_12_3,
    allowZero: true,
  });
  if (!areaRes.ok) redirect(`${BACK}&err=area`);
  const areaM2 = areaRes.value;
  const updated = await db.warehouseBlock.update({
    where: { id },
    data: { note, isFull, areaM2: areaM2 === null ? null : areaM2.toFixed(3) },
    select: { letter: true },
  });
  await logKarta(actorId, id, "KARTA_BLOCK_META", {
    letter: updated.letter,
    note,
    isFull,
    areaM2: areaM2 === null ? null : areaM2.toFixed(3),
  });
  revalidatePath("/karta-sklada");
  redirect(`${BACK}&ok=meta`);
}

export async function addLandmark(formData: FormData): Promise<void> {
  const actorId = await requireMapEditor();
  const number = String(formData.get("number") ?? "").trim();
  if (!number) redirect(`${BACK}&err=number`);
  const blockId = await resolveBlockId(formData);
  try {
    await db.warehouseLandmark.create({ data: { blockId, number } });
    await logKarta(actorId, blockId, "KARTA_LANDMARK_ADD", { number });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      redirect(`${BACK}&err=landmark_taken`);
    }
    throw e;
  }
  revalidatePath("/karta-sklada");
  redirect(`${BACK}&ok=landmark`);
}

export async function removeLandmark(formData: FormData): Promise<void> {
  const actorId = await requireMapEditor();
  const id = String(formData.get("landmarkId") ?? "");
  if (!id) redirect(`${BACK}&err=notfound`);
  // ТЗ №17 §7 — ориентир, на котором стоит камень, удалять нельзя: иначе у
  // партии/плиты остаётся адрес на флажок, которого больше нет в справочнике,
  // и складчик не найдёт камень по карте.
  const lm = await db.warehouseLandmark.findUnique({
    where: { id },
    select: { number: true, block: { select: { id: true, letter: true } } },
  });
  if (!lm) redirect(`${BACK}&err=notfound`);
  if (await landmarkHasStone(lm.block.letter, lm.number)) {
    redirect(`${BACK}&err=landmark_has_stone`);
  }
  await db.warehouseLandmark.delete({ where: { id } });
  await logKarta(actorId, lm.block.id, "KARTA_LANDMARK_REMOVE", {
    letter: lm.block.letter,
    number: lm.number,
  });
  revalidatePath("/karta-sklada");
  redirect(`${BACK}&ok=landmark_removed`);
}
