// W1-T4 — публичный признак «в наличии» на /q/[slug] по ОФИЦИАЛЬНОЙ формуле §3.
//
// Баг: страница считала остаток как slabsTotal − slabsSoldDirect и игнорировала
// отделённые плиты (Slab), прямые бои (Piece) и корректировки (slabsAdjusted) —
// полностью распроданный вид показывал клиенту «в наличии».
//
// Здесь НЕТ собственной математики: свободный остаток считает
// freeRemainderFromAggregate (src/lib/batch-remainders.ts) — тот же helper, что
// /poisk и /kamen. Решение «есть наличие» зеркалит hasAvailability из
// poisk-query.ts (buildTypeRows): суммы свободного остатка по партиям БЕЗ
// клампа нуля ({+2, −3} → Σ = −1 → нет наличия), плюс доступные единицы
// (AVAILABLE slab/piece, needsCheck=false) считаются наличием даже при нулевом
// партионном остатке. Наружу уходит ТОЛЬКО boolean — никаких чисел/локаций/цен.
import type { BatchRemainderAggregate } from "@/lib/batch-remainders";
import {
  EMPTY_AGGREGATE,
  freeRemainderFromAggregate,
} from "@/lib/batch-remainders";

/** Prisma Decimal — структурно, без runtime-импорта (как в poisk-query.ts). */
type DecimalLike = { toString(): string };

function toNum(d: DecimalLike | number): number {
  return typeof d === "number" ? d : Number(d.toString());
}

function toNumOrNull(d: DecimalLike | number | null): number | null {
  return d === null ? null : toNum(d);
}

/** Поля партии, нужные формуле §3 (select в page.tsx loadStone). */
export interface QrBatchRow {
  id: string;
  slabsTotal: number | null;
  areaTotalM2: DecimalLike | number | null;
  slabsAdjusted: number;
  areaAdjustedM2: DecimalLike | number;
  slabsSoldDirect: number;
  areaSoldDirectM2: DecimalLike | number;
}

/**
 * true ⟺ у вида есть наличие для публичного бейджа:
 *   Σ slabsFree > 0 || Σ areaFreeM2 > 0 || availableSlabs > 0 || availablePieces > 0
 * (суммы по партиям без клампа — ровно как hasAvailability в /poisk;
 * null-остатки, как и там, в сумму не входят).
 */
export function computeQrHasStock(
  batches: readonly QrBatchRow[],
  remainders: ReadonlyMap<string, BatchRemainderAggregate>,
  availableSlabs: number,
  availablePieces: number,
): boolean {
  let slabsFreeSum = 0;
  let areaFreeSum = 0;
  for (const b of batches) {
    const free = freeRemainderFromAggregate(
      {
        slabsTotal: b.slabsTotal,
        areaTotalM2: toNumOrNull(b.areaTotalM2),
        slabsAdjusted: b.slabsAdjusted,
        areaAdjustedM2: toNum(b.areaAdjustedM2),
        slabsSoldDirect: b.slabsSoldDirect,
        areaSoldDirectM2: toNum(b.areaSoldDirectM2),
      },
      remainders.get(b.id) ?? EMPTY_AGGREGATE,
    );
    if (free.slabsFree !== null) slabsFreeSum += free.slabsFree;
    if (free.areaFreeM2 !== null) areaFreeSum += free.areaFreeM2;
  }
  return (
    slabsFreeSum > 0 ||
    areaFreeSum > 0 ||
    availableSlabs > 0 ||
    availablePieces > 0
  );
}
