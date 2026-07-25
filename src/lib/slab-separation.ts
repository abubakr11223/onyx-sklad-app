// Onyx — «выделение плиты» (§4.1 L3 / §6.1): при фото складчика из партии
// вырезается отдельная «Плита №N». Аудит ТЗ №7 #1: раньше это делалось голым
// slab.create БЕЗ транзакции, БЕЗ batch-lock и БЕЗ guard'а свободного остатка —
// единственный путь, менявший вход формулы §3 в обход контракта batch-lock.ts,
// из-за чего свободный остаток можно было увести в минус (oversell). Здесь —
// та же дисциплина, что в breaking.ts/sales.ts/reservations.ts.

import type { PrismaClient } from "@prisma/client";
import { db } from "./db";
import { lockBatchForUpdate } from "./batch-lock";
import { computeFreeRemainder } from "./inventory";

/** Ошибка домена выделения плиты (код — для вызывающего, не разбор строки). */
export class SlabSeparationError extends Error {
  constructor(
    public code: "BATCH_NOT_FOUND" | "INSUFFICIENT_REMAINDER",
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
  photoRequestId: string;
  block: string;
  landmark: string;
  needsCheck: boolean;
  separatedById: string;
}

/** Минимальная форма клиента: реальный PrismaClient её удовлетворяет, тест — мок. */
type SeparationDb = Pick<PrismaClient, "$transaction">;

const toNum = (d: { toString(): string } | null): number | null =>
  d === null ? null : Number(d.toString());

/**
 * Выделяет одну «Плиту №N» из партии в ОДНОЙ транзакции с пессимистическим
 * batch-lock'ом и guard'ом свободного остатка §3:
 *   1) lockBatchForUpdate ПЕРВЫМ оператором — сериализует все операции, меняющие
 *      свободный остаток партии (продажа/бронь/бой/ВЫДЕЛЕНИЕ), и заодно исключает
 *      гонку нумерации «Плита №N» (второе выделение ждёт COMMIT первого), поэтому
 *      прежний P2002-retry больше не нужен;
 *   2) computeFreeRemainder С УЧЁТОМ новой плиты (area ещё не замерена → null → в
 *      формуле §3 берётся средняя по партии); если slabsFree<0 или areaFreeM2<0 —
 *      выделять нечего, INSUFFICIENT_REMAINDER (mirror breaking.ts:640-651);
 *   3) только после guard'а создаётся Slab.
 *
 * `database` инъектируется для тестов (по умолчанию — реальный db).
 */
export async function separateSlabGuarded(
  input: SeparateSlabInput,
  database: SeparationDb = db,
): Promise<string> {
  return database.$transaction(async (tx) => {
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

    // (3) label = «Плита №N», N = существующие плиты + 1. Под row-lock партии
    //     нумерация сериализована → гонки @@unique([batchId,label]) нет.
    const slab = await tx.slab.create({
      data: {
        batchId: input.batchId,
        stoneTypeId: input.stoneTypeId,
        label: `Плита №${batch.slabs.length + 1}`,
        block: input.block,
        landmark: input.landmark,
        needsCheck: input.needsCheck,
        photoRequestId: input.photoRequestId,
        separatedById: input.separatedById,
      },
      select: { id: true },
    });
    return slab.id;
  });
}
