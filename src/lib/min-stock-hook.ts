// ТЗ №20 C — единая точка подключения проверки минимального остатка
// (по образцу shipment-notify-hook.ts).
//
// ДВА ПРАВИЛА:
//  1. Звать только ПОСЛЕ коммита транзакции — Telegram внешний I/O.
//  2. Никогда не бросать наружу: продажа/бронь/приёмка уже состоялась,
//     сбой проверки или отправки — повод залогировать, не откатывать.
//
// Вызывающему не нужно знать вид камня: передаёт то, что у него под рукой
// (партия, узор, плита, кусок, продажа, бронь, образец) — здесь это
// сводится к stoneTypeId.

import { db } from "@/lib/db";
import { sendMessage } from "@/lib/telegram";
import { checkMinStock, type CheckMinStockResult } from "@/lib/min-stock";

/** Ссылки на затронутый камень — любое подмножество. */
export interface MinStockRefs {
  stoneTypeIds?: readonly (string | null | undefined)[];
  batchIds?: readonly (string | null | undefined)[];
  batchPatternIds?: readonly (string | null | undefined)[];
  slabIds?: readonly (string | null | undefined)[];
  pieceIds?: readonly (string | null | undefined)[];
  saleRecordIds?: readonly (string | null | undefined)[];
  reservationIds?: readonly (string | null | undefined)[];
  sampleIds?: readonly (string | null | undefined)[];
}

function clean(xs: readonly (string | null | undefined)[] | undefined): string[] {
  return [...new Set((xs ?? []).filter((x): x is string => !!x && x.trim() !== ""))];
}

/** Ссылки → множество stoneTypeId (несколько лёгких select'ов). */
async function resolveStoneTypeIds(refs: MinStockRefs): Promise<string[]> {
  const types = new Set(clean(refs.stoneTypeIds));
  const batchIds = new Set(clean(refs.batchIds));
  const patternIds = new Set(clean(refs.batchPatternIds));
  const slabIds = new Set(clean(refs.slabIds));
  const pieceIds = new Set(clean(refs.pieceIds));

  // Продажа / бронь / образец → их единица или партия.
  const collect = (r: {
    slabId: string | null;
    pieceId: string | null;
    batchId: string | null;
    batchPatternId: string | null;
  }) => {
    if (r.slabId) slabIds.add(r.slabId);
    if (r.pieceId) pieceIds.add(r.pieceId);
    if (r.batchId) batchIds.add(r.batchId);
    if (r.batchPatternId) patternIds.add(r.batchPatternId);
  };
  const sel = { slabId: true, pieceId: true, batchId: true, batchPatternId: true } as const;
  const saleIds = clean(refs.saleRecordIds);
  const resIds = clean(refs.reservationIds);
  const sampleIds = clean(refs.sampleIds);
  const [sales, reservations, samples] = await Promise.all([
    saleIds.length ? db.saleRecord.findMany({ where: { id: { in: saleIds } }, select: sel }) : [],
    resIds.length ? db.reservation.findMany({ where: { id: { in: resIds } }, select: sel }) : [],
    sampleIds.length ? db.sample.findMany({ where: { id: { in: sampleIds } }, select: sel }) : [],
  ]);
  for (const r of [...sales, ...reservations, ...samples]) collect(r);

  const [batches, patterns, slabs, pieces] = await Promise.all([
    batchIds.size
      ? db.batch.findMany({ where: { id: { in: [...batchIds] } }, select: { stoneTypeId: true } })
      : [],
    patternIds.size
      ? db.batchPattern.findMany({
          where: { id: { in: [...patternIds] } },
          select: { batch: { select: { stoneTypeId: true } } },
        })
      : [],
    slabIds.size
      ? db.slab.findMany({ where: { id: { in: [...slabIds] } }, select: { stoneTypeId: true } })
      : [],
    pieceIds.size
      ? db.piece.findMany({ where: { id: { in: [...pieceIds] } }, select: { stoneTypeId: true } })
      : [],
  ]);
  for (const b of batches) types.add(b.stoneTypeId);
  for (const p of patterns) types.add(p.batch.stoneTypeId);
  for (const s of slabs) types.add(s.stoneTypeId);
  for (const p of pieces) types.add(p.stoneTypeId);
  return [...types];
}

/**
 * Проверить пересечение порога после операции. Fire-and-forget: ошибки
 * проглочены, результат — для логов.
 */
export async function checkMinStockSafe(
  refs: MinStockRefs,
): Promise<CheckMinStockResult | null> {
  try {
    const ids = await resolveStoneTypeIds(refs);
    if (ids.length === 0) return null;
    return await checkMinStock(db, ids, {
      sendMessage: (chatId, text) => sendMessage(chatId, text),
    });
  } catch (e) {
    console.warn("[min-stock] проверка порога не удалась (операция сохранена):", e);
    return null;
  }
}

/**
 * Пересчёт уже помеченных видов (ставит обратно «взведено», если остаток
 * вырос сам — например, бронь истекла по cron'у без чьего-либо действия).
 * Только re-arm: у помеченного вида alert невозможен (решение — none/rearm).
 */
export async function recheckAlertedMinStockSafe(): Promise<CheckMinStockResult | null> {
  try {
    const rows = await db.stoneType.findMany({
      where: { lowStockAlertedAt: { not: null } },
      select: { id: true },
    });
    if (rows.length === 0) return null;
    return await checkMinStock(
      db,
      rows.map((r) => r.id),
      { sendMessage: (chatId, text) => sendMessage(chatId, text) },
    );
  } catch (e) {
    console.warn("[min-stock] пересчёт помеченных видов не удался:", e);
    return null;
  }
}
