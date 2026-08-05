// TZ №10+11 Этап 5 — сводка владельца: топы + B2B/B2C за период.
// Суммы из SaleRecord (returnedAt == null). UZS и USD никогда не складываются.
// Pure helpers unit-tested; DB loader for /svodka.

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  sumMoneyByCurrency,
  type CurrencyMoney,
  type MoneyCurrency,
} from "@/lib/clients";
import {
  isActiveSale,
  purchaseTotalsFromSales,
  volumeTotalsFromSales,
  type SaleTotRow,
} from "@/lib/clients-directory";
import {
  parseTashkentDayEnd,
  parseTashkentDayStart,
} from "@/lib/sale-history";
import { todayTashkentISO } from "@/lib/datetime";

type Db = PrismaClient | Prisma.TransactionClient;

/** Sale row for owner ranking / B2B split. */
export type OwnerSummarySale = SaleTotRow & {
  id: string;
  soldAt: Date;
  clientId: string | null;
  siteId: string | null;
  /** null = legacy text-only sale (no Client card). */
  clientType: "B2B" | "B2C" | null;
  clientName: string | null;
  siteName: string | null;
};

export type PeriodBounds = { from: Date; to: Date; fromISO: string; toISO: string };

/**
 * Default period: current Asia/Tashkent calendar month [from 00:00, to 23:59:59.999].
 */
