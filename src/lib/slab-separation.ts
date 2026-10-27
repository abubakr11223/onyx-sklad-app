// Onyx — «выделение плиты» (§4.1 L3 / §6.1): при фото складчика из партии
// вырезается отдельная «Плита №N». Аудит ТЗ №7 #1: раньше это делалось голым
// slab.create БЕЗ транзакции, БЕЗ batch-lock и БЕЗ guard'а свободного остатка —
// единственный путь, менявший вход формулы §3 в обход контракта batch-lock.ts,
// из-за чего свободный остаток можно было увести в минус (oversell). Здесь —
// та же дисциплина, что в breaking.ts/sales.ts/reservations.ts.
//
// W10-B: separateSlab + Photo.SLAB — bitta tranzaksiya (separateSlabWithPhoto).
// Aks holda: slab yozilib photo.create yiqilsa → «plita fotosiz» + update_id
// claim qolsa Telegram retry no-op (foto yo'qoladi).

import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "./db";
import { lockBatchForUpdate } from "./batch-lock";
import { computeFreeRemainder } from "./inventory";
import {
  allocateFromLocations,
  loadPatternStock,
  patternsOfBatch,
  takeFromLocationsInTx,
} from "./pattern-stock";

/** Ошибка домена выделения плиты (код — для вызывающего, не разбор строки). */
export class SlabSeparationError extends Error {
  constructor(
    public code: "BATCH_NOT_FOUND" | "INSUFFICIENT_REMAINDER" | "PATTERN_REQUIRED",
    message: string,
  ) {
    super(message);
    this.name = "SlabSeparationError";
  }
}

/** Данные для выделения одной плиты (блок/ориентир/needsCheck уже разрешены вызывающим). */
export interface SeparateSlabInput {
  batchId: string;
  stoneTypeId: string;
  /**
   * ТЗ №16 A1 — НЕОБЯЗАТЕЛЕН.
   *
   * Раньше поле было обязательным, и механизм выделения оказался приварен к
   * фотозапросу: шоу-рум и «Разбить → Плита» не могли им пользоваться, хотя
   * колонка `Slab.photoRequestId` в схеме давно `String?`. То есть запрет был
   * только на уровне типа, а не данных — ровно та причина, по которой в шоу-руме
   * была видна одна-единственная плита (ТЗ №16 §2).
   *
   * null → плита выделена не по фотозапросу (витрина, разбитие, ручной отбор).
   */
  photoRequestId?: string | null;
  block: string;
  landmark: string;
  needsCheck: boolean;
  separatedById: string;
  /**
   * ТЗ №19 §D — из какого узора выделяется плита. Плита получает размер,
   * толщину узора, остаток узора и его места уменьшается на 1.
   * Не задан: единственный узор партии берётся сам; при нескольких —
   * ошибка, если requirePattern (шоу-рум), иначе плита без узора (legacy).
   */
  batchPatternId?: string | null;
  requirePattern?: boolean;
}

/** Photo.SLAB yozuvi (Telegram file_id = storageKey) — separateSlab bilan bir TX. */
export interface SeparateSlabPhotoInput {
  storageKey: string;
  takenById: string;
}

/** Минимальная форма клиента: реальный PrismaClient её удовлетворяет, тест — мок. */
type SeparationDb = Pick<PrismaClient, "$transaction">;

/** Interactive transaction client (lockBatchForUpdate + create). */
type SeparationTx = Prisma.TransactionClient;

const toNum = (d: { toString(): string } | null | undefined): number | null =>
  d == null ? null : Number(d.toString());

/**
 * Core: batch-lock + §3 guard + slab.create. Caller provides `tx` so Photo
 * can share the same transaction (W10-B).
 */
