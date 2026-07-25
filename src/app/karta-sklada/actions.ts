"use server";

// ТЗ №6 — редактирование сетки склада (блоки + ориентиры). ТОЛЬКО Владелец
// (getRealSessionUser, как /accounts — defense-in-depth). Удаление блока — только
// если он пустой (нет камня: BatchLocation по букве блока). Все правки → редирект
// обратно в режим редактирования с ok/err.
import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { normalizeBlockLetter } from "@/lib/block-letter";
import { MAX_DECIMAL_12_3, parseBoundedDecimal } from "@/lib/decimal";
import { requireOwner as requireOwnerBase } from "@/lib/session";

const BACK = "/karta-sklada?edit=1";

// Аудит ТЗ №7 #13 — общий OWNER-gate из lib/session.ts (был локальный дубль).
async function requireOwner(): Promise<void> {
  await requireOwnerBase(`${BACK}&err=denied`);
}

/**
 * Есть ли камень в блоке — для защиты удаления. Аудит ТЗ №7 #16: проверяем
 * И нормализованную форму, И исходную (legacy-строки в BatchLocation могли быть
 * записаны ДО ввода нормализации; их фактическое значение и есть ключ поиска).
 * Дедуп через Set: если нормализация — no-op, `in` со списком из одной буквы.
 */
async function blockHasStone(rawLetter: string): Promise<boolean> {
  const variants = [
    ...new Set([rawLetter, normalizeBlockLetter(rawLetter)].filter(Boolean)),
  ];
  const n = await db.batchLocation.count({ where: { block: { in: variants } } });
  return n > 0;
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
  await requireOwner();
  // ТЗ №7 §2 (BUG-01) — единый алфавит/регистр (кир/лат дубли).
  const letter = normalizeBlockLetter(String(formData.get("letter") ?? ""));
  if (!letter) redirect(`${BACK}&err=letter`);
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
    await db.warehouseBlock.create({
      data: {
        letter,
        areaM2: areaM2 === null ? null : areaM2.toFixed(3),
        sortOrder: (max._max.sortOrder ?? 0) + 1,
        landmarks: { create: numbers.map((number) => ({ number })) },
      },
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
  await requireOwner();
  // ТЗ №7 §2 (BUG-01) — единый алфавит/регистр (кир/лат дубли).
  const letter = normalizeBlockLetter(String(formData.get("letter") ?? ""));
  if (!letter) redirect(`${BACK}&err=letter`);
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
      if (oldLetter === letter) return; // no-op — те же буквы после нормализации
      await tx.warehouseBlock.update({ where: { id }, data: { letter } });
      await tx.batchLocation.updateMany({
        where: { block: oldLetter },
        data: { block: letter },
      });
      await tx.slab.updateMany({
        where: { block: oldLetter },
        data: { block: letter },
      });
      await tx.piece.updateMany({
        where: { block: oldLetter },
        data: { block: letter },
      });
    });
  } catch (e) {
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
  await requireOwner();
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
  revalidatePath("/karta-sklada");
  redirect(`${BACK}&ok=deleted`);
}

export async function setBlockMeta(formData: FormData): Promise<void> {
  await requireOwner();
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
  await db.warehouseBlock.update({
    where: { id },
    data: { note, isFull, areaM2: areaM2 === null ? null : areaM2.toFixed(3) },
  });
  revalidatePath("/karta-sklada");
  redirect(`${BACK}&ok=meta`);
}

export async function addLandmark(formData: FormData): Promise<void> {
  await requireOwner();
  const number = String(formData.get("number") ?? "").trim();
  if (!number) redirect(`${BACK}&err=number`);
  const blockId = await resolveBlockId(formData);
  try {
    await db.warehouseLandmark.create({ data: { blockId, number } });
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
  await requireOwner();
  const id = String(formData.get("landmarkId") ?? "");
  if (!id) redirect(`${BACK}&err=notfound`);
  await db.warehouseLandmark.delete({ where: { id } });
  revalidatePath("/karta-sklada");
  redirect(`${BACK}&ok=landmark_removed`);
}