export function defaultMonthPeriod(now: Date = new Date()): PeriodBounds {
  const today = todayTashkentISO(now); // YYYY-MM-DD
  const [y, m] = today.split("-").map(Number);
  const fromISO = `${y}-${String(m).padStart(2, "0")}-01`;
  // last day of month in Tashkent: day 0 of next month
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12; Date.UTC month 0-11 → m is next month index if we use m as month number...
  // Date.UTC(y, m, 0) where m is 1-based month number: Date.UTC(2026, 8, 0) = last day of month 7 (August) if m=8.
  // today month m from ISO is 1-12. Date.UTC(year, monthIndex, 0) = last day of monthIndex (1-based month = monthIndex).
  // For August (m=8): Date.UTC(2026, 8, 0) = last day of July. Wrong.
  // Correct: Date.UTC(y, m, 0) with m as 1-based: use Date.UTC(y, m, 0) where second arg is monthIndex = m (since day 0 of month m (0-based m) = last of month m-1...).
  // month index for current month = m - 1. Last day: Date.UTC(y, m, 0) where m is 1-based month number = day 0 of next month index m.
  // Example: August m=8 → Date.UTC(2026, 8, 0) = last day of month index 7 = July 31. STILL WRONG.
  // Date.UTC(2026, 8, 0): monthIndex 8 = September, day 0 = last day of August. YES! Because m=8 means September index, day 0 = Aug 31.
  // So Date.UTC(y, m, 0) with m from ISO (1-12) works: m=8 → monthIndex 8 = September → day 0 = Aug 31.
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const toISO = `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  const from = parseTashkentDayStart(fromISO)!;
  const to = parseTashkentDayEnd(toISO)!;
  return { from, to, fromISO, toISO };
}

/** Parse ?from=&to= YYYY-MM-DD; fall back to current month. */
export function periodFromSearchParams(
  fromRaw: string,
  toRaw: string,
  now: Date = new Date(),
): PeriodBounds {
  const from = fromRaw ? parseTashkentDayStart(fromRaw) : null;
  const to = toRaw ? parseTashkentDayEnd(toRaw) : null;
  if (from && to && from.getTime() <= to.getTime()) {
    return {
      from,
      to,
      fromISO: fromRaw.trim(),
      toISO: toRaw.trim(),
    };
  }
  return defaultMonthPeriod(now);
}

/** Inclusive soldAt in [from, to]; active only (not returned). */
export function salesInPeriod(
  sales: ReadonlyArray<OwnerSummarySale>,
  period: { from: Date; to: Date },
): OwnerSummarySale[] {
  return sales.filter((s) => {
    if (!isActiveSale(s)) return false;
    const t = s.soldAt.getTime();
    return t >= period.from.getTime() && t <= period.to.getTime();
  });
}

function moneyCents(amount: string): bigint {
  const s = amount.trim().replace(",", ".");
  const m = /^(-?)(\d+)(?:\.(\d{0,2})\d*)?$/.exec(s);
  if (!m) return 0n;
  const whole = BigInt(m[2] || "0");
  const frac = BigInt(((m[3] ?? "") + "00").slice(0, 2));
  let c = whole * 100n + frac;
  if (m[1] === "-") c = -c;
  return c;
}

function amountOf(totals: CurrencyMoney[], currency: MoneyCurrency): bigint {
  const row = totals.find((r) => r.currency === currency);
  return row ? moneyCents(row.amount) : 0n;
}

/**
 * Rank entities by revenue. UZS and USD never summed for ranking:
 * primary key = UZS cents desc, secondary = USD cents desc, then saleCount.
 */
export function rankByRevenue<T extends { totals: CurrencyMoney[]; saleCount: number }>(
  rows: T[],
  limit = 10,
): T[] {
  return [...rows]
    .sort((a, b) => {
      const du = amountOf(b.totals, "UZS") - amountOf(a.totals, "UZS");
      if (du !== 0n) return du > 0n ? 1 : -1;
      const dd = amountOf(b.totals, "USD") - amountOf(a.totals, "USD");
      if (dd !== 0n) return dd > 0n ? 1 : -1;
      return b.saleCount - a.saleCount;
    })
    .slice(0, limit);
}

export type ClientRankRow = {
  key: string;
  clientId: string | null;
  name: string;
  clientType: "B2B" | "B2C" | null;
  totals: CurrencyMoney[];
  volume: { qtySlabs: number; qtyAreaM2: string; saleCount: number };
  saleCount: number;
  /** Legacy sales without Client card. */
  unlinked: boolean;
};

/** Aggregate active period sales by client; unlinked bucket for null clientId. */
export function buildClientRanks(
  sales: ReadonlyArray<OwnerSummarySale>,
): ClientRankRow[] {
  const map = new Map<string, OwnerSummarySale[]>();
  for (const s of sales) {
    const key = s.clientId ?? "__unlinked__";
    const arr = map.get(key) ?? [];
    arr.push(s);
    map.set(key, arr);
  }
  const rows: ClientRankRow[] = [];
  for (const [key, list] of map) {
    const unlinked = key === "__unlinked__";
    const first = list[0];
    const totRows: SaleTotRow[] = list;
    const volume = volumeTotalsFromSales(totRows);
    rows.push({
      key,
      clientId: unlinked ? null : first.clientId,
      name: unlinked
        ? "Без карточки клиента"
        : (first.clientName ?? "Клиент"),
      clientType: unlinked ? null : first.clientType,
      totals: purchaseTotalsFromSales(totRows),
      volume,
      saleCount: volume.saleCount,
      unlinked,
    });
  }
  return rows;
}

export type SiteRankRow = {
  siteId: string;
  name: string;
  clientName: string | null;
  totals: CurrencyMoney[];
  volume: { qtySlabs: number; qtyAreaM2: string; saleCount: number };
  saleCount: number;
};

/** Only sales with siteId (private sales without object excluded). */
export function buildSiteRanks(
  sales: ReadonlyArray<OwnerSummarySale>,
): SiteRankRow[] {
  const map = new Map<string, OwnerSummarySale[]>();
  for (const s of sales) {
    if (!s.siteId) continue;
    const arr = map.get(s.siteId) ?? [];
    arr.push(s);
    map.set(s.siteId, arr);
  }
  const rows: SiteRankRow[] = [];
  for (const [siteId, list] of map) {
    const first = list[0];
    const volume = volumeTotalsFromSales(list);
    rows.push({
      siteId,
      name: first.siteName ?? "Объект",
      clientName: first.clientName,
      totals: purchaseTotalsFromSales(list),
      volume,
      saleCount: volume.saleCount,
    });
  }
  return rows;
}

/**
 * B2B vs B2C split (TZ §9):
 * - B2B: clientType B2B OR sale has siteId (стройка)
 * - B2C: everyone else among linked sales (B2C private / no site)
 * - unlinked: no clientId — separate, not attributed to B2B/B2C
 *
 * Money and volume never cross currencies / never mix B2B+B2C into one number.
 */
export type SegmentTotals = {
  totals: CurrencyMoney[];
  volume: { qtySlabs: number; qtyAreaM2: string; saleCount: number };
};

export function b2bVsB2cSplit(sales: ReadonlyArray<OwnerSummarySale>): {
  b2b: SegmentTotals;
  b2c: SegmentTotals;
  unlinked: SegmentTotals;
} {
  const b2b: OwnerSummarySale[] = [];
  const b2c: OwnerSummarySale[] = [];
  const unlinked: OwnerSummarySale[] = [];
  for (const s of sales) {
    if (s.clientId == null) {
      unlinked.push(s);
      continue;
    }
    const isB2b = s.clientType === "B2B" || s.siteId != null;
    if (isB2b) b2b.push(s);
    else b2c.push(s);
  }
  const seg = (list: OwnerSummarySale[]): SegmentTotals => ({
    totals: purchaseTotalsFromSales(list),
    volume: volumeTotalsFromSales(list),
  });
  return { b2b: seg(b2b), b2c: seg(b2c), unlinked: seg(unlinked) };
}

export type OwnerSummary = {
  period: PeriodBounds;
  topClients: ClientRankRow[];
  topSites: SiteRankRow[];
  segments: ReturnType<typeof b2bVsB2cSplit>;
  /** Period-wide active revenue (per currency). */
  grandTotals: CurrencyMoney[];
  saleCount: number;
};

/** Pure: compute full summary from sale list + period. */
export function computeOwnerSummary(
  sales: ReadonlyArray<OwnerSummarySale>,
  period: PeriodBounds,
  limit = 10,
): OwnerSummary {
  const inPeriod = salesInPeriod(sales, period);
  const clients = rankByRevenue(buildClientRanks(inPeriod), limit);
  const sites = rankByRevenue(buildSiteRanks(inPeriod), limit);
  const segments = b2bVsB2cSplit(inPeriod);
  const grandTotals = purchaseTotalsFromSales(inPeriod);
  const vol = volumeTotalsFromSales(inPeriod);
  return {
    period,
    topClients: clients,
    topSites: sites,
    segments,
    grandTotals,
    saleCount: vol.saleCount,
  };
}

/** Load sales for period from DB and compute summary. */
export async function loadOwnerSummary(
  db: Db,
  args: {
    fromISO: string;
    toISO: string;
    now?: Date;
    limit?: number;
  },
): Promise<OwnerSummary> {
  const period = periodFromSearchParams(
    args.fromISO,
    args.toISO,
    args.now ?? new Date(),
  );

  const rows = await db.saleRecord.findMany({
    where: {
      soldAt: { gte: period.from, lte: period.to },
      // Include returned for pure filter consistency; filter in compute.
      // Actually we can exclude returned in SQL for efficiency:
      returnedAt: null,
    },
    select: {
      id: true,
      soldAt: true,
      returnedAt: true,
      price: true,
      currency: true,
      qtySlabs: true,
      qtyAreaM2: true,
      clientId: true,
      siteId: true,
      customerName: true,
      client: { select: { name: true, type: true } },
      site: { select: { name: true } },
    },
    orderBy: { soldAt: "desc" },
    take: 5000,
  });

  const sales: OwnerSummarySale[] = rows.map((r) => ({
    id: r.id,
    soldAt: r.soldAt,
    returnedAt: r.returnedAt,
    price: r.price?.toString() ?? null,
    currency: (r.currency as MoneyCurrency | null) ?? null,
    qtySlabs: r.qtySlabs,
    qtyAreaM2: r.qtyAreaM2?.toString() ?? null,
    clientId: r.clientId,
    siteId: r.siteId,
    clientType: (r.client?.type as "B2B" | "B2C" | undefined) ?? null,
    clientName: r.client?.name ?? r.customerName,
    siteName: r.site?.name ?? null,
  }));

  return computeOwnerSummary(sales, period, args.limit ?? 10);
}
