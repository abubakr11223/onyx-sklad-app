// ТЗ №20 C (§4) — «Минимальные остатки».
//
// У вида камня необязательный порог (StoneType.minStockQty + minStockUnit).
// Когда СВОБОДНЫЙ остаток вида в целом падает ниже порога — блок
// «Заканчивается» на главной, пометка «мало» в поиске/продаже и ОДНО сообщение
// владельцу в Telegram. Повтор — только после того, как остаток вернулся к
// порогу (приёмка/возврат/снятие брони), а потом снова упал.
//
// Свободный остаток вида — НЕ новая формула, а сумма того же, что показывает
// карточка вида и /poisk (batch-remainders.ts):
//
//   объём  = max(0, Σ freeRemainderFromAggregate(партия) − Σ volume-holds)
//            (holds = активные брони BATCH_VOLUME + образцы BATCH_VOLUME —
//             getBatchReservationHolds; узоры уже внутри счётчиков партии)
//   + выделенные плиты в статусе AVAILABLE (их §3 вычитает из объёма партии,
//     но они лежат на складе и свободны). RESERVED / SHOWROOM / SAMPLE /
//     SOLD / RETURNED (ждёт проверки) — не свободны.
//
// Проданное «к отгрузке» уже вычтено из партии при продаже (slabsSoldDirect),
// поэтому отдельно не учитывается. Бой/остатки (Piece) — не плиты, в порог не
// входят. SLABS — считаем плиты; AREA_M2 — площадь (null-площадь выделенной
// плиты → средняя по партии, как в §3).
//
// lowStockAlertedAt — флаг «сигнал уже отправлен» (null = нет). Ставится
// условным updateMany (… WHERE lowStockAlertedAt IS NULL): две одновременные
// продажи не пришлют два сообщения. Сбрасывается, когда остаток ≥ порога.
//
// checkMinStock зовётся ПОСЛЕ коммита транзакции (Telegram — внешний I/O) и
// никогда не роняет операцию: см. min-stock-hook.ts.

import type { PrismaClient } from "@prisma/client";
import {
  EMPTY_AGGREGATE,
  EMPTY_HOLD,
  freeRemainderFromAggregate,
  getBatchRemainders,
  getBatchReservationHolds,
} from "./batch-remainders";
import type { SendResult } from "./telegram";

export type MinStockUnit = "SLABS" | "AREA_M2";

/** Порог вида. null — не отслеживается (пусто / ≤ 0 / нет единицы). */
export interface MinStockThreshold {
  qty: number;
  unit: MinStockUnit;
}

/** Свободный остаток вида в обеих единицах. */
export interface StockLevel {
  slabs: number;
  areaM2: number;
}

const AREA_EPS = 0.0005;

const m2Fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const qtyFmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 });

type DecimalLike = { toString(): string };

function toNum(d: DecimalLike | number | null | undefined): number | null {
  if (d === null || d === undefined) return null;
  return typeof d === "number" ? d : Number(d.toString());
}

/** Колонки StoneType → порог или null (не отслеживаем). */
export function thresholdOf(
  qty: DecimalLike | number | null | undefined,
  unit: string | null | undefined,
): MinStockThreshold | null {
  const n = toNum(qty);
  if (n === null || !Number.isFinite(n) || n <= 0) return null;
  if (unit !== "SLABS" && unit !== "AREA_M2") return null;
  return { qty: n, unit };
}

/** Свободно в единице порога. */
export function freeInUnit(level: StockLevel, unit: MinStockUnit): number {
  return unit === "SLABS" ? level.slabs : level.areaM2;
}

/** Ниже порога (строго меньше). Пустой порог — никогда. */
export function isBelowThreshold(
  threshold: MinStockThreshold | null,
  level: StockLevel,
): boolean {
  if (!threshold) return false;
  const free = freeInUnit(level, threshold.unit);
  return threshold.unit === "AREA_M2"
    ? free < threshold.qty - AREA_EPS
    : free < threshold.qty;
}

/**
 * Что делать с видом после операции:
 *  - "alert" — пересёк порог вниз, сигнала ещё не было → отправить и пометить;
 *  - "rearm" — остаток снова ≥ порога (или порог снят), а пометка стоит →
 *    снять, чтобы следующее падение снова дало сигнал;
 *  - "none"  — ничего (ниже порога и уже сообщили / выше порога без пометки).
 */
