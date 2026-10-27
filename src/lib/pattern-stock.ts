// ТЗ №19 — учёт по узорам (подгруппам) во всех операциях.
//
// Единица учёта смешанной партии — УЗОР, а не партия (§2). Здесь — единый
// расчёт остатка узора и раскладка списания по его локациям. Все операции,
// уменьшающие остаток (продажа, бронь, бой, выделение плиты, образец), берут
// «свободно» узора ОТСЮДА — одно число из одного расчёта (§D).
//
// Остаток узора — зеркало формулы партии §3 (inventory.computeFreeRemainder),
// только по строкам, помеченным batchPatternId:
//
//   slabsFree  = slabsCount − slabsSold
//              − count(Slab узора, любой статус)
//              − count(Piece узора, originSlabId IS NULL)
//   areaFreeM2 = areaM2 − areaSoldM2 − Σ slab.areaM2 − Σ piece.areaM2
//                (null-площадь → площадь одной плиты узора S)
//
// Плиты пересчитываются по формату с округлением вниз (§2 п.4): продали м² без
// плит — свободных плит не больше floor(areaFree / S).
//
// Пока каждое движение несёт batchPatternId, Σ узоров = остаток партии (§D).
// Расхождение (legacy-движения до ТЗ №19) показываем как «не разнесено по
// узорам» — guard партии (sales.ts) при этом продолжает охранять деньги.
//
// Локации: BatchLocation.slabsHere — ФИЗИЧЕСКОЕ распределение (его же правит
// перенос в карточке камня). Списание уменьшает slabsHere той локации, откуда
// взяли плиту, возврат — увеличивает обратно (карта и карточка сходятся сами).

import type { Prisma, PrismaClient } from "@prisma/client";
import { formatGabarit, thicknessToNumber } from "./dimensions";
import { formatLocation } from "./locations";

const AREA_EPS = 0.001;

const m2Fmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

/** Prisma Decimal | null → number | null. */
function toNum(d: { toString(): string } | number | null | undefined): number | null {
  if (d === null || d === undefined) return null;
  return typeof d === "number" ? d : Number(d.toString());
}

/** Поля узора, нужные для расчёта остатка (числа уже без Decimal). */
export interface PatternCountersInput {
  slabsCount: number;
  areaM2: number;
  slabsSold: number;
  areaSoldM2: number;
  /** Габарит плиты узора, см (null — не указан, берём среднюю площадь). */
  lengthMm: number | null;
  widthMm: number | null;
}

/** Агрегат движений узора (как BatchRemainderAggregate, но по batchPatternId). */
export interface PatternMovementAggregate {
  slabCount: number;
  slabAreaSum: number;
  slabNullAreaCount: number;
  pieceCount: number;
  pieceAreaSum: number;
  pieceNullAreaCount: number;
}

export const EMPTY_PATTERN_AGGREGATE: PatternMovementAggregate = {
  slabCount: 0,
  slabAreaSum: 0,
  slabNullAreaCount: 0,
  pieceCount: 0,
  pieceAreaSum: 0,
  pieceNullAreaCount: 0,
};

/**
 * Площадь одной плиты узора S, м². По габариту (длина × ширина), иначе
 * средняя по приёмке (areaM2 / slabsCount). 0 — посчитать нельзя.
 */
export function patternUnitAreaM2(p: PatternCountersInput): number {
  if (p.lengthMm && p.widthMm && p.lengthMm > 0 && p.widthMm > 0) {
    return (p.lengthMm * p.widthMm) / 10_000;
  }
  return p.slabsCount > 0 ? p.areaM2 / p.slabsCount : 0;
}

/** Свободный (до броней/образцов) остаток узора. */
export interface PatternFree {
  slabsFree: number;
  areaFreeM2: number;
}