export async function separateSlabInTx(
  tx: SeparationTx,
  input: SeparateSlabInput,
): Promise<string> {
  // (1) §3 lock — ДО любых чтений остатка.
  await lockBatchForUpdate(tx, input.batchId);

  const batch = await tx.batch.findUnique({
    where: { id: input.batchId },
    select: {
      slabsTotal: true,
      areaTotalM2: true,
      slabsAdjusted: true,
      areaAdjustedM2: true,
      slabsSoldDirect: true,
      areaSoldDirectM2: true,
      // ТЗ №16 A1 — габариты партии наследуются плитой (см. ниже).
      lengthMm: true,
      widthMm: true,
      thicknessMm: true,
      locations: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, block: true, landmark: true, slabsHere: true, areaHereM2: true },
      },
      slabs: { select: { areaM2: true } },
      pieces: { where: { originSlabId: null }, select: { areaM2: true } },
    },
  });
  if (!batch) {
    throw new SlabSeparationError("BATCH_NOT_FOUND", "Партия не найдена");
  }

  // (2) Guard §3 — свободный остаток С УЧЁТОМ новой выделяемой плиты.
  const after = computeFreeRemainder(
    {
      slabsTotal: batch.slabsTotal,
      areaTotalM2: toNum(batch.areaTotalM2),
      slabsAdjusted: batch.slabsAdjusted,
      areaAdjustedM2: toNum(batch.areaAdjustedM2) ?? 0,
      slabsSoldDirect: batch.slabsSoldDirect,
      areaSoldDirectM2: toNum(batch.areaSoldDirectM2) ?? 0,
    },
    [
      ...batch.slabs.map((s) => ({ areaM2: toNum(s.areaM2) })),
      { areaM2: null }, // новая выделяемая плита (замер придёт позже)
    ],
    batch.pieces.map((p) => ({ areaM2: toNum(p.areaM2) })),
  );
  if (after.slabsFree !== null && after.slabsFree < 0) {
    throw new SlabSeparationError(
      "INSUFFICIENT_REMAINDER",
      "В партии не осталось свободных плит — выделять нечего",
    );
  }
  if (after.areaFreeM2 !== null && after.areaFreeM2 < -1e-9) {
    throw new SlabSeparationError(
      "INSUFFICIENT_REMAINDER",
      "Площадь партии исчерпана — выделять плиту нельзя",
    );
  }

  // (2b) ТЗ №19 — узор: «свободно» узора из единого расчёта и его места.
  const stock = patternsOfBatch(await loadPatternStock(tx, [input.batchId]), input.batchId);
  let patternId = input.batchPatternId?.trim() || null;
  if (!patternId && stock.length === 1) patternId = stock[0].id;
  if (!patternId && stock.length > 1 && input.requirePattern) {
    throw new SlabSeparationError(
      "PATTERN_REQUIRED",
      "В партии несколько узоров — выберите, из какого узора плита",
    );
  }
  const ps = patternId ? (stock.find((p) => p.id === patternId) ?? null) : null;
  if (patternId && !ps) {
    throw new SlabSeparationError("BATCH_NOT_FOUND", "Узор не найден в этой партии");
  }
  if (ps && ps.availableSlabs < 1) {
    throw new SlabSeparationError(
      "INSUFFICIENT_REMAINDER",
      `В узоре «${ps.description}» нет свободных плит`,
    );
  }
  const candidateLocs = ps
    ? ps.locations
    : (batch.locations ?? []).map((l) => ({ ...l, areaHereM2: toNum(l.areaHereM2) }));
  const preferred =
    candidateLocs.find((l) => l.block === input.block && l.landmark === input.landmark)?.id ??
    null;
  const [alloc] = allocateFromLocations(candidateLocs, 1, preferred);
  const unitArea =
    ps?.unitAreaM2 ??
    (batch.lengthMm && batch.widthMm ? (batch.lengthMm * batch.widthMm) / 10_000 : 0);
  if (alloc) await takeFromLocationsInTx(tx, [alloc], unitArea);
  // Место плиты: заданное вызывающим, иначе место узора, откуда её взяли.
  const unknownPlace = !input.block || input.block === "?";
  const block = unknownPlace && alloc?.block ? alloc.block : input.block;
  const landmark = unknownPlace && alloc?.block ? (alloc.landmark ?? "") : input.landmark;

  // (3) label = «Плита №N», N = существующие плиты + 1. Под row-lock партии
  //     нумерация сериализована → гонки @@unique([batchId,label]) нет.
  // (4) ТЗ №16 A1 — габариты наследуются от партии.
  //
  // Раньше выделенная плита рождалась БЕЗ размеров. После ТЗ №12 длина и ширина
  // обязательны на приёмке, то есть у партии они есть всегда, а поиск по размеру
  // (`poisk-search.ts`) фильтрует плиты по `lengthMm`/`widthMm`. Плита без
  // размеров просто не находилась — витрина и «Разбить» отдавали камень, который
  // менеджер потом не мог подобрать под заказ. Копируем, а не считаем: это тот же
  // физический формат плиты, замер уточняется позже (`isAreaEstimated`).
  //
  // Площадь НЕ копируем: она у партии общая (areaTotalM2), а не на плиту, и §3
  // выше уже посчитал новую плиту как `areaM2: null` (замер придёт позже).
  const slab = await tx.slab.create({
    data: {
      batchId: input.batchId,
      stoneTypeId: input.stoneTypeId,
      label: `Плита №${batch.slabs.length + 1}`,
      batchPatternId: ps?.id ?? null,
      // ТЗ №19 B4 — у плиты из узора сразу размер и толщина узора.
      lengthMm: ps?.lengthMm ?? batch.lengthMm,
      widthMm: ps?.widthMm ?? batch.widthMm,
      thicknessMm: ps?.thicknessMm != null ? ps.thicknessMm.toFixed(1) : batch.thicknessMm,
      block,
      landmark,
      needsCheck: input.needsCheck,
      photoRequestId: input.photoRequestId ?? null,
      separatedById: input.separatedById,
    },
    select: { id: true },
  });
  return slab.id;
}

/**
 * Выделяет одну «Плиту №N» из партии в ОДНОЙ транзакции с пессимистическим
 * batch-lock'ом и guard'ом свободного остатка §3.
 *
 * `database` инъектируется для тестов (по умолчанию — реальный db).
 */
export async function separateSlabGuarded(
  input: SeparateSlabInput,
  database: SeparationDb = db,
): Promise<string> {
  return database.$transaction(async (tx) => separateSlabInTx(tx, input));
}

/**
 * W10-B — Slab + Photo.SLAB atomik. Telegram file_id (storageKey) DB yozuvi;
 * fayl yuklash TX tashqarisida (webhook faqat file_id saqlaydi).
 * photo.create yiqilsa → slab ham rollback (fotosiz plita qolmaydi).
 */
export async function separateSlabWithPhoto(
  input: SeparateSlabInput,
  photo: SeparateSlabPhotoInput,
  database: SeparationDb = db,
): Promise<string> {
  return database.$transaction(async (tx) => {
    const slabId = await separateSlabInTx(tx, input);
    await tx.photo.create({
      data: {
        storageKey: photo.storageKey,
        kind: "SLAB",
        takenAt: new Date(),
        takenById: photo.takenById,
        stoneTypeId: input.stoneTypeId,
        slabId,
        photoRequestId: input.photoRequestId,
      },
    });
    return slabId;
  });
}