export type MinStockDecision = "alert" | "rearm" | "none";

export function decideMinStock(args: {
  threshold: MinStockThreshold | null;
  level: StockLevel;
  alerted: boolean;
}): MinStockDecision {
  const below = isBelowThreshold(args.threshold, args.level);
  if (below) return args.alerted ? "none" : "alert";
  return args.alerted ? "rearm" : "none";
}

/** 1 плита · 2 плиты · 5 плит (родительный после «осталось»). */
function slabsWord(n: number): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a >= 11 && a <= 14) return "плит";
  if (b === 1) return "плита";
  if (b >= 2 && b <= 4) return "плиты";
  return "плит";
}

/** «4 плиты» / «12,5 м²». */
export function formatStockQty(qty: number, unit: MinStockUnit): string {
  if (unit === "SLABS") {
    const n = Math.max(0, Math.floor(qty));
    return `${n} ${slabsWord(n)}`;
  }
  return `${m2Fmt.format(Math.max(0, qty))} м²`;
}

/** Порог для показа: «10» (плиты) / «20 м²». */
export function formatThreshold(t: MinStockThreshold): string {
  return t.unit === "SLABS" ? qtyFmt.format(t.qty) : `${m2Fmt.format(t.qty)} м²`;
}

/** «Травертин Классик: осталось 4 плиты (порог 10)» (§4). */
export function formatLowStockMessage(
  name: string,
  level: StockLevel,
  t: MinStockThreshold,
): string {
  return `${name}: осталось ${formatStockQty(freeInUnit(level, t.unit), t.unit)} (порог ${formatThreshold(t)})`;
}

// ───────────────────────── Расчёт остатка вида ─────────────────────────

/** Счётчики партии для §3 (как в карточке вида). */
export interface MinStockBatchRow {
  id: string;
  stoneTypeId: string;
  slabsTotal: number | null;
  areaTotalM2: DecimalLike | number | null;
  slabsAdjusted: number;
  areaAdjustedM2: DecimalLike | number;
  slabsSoldDirect: number;
  areaSoldDirectM2: DecimalLike | number;
}

/** Выделенные плиты партии в статусе AVAILABLE (агрегат). */
export interface AvailableSlabAggregate {
  count: number;
  areaSum: number;
  nullAreaCount: number;
}

/**
 * СОФ: партии + агрегаты → остаток по видам. Объём — как в карточке вида:
 * сумма §3 по партиям (null-величины вне суммы), минус volume-holds,
 * не ниже 0; затем + выделенные AVAILABLE плиты.
 */
export function stockLevelsFromBatches(
  batches: readonly MinStockBatchRow[],
  remainders: ReadonlyMap<
    string,
    Parameters<typeof freeRemainderFromAggregate>[1]
  >,
  holds: ReadonlyMap<string, { reservedSlabs: number; reservedAreaM2: number }>,
  availableSlabs: ReadonlyMap<string, AvailableSlabAggregate>,
): Map<string, StockLevel> {
  const acc = new Map<
    string,
    { slabs: number; heldSlabs: number; area: number; heldArea: number; extraSlabs: number; extraArea: number }
  >();
  for (const b of batches) {
    const a =
      acc.get(b.stoneTypeId) ??
      { slabs: 0, heldSlabs: 0, area: 0, heldArea: 0, extraSlabs: 0, extraArea: 0 };
    const areaTotal = toNum(b.areaTotalM2);
    const free = freeRemainderFromAggregate(
      {
        slabsTotal: b.slabsTotal,
        areaTotalM2: areaTotal,
        slabsAdjusted: b.slabsAdjusted,
        areaAdjustedM2: toNum(b.areaAdjustedM2) ?? 0,
        slabsSoldDirect: b.slabsSoldDirect,
        areaSoldDirectM2: toNum(b.areaSoldDirectM2) ?? 0,
      },
      remainders.get(b.id) ?? EMPTY_AGGREGATE,
    );
    const hold = holds.get(b.id) ?? EMPTY_HOLD;
    if (free.slabsFree !== null) {
      a.slabs += free.slabsFree;
      a.heldSlabs += hold.reservedSlabs;
    }
    if (free.areaFreeM2 !== null) {
      a.area += free.areaFreeM2;
      a.heldArea += hold.reservedAreaM2;
    }
    const sep = availableSlabs.get(b.id);
    if (sep && sep.count > 0) {
      const avg =
        areaTotal !== null && b.slabsTotal !== null && b.slabsTotal > 0
          ? areaTotal / b.slabsTotal
          : 0;
      a.extraSlabs += sep.count;
      a.extraArea += sep.areaSum + sep.nullAreaCount * avg;
    }
    acc.set(b.stoneTypeId, a);
  }
  const out = new Map<string, StockLevel>();
  for (const [id, a] of acc) {
    out.set(id, {
      slabs: Math.max(0, a.slabs - a.heldSlabs) + a.extraSlabs,
      areaM2: Math.max(0, a.area - a.heldArea) + a.extraArea,
    });
  }
  return out;
}