/** Формула остатка узора (см. шапку файла). Отрицательные значения не режем — это сигнал. */
export function computePatternFree(
  p: PatternCountersInput,
  agg: PatternMovementAggregate,
): PatternFree {
  const unit = patternUnitAreaM2(p);
  const countFree =
    p.slabsCount - p.slabsSold - agg.slabCount - agg.pieceCount;
  const areaFreeM2 =
    p.areaM2 -
    p.areaSoldM2 -
    (agg.slabAreaSum + agg.slabNullAreaCount * unit) -
    (agg.pieceAreaSum + agg.pieceNullAreaCount * unit);
  // §2 п.4: после продажи м² без плит — плиты по формату, округление вниз.
  const byArea =
    unit > 0 ? Math.floor((Math.max(0, areaFreeM2) + AREA_EPS) / unit) : countFree;
  return { slabsFree: Math.min(countFree, byArea), areaFreeM2 };
}

/**
 * Площадь, списываемая вместе с N плитами узора (§2 п.4): N × S, усечение до
 * 3 знаков (Decimal(12,3)) и не больше свободной площади — остаток в минус не уходит.
 */
export function areaForSlabs(
  p: PatternCountersInput,
  qtySlabs: number,
  areaFreeM2: number,
): number | null {
  const unit = patternUnitAreaM2(p);
  if (unit <= 0) return null;
  const raw = Math.floor(qtySlabs * unit * 1000) / 1000;
  const cap = Math.floor(Math.max(0, areaFreeM2) * 1000) / 1000;
  const v = Math.min(raw, cap);
  return v > 0 ? v : null;
}

/** Строка hold'а (бронь/образец) с узором. */
export interface PatternHoldRow {
  batchPatternId: string | null;
  qtySlabs: number | null;
  qtyAreaM2: number | null;
  /** null — образец (держит, пока ACTIVE, без срока). */
  expiresAt: Date | null;
}

export interface PatternHold {
  slabs: number;
  areaM2: number;
}

/** Брони (не истёкшие) + образцы → занято по узору. */
export function patternHoldsFromRows(
  rows: readonly PatternHoldRow[],
  now: Date,
): Map<string, PatternHold> {
  const out = new Map<string, PatternHold>();
  for (const r of rows) {
    if (!r.batchPatternId) continue;
    if (r.expiresAt && r.expiresAt.getTime() <= now.getTime()) continue;
    const cur = out.get(r.batchPatternId) ?? { slabs: 0, areaM2: 0 };
    cur.slabs += r.qtySlabs ?? 0;
    cur.areaM2 += r.qtyAreaM2 ?? 0;
    out.set(r.batchPatternId, cur);
  }
  return out;
}

/** Локация как источник списания. slabsHere = null — количество не ведётся. */
export interface StockLocation {
  id: string;
  block: string;
  landmark: string;
  slabsHere: number | null;
  areaHereM2: number | null;
}

/** Сколько плит берём из конкретной локации (locationId = null — место неизвестно). */
export interface LocationAllocation {
  locationId: string | null;
  block: string | null;
  landmark: string | null;
  slabs: number;
}

/**
 * Раскладка N плит по локациям узора: сначала выбранная, затем остальные по
 * порядку. Локации без счётчика (slabsHere = null) принимают остаток, если
 * других нет (старые партии «весь приход»). Не покрытое — строкой без места.
 */
export function allocateFromLocations(
  locations: readonly StockLocation[],
  qtySlabs: number,
  preferredLocationId?: string | null,
): LocationAllocation[] {
  if (qtySlabs <= 0) return [];
  const ordered = [...locations].sort((a, b) => {
    if (a.id === preferredLocationId) return -1;
    if (b.id === preferredLocationId) return 1;
    return 0;
  });
  const out: LocationAllocation[] = [];
  let left = qtySlabs;
  for (const loc of ordered) {
    if (left <= 0) break;
    if (loc.slabsHere === null) continue;
    const take = Math.min(left, Math.max(0, loc.slabsHere));
    if (take <= 0) continue;
    out.push({ locationId: loc.id, block: loc.block, landmark: loc.landmark, slabs: take });
    left -= take;
  }
  if (left > 0) {
    // Без счётчика: выбранная (или первая) «весь приход»-локация, иначе без места.
    const uncounted =
      ordered.find((l) => l.slabsHere === null && l.id === preferredLocationId) ??
      ordered.find((l) => l.slabsHere === null) ??
      null;
    out.push({
      locationId: uncounted?.id ?? null,
      block: uncounted?.block ?? null,
      landmark: uncounted?.landmark ?? null,
      slabs: left,
    });
  }
  return out;
}

/** Кандидаты-локации узора: свои строки, иначе «весь приход» (batchPatternId = null). */
export function locationsForPattern<
  T extends { batchPatternId: string | null },
>(batchLocations: readonly T[], patternId: string | null): T[] {
  if (patternId === null) return [...batchLocations];
  const own = batchLocations.filter((l) => l.batchPatternId === patternId);
  return own.length > 0 ? own : batchLocations.filter((l) => l.batchPatternId === null);
}

/** «Блок A1» / «Блок A1 · ориентир 2» / «Блок A1, A2» — для строки источника. */
export function formatLocationsShort(
  locations: readonly { block: string; landmark: string; slabsHere: number | null }[],
): string {
  const live = locations.filter((l) => l.slabsHere === null || l.slabsHere > 0);
  if (live.length === 0) return "локация не указана";
  if (live.length === 1) return formatLocation(live[0].block, live[0].landmark);
  return `Блок ${live.map((l) => (l.landmark ? `${l.block}·${l.landmark}` : l.block)).join(", ")}`;
}

/**
 * Единая строка источника (§B):
 *   «Травертин Классик · ТЕСТ светлый 2см · 280×160×2 см · свободно 3 пл. / 13,4 м² · Блок A1»
 * Однородная партия — без описания узора (description = null).
 */
export function formatSourceLine(args: {
  stoneName?: string | null;
  description?: string | null;
  lengthMm: number | null;
  widthMm: number | null;
  thicknessMm: number | null;
  slabsFree: number | null;
  areaFreeM2: number | null;
  locationText?: string | null;
}): string {
  const parts: string[] = [];
  if (args.stoneName) parts.push(args.stoneName);
  if (args.description) parts.push(args.description);
  if (args.lengthMm != null && args.widthMm != null) {
    parts.push(formatGabarit(args.lengthMm, args.widthMm, args.thicknessMm));
  }
  const qty: string[] = [];
  if (args.slabsFree !== null) qty.push(`${Math.max(0, args.slabsFree)} пл.`);
  if (args.areaFreeM2 !== null) qty.push(`${m2Fmt.format(Math.max(0, args.areaFreeM2))} м²`);
  if (qty.length > 0) parts.push(`свободно ${qty.join(" / ")}`);
  if (args.locationText) parts.push(args.locationText);
  return parts.join(" · ");
}

/** Полная картина узора для витрин и охраны. */
export interface PatternStock {
  id: string;
  batchId: string;
  description: string;
  lengthMm: number | null;
  widthMm: number | null;
  thicknessMm: number | null;
  slabsCount: number;
  areaM2: number;
  slabsSold: number;
  areaSoldM2: number;
  unitAreaM2: number;
  /** До броней/образцов. */
  slabsFree: number;
  areaFreeM2: number;
  hold: PatternHold;
  /** Можно продать/забронировать/выделить: free − hold, не меньше 0. */
  availableSlabs: number;
  availableAreaM2: number;
  locations: (StockLocation & { batchPatternId: string | null })[];
}

type StockDb = Pick<
  PrismaClient,
  "batchPattern" | "slab" | "piece" | "reservation" | "sample" | "batchLocation"
>;

/** Reader внутри транзакции или вне её — оба удовлетворяют этой форме. */
type StockReader = StockDb | Prisma.TransactionClient;

/**
 * Остатки всех узоров указанных партий (map patternId → PatternStock).
 * Партии без узоров в map не попадают — для них действует формула партии.
 */