/**
 * DB: свободный остаток указанных видов (map stoneTypeId → StockLevel). Вид
 * без партий — { 0, 0 }. Те же агрегаты, что у карточки вида, без N+1.
 */
export async function loadStockLevels(
  db: PrismaClient,
  stoneTypeIds: readonly string[],
  now: Date = new Date(),
): Promise<Map<string, StockLevel>> {
  const ids = [...new Set(stoneTypeIds)];
  const out = new Map<string, StockLevel>();
  if (ids.length === 0) return out;
  const batches = await db.batch.findMany({
    where: { stoneTypeId: { in: ids } },
    select: {
      id: true,
      stoneTypeId: true,
      slabsTotal: true,
      areaTotalM2: true,
      slabsAdjusted: true,
      areaAdjustedM2: true,
      slabsSoldDirect: true,
      areaSoldDirectM2: true,
    },
  });
  const batchIds = batches.map((b) => b.id);
  const [remainders, holds, slabGroups] = await Promise.all([
    getBatchRemainders(db, batchIds),
    getBatchReservationHolds(db, batchIds, now),
    batchIds.length > 0
      ? db.slab.groupBy({
          by: ["batchId"],
          where: { batchId: { in: batchIds }, status: "AVAILABLE" },
          _count: { _all: true, areaM2: true },
          _sum: { areaM2: true },
        })
      : Promise.resolve([]),
  ]);
  const sep = new Map<string, AvailableSlabAggregate>();
  for (const g of slabGroups) {
    sep.set(g.batchId, {
      count: g._count._all,
      areaSum: toNum(g._sum.areaM2) ?? 0,
      nullAreaCount: g._count._all - g._count.areaM2,
    });
  }
  const levels = stockLevelsFromBatches(batches, remainders, holds, sep);
  for (const id of ids) out.set(id, levels.get(id) ?? { slabs: 0, areaM2: 0 });
  return out;
}

/** Вид ниже порога — для блока «Заканчивается» и пометки «мало». */
export interface LowStockItem {
  stoneTypeId: string;
  name: string;
  threshold: MinStockThreshold;
  level: StockLevel;
  /** Свободно в единице порога. */
  free: number;
}

/**
 * Виды ниже порога. stoneTypeIds не задан — все неархивные виды с порогом
 * (главная); задан — только среди них (поиск/продажа: видимые карточки).
 * Считается вживую из остатка — не по lowStockAlertedAt (тот — только
 * анти-спам для Telegram).
 */
export async function loadLowStock(
  db: PrismaClient,
  stoneTypeIds?: readonly string[],
  now: Date = new Date(),
): Promise<LowStockItem[]> {
  if (stoneTypeIds && stoneTypeIds.length === 0) return [];
  const types = await db.stoneType.findMany({
    where: {
      isArchived: false,
      minStockQty: { not: null },
      minStockUnit: { not: null },
      ...(stoneTypeIds ? { id: { in: [...new Set(stoneTypeIds)] } } : {}),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, minStockQty: true, minStockUnit: true },
  });
  const tracked = types
    .map((t) => ({ t, threshold: thresholdOf(t.minStockQty, t.minStockUnit) }))
    .filter((x): x is { t: (typeof types)[number]; threshold: MinStockThreshold } =>
      x.threshold !== null,
    );
  if (tracked.length === 0) return [];
  const levels = await loadStockLevels(
    db,
    tracked.map((x) => x.t.id),
    now,
  );
  const out: LowStockItem[] = [];
  for (const { t, threshold } of tracked) {
    const level = levels.get(t.id) ?? { slabs: 0, areaM2: 0 };
    if (!isBelowThreshold(threshold, level)) continue;
    out.push({
      stoneTypeId: t.id,
      name: t.name,
      threshold,
      level,
      free: freeInUnit(level, threshold.unit),
    });
  }
  return out;
}