export async function loadPatternStock(
  reader: StockReader,
  batchIds: readonly string[],
  now: Date = new Date(),
): Promise<Map<string, PatternStock>> {
  const out = new Map<string, PatternStock>();
  if (batchIds.length === 0) return out;
  const ids = [...batchIds];

  const patterns = await reader.batchPattern.findMany({
    where: { batchId: { in: ids } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      batchId: true,
      description: true,
      lengthMm: true,
      widthMm: true,
      thicknessMm: true,
      slabsCount: true,
      areaM2: true,
      slabsSold: true,
      areaSoldM2: true,
    },
  });
  if (patterns.length === 0) return out;
  const patternIds = patterns.map((p) => p.id);

  const [slabGroups, pieceGroups, reservations, samples, locations] =
    await Promise.all([
      reader.slab.groupBy({
        by: ["batchPatternId"],
        where: { batchPatternId: { in: patternIds } },
        _count: { _all: true, areaM2: true },
        _sum: { areaM2: true },
      }),
      reader.piece.groupBy({
        by: ["batchPatternId"],
        where: { batchPatternId: { in: patternIds }, originSlabId: null },
        _count: { _all: true, areaM2: true },
        _sum: { areaM2: true },
      }),
      reader.reservation.findMany({
        where: {
          status: "ACTIVE",
          targetType: "BATCH_VOLUME",
          batchPatternId: { in: patternIds },
          expiresAt: { gt: now },
        },
        select: { batchPatternId: true, qtySlabs: true, qtyAreaM2: true, expiresAt: true },
      }),
      reader.sample.findMany({
        where: {
          status: "ACTIVE",
          targetType: "BATCH_VOLUME",
          batchPatternId: { in: patternIds },
        },
        select: { batchPatternId: true, qtySlabs: true, qtyAreaM2: true },
      }),
      reader.batchLocation.findMany({
        where: { batchId: { in: ids } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          batchId: true,
          block: true,
          landmark: true,
          slabsHere: true,
          areaHereM2: true,
          batchPatternId: true,
        },
      }),
    ]);

  const aggs = new Map<string, PatternMovementAggregate>();
  const aggFor = (id: string) => {
    let a = aggs.get(id);
    if (!a) {
      a = { ...EMPTY_PATTERN_AGGREGATE };
      aggs.set(id, a);
    }
    return a;
  };
  for (const g of slabGroups) {
    if (!g.batchPatternId) continue;
    const a = aggFor(g.batchPatternId);
    a.slabCount = g._count._all;
    a.slabAreaSum = toNum(g._sum.areaM2) ?? 0;
    a.slabNullAreaCount = g._count._all - g._count.areaM2;
  }
  for (const g of pieceGroups) {
    if (!g.batchPatternId) continue;
    const a = aggFor(g.batchPatternId);
    a.pieceCount = g._count._all;
    a.pieceAreaSum = toNum(g._sum.areaM2) ?? 0;
    a.pieceNullAreaCount = g._count._all - g._count.areaM2;
  }

  const holds = patternHoldsFromRows(
    [
      ...reservations.map((r) => ({
        batchPatternId: r.batchPatternId,
        qtySlabs: r.qtySlabs,
        qtyAreaM2: toNum(r.qtyAreaM2),
        expiresAt: r.expiresAt,
      })),
      ...samples.map((s) => ({
        batchPatternId: s.batchPatternId,
        qtySlabs: s.qtySlabs,
        qtyAreaM2: toNum(s.qtyAreaM2),
        expiresAt: null,
      })),
    ],
    now,
  );

  const locByBatch = new Map<string, typeof locations>();
  for (const l of locations) {
    const arr = locByBatch.get(l.batchId) ?? [];
    arr.push(l);
    locByBatch.set(l.batchId, arr);
  }

  for (const p of patterns) {
    const counters: PatternCountersInput = {
      slabsCount: p.slabsCount,
      areaM2: toNum(p.areaM2) ?? 0,
      slabsSold: p.slabsSold,
      areaSoldM2: toNum(p.areaSoldM2) ?? 0,
      lengthMm: p.lengthMm,
      widthMm: p.widthMm,
    };
    const free = computePatternFree(counters, aggs.get(p.id) ?? EMPTY_PATTERN_AGGREGATE);
    const hold = holds.get(p.id) ?? { slabs: 0, areaM2: 0 };
    const locs = locationsForPattern(locByBatch.get(p.batchId) ?? [], p.id).map(
      (l) => ({
        id: l.id,
        block: l.block,
        landmark: l.landmark,
        slabsHere: l.slabsHere,
        areaHereM2: toNum(l.areaHereM2),
        batchPatternId: l.batchPatternId,
      }),
    );
    out.set(p.id, {
      id: p.id,
      batchId: p.batchId,
      description: p.description,
      thicknessMm: thicknessToNumber(p.thicknessMm),
      ...counters,
      unitAreaM2: patternUnitAreaM2(counters),
      slabsFree: free.slabsFree,
      areaFreeM2: free.areaFreeM2,
      hold,
      availableSlabs: Math.max(0, free.slabsFree - hold.slabs),
      availableAreaM2: Math.max(0, free.areaFreeM2 - hold.areaM2),
      locations: locs,
    });
  }
  return out;
}