/** Коротко для пометки «мало» в поиске/продаже: «4 плиты / 10», «12,5 м² / 20 м²». */
export function formatLowStockShort(item: Pick<LowStockItem, "threshold" | "free">): string {
  return `${formatStockQty(item.free, item.threshold.unit)} / ${formatThreshold(item.threshold)}`;
}

// ───────────────────────── Проверка пересечения ─────────────────────────

/** Внешние зависимости — подменяются в тестах. */
export interface CheckMinStockDeps {
  sendMessage: (chatId: string, text: string) => Promise<SendResult>;
  /** По умолчанию loadStockLevels(db, …). */
  loadLevels?: (ids: readonly string[], now: Date) => Promise<Map<string, StockLevel>>;
  now?: Date;
}

export interface CheckMinStockResult {
  alerted: string[];
  rearmed: string[];
  sent: number;
}

/**
 * После операции: для каждого вида решить alert / rearm / none.
 * alert — пометку ставим условно (WHERE lowStockAlertedAt IS NULL); сообщение
 * шлём только если пометку поставили МЫ (count = 1). Сообщение — всем
 * активным владельцам с привязанным Telegram; сбой отправки логируется,
 * пометка остаётся (без спама повторами).
 */
export async function checkMinStock(
  db: PrismaClient,
  stoneTypeIds: readonly string[],
  deps: CheckMinStockDeps,
): Promise<CheckMinStockResult> {
  const res: CheckMinStockResult = { alerted: [], rearmed: [], sent: 0 };
  const ids = [...new Set(stoneTypeIds.filter(Boolean))];
  if (ids.length === 0) return res;
  const now = deps.now ?? new Date();

  const types = await db.stoneType.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      minStockQty: true,
      minStockUnit: true,
      lowStockAlertedAt: true,
    },
  });
  const relevant = types.filter(
    (t) => t.lowStockAlertedAt !== null || thresholdOf(t.minStockQty, t.minStockUnit) !== null,
  );
  if (relevant.length === 0) return res;

  const levels = deps.loadLevels
    ? await deps.loadLevels(relevant.map((t) => t.id), now)
    : await loadStockLevels(db, relevant.map((t) => t.id), now);

  const messages: string[] = [];
  for (const t of relevant) {
    const threshold = thresholdOf(t.minStockQty, t.minStockUnit);
    const level = levels.get(t.id) ?? { slabs: 0, areaM2: 0 };
    const decision = decideMinStock({
      threshold,
      level,
      alerted: t.lowStockAlertedAt !== null,
    });
    if (decision === "alert" && threshold) {
      const upd = await db.stoneType.updateMany({
        where: { id: t.id, lowStockAlertedAt: null },
        data: { lowStockAlertedAt: now },
      });
      if (upd.count === 1) {
        res.alerted.push(t.id);
        messages.push(formatLowStockMessage(t.name, level, threshold));
      }
    } else if (decision === "rearm") {
      const upd = await db.stoneType.updateMany({
        where: { id: t.id, lowStockAlertedAt: { not: null } },
        data: { lowStockAlertedAt: null },
      });
      if (upd.count === 1) res.rearmed.push(t.id);
    }
  }
  if (messages.length === 0) return res;

  const owners = await db.user.findMany({
    where: { role: "OWNER", isActive: true, telegramId: { not: null } },
    select: { id: true, telegramId: true },
  });
  for (const o of owners) {
    if (!o.telegramId) continue;
    for (const text of messages) {
      try {
        const r = await deps.sendMessage(o.telegramId, text);
        if (r.ok) res.sent++;
        else console.warn(`[min-stock] Telegram владельцу ${o.id} не доставлен: ${r.error}`);
      } catch (e) {
        console.warn(`[min-stock] Telegram владельцу ${o.id} — ошибка:`, e);
      }
    }
  }
  return res;
}