/** Узоры одной партии в порядке приёмки. */
export function patternsOfBatch(
  stock: ReadonlyMap<string, PatternStock>,
  batchId: string,
): PatternStock[] {
  return [...stock.values()].filter((p) => p.batchId === batchId);
}

/**
 * Охрана списания из узора: qty ≤ доступно (free − hold). Возвращает текст
 * ошибки или null. extraHold — hold, который этой операцией погашается
 * (своя бронь при продаже) — возвращается в доступное.
 */
export function checkPatternAvailable(
  p: Pick<PatternStock, "slabsFree" | "areaFreeM2" | "hold">,
  qtySlabs: number | null,
  qtyAreaM2: number | null,
  released: PatternHold = { slabs: 0, areaM2: 0 },
): string | null {
  const slabsAvail = p.slabsFree - (p.hold.slabs - released.slabs);
  const areaAvail = p.areaFreeM2 - (p.hold.areaM2 - released.areaM2);
  if (qtySlabs !== null && qtySlabs > slabsAvail) {
    return `В узоре столько нет: свободно ${Math.max(0, slabsAvail)} плит`;
  }
  if (qtyAreaM2 !== null && qtyAreaM2 > areaAvail + AREA_EPS) {
    return `В узоре столько нет: свободно ≈${m2Fmt.format(Math.max(0, areaAvail))} м²`;
  }
  return null;
}

/** Текст места для задачи складчику / накладной («Блок A1 · ориентир —» если неизвестно). */
export function allocationLocationText(a: LocationAllocation): string {
  if (!a.block) return "локация не указана";
  return formatLocation(a.block, a.landmark);
}

/**
 * Списание из локаций (в транзакции, под row-lock партии): slabsHere −= n,
 * areaHereM2 −= n × S (не ниже 0). Локации без счётчика не трогаем.
 */
export async function takeFromLocationsInTx(
  tx: Prisma.TransactionClient,
  allocations: readonly LocationAllocation[],
  unitAreaM2: number,
): Promise<void> {
  for (const a of allocations) {
    if (!a.locationId || a.slabs <= 0) continue;
    const loc = await tx.batchLocation.findUnique({
      where: { id: a.locationId },
      select: { slabsHere: true, areaHereM2: true },
    });
    if (!loc || loc.slabsHere === null) continue;
    const area = toNum(loc.areaHereM2);
    await tx.batchLocation.update({
      where: { id: a.locationId },
      data: {
        slabsHere: Math.max(0, loc.slabsHere - a.slabs),
        ...(area !== null
          ? { areaHereM2: Math.max(0, area - a.slabs * unitAreaM2).toFixed(3) }
          : {}),
      },
    });
  }
}

/** Возврат в те же локации (реверс takeFromLocationsInTx). */
export async function returnToLocationsInTx(
  tx: Prisma.TransactionClient,
  allocations: readonly { locationId: string | null; slabs: number }[],
  unitAreaM2: number,
): Promise<void> {
  for (const a of allocations) {
    if (!a.locationId || a.slabs <= 0) continue;
    const loc = await tx.batchLocation.findUnique({
      where: { id: a.locationId },
      select: { slabsHere: true, areaHereM2: true },
    });
    if (!loc || loc.slabsHere === null) continue;
    const area = toNum(loc.areaHereM2);
    await tx.batchLocation.update({
      where: { id: a.locationId },
      data: {
        slabsHere: loc.slabsHere + a.slabs,
        ...(area !== null ? { areaHereM2: (area + a.slabs * unitAreaM2).toFixed(3) } : {}),
      },
    });
  }
}

/** Есть ли у партии узоры (смешанная партия → списание только через узор). */
export async function batchHasPatterns(
  reader: Pick<StockDb, "batchPattern"> | Prisma.TransactionClient,
  batchId: string,
): Promise<boolean> {
  const n = await reader.batchPattern.count({ where: { batchId } });
  return n > 0;
}
