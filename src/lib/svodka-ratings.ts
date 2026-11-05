// ТЗ №20 E — «Сводка»: рейтинг клиентов и продажи по менеджерам.
// Агрегация на стороне БД (groupBy), сборка строк — чистые функции (тесты без БД).
// Правила: возвраты (returnedAt != null) не входят; UZS и USD НИКОГДА не
// складываются и не пересчитываются друг в друга; долг — текущий остаток
// ACTIVE-долгов (amount − repaidAmount), без привязки к периоду.

import { netDecStr } from "./sale-net";
import type { Prisma, PrismaClient } from "@prisma/client";
import { clientListScope, type MoneyCurrency } from "@/lib/clients";
import { todayTashkentISO } from "@/lib/datetime";

type Db = PrismaClient | Prisma.TransactionClient;
type Dec = { toString(): string } | null | undefined;

// ───────────────────────── Период ─────────────────────────

export type RatingPeriodKey = "month" | "prev-month" | "quarter" | "year" | "all";

export const RATING_PERIODS: ReadonlyArray<{ key: RatingPeriodKey; label: string }> = [
  { key: "month", label: "Этот месяц" },
  { key: "prev-month", label: "Прошлый месяц" },
  { key: "quarter", label: "Квартал" },
  { key: "year", label: "Год" },
  { key: "all", label: "Всё время" },
];

export function parseRatingPeriodKey(raw: string | null | undefined): RatingPeriodKey {
  const k = (raw ?? "").trim();
  return RATING_PERIODS.some((p) => p.key === k) ? (k as RatingPeriodKey) : "month";
}

/** Период: [from, toExclusive). null-границы = «всё время». */
export type RatingPeriod = {
  key: RatingPeriodKey;
  from: Date | null;
  toExclusive: Date | null;
  /** Человекочитаемые границы (Asia/Tashkent), включительно. */
  fromISO: string | null;
  toISO: string | null;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Первый день месяца (y, m 1-based; m может выйти за 1..12 — нормализуем). */
function monthStartISO(y: number, m: number): string {
  const d = new Date(Date.UTC(y, m - 1, 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-01`;
}

function tashkentStart(iso: string): Date {
  return new Date(`${iso}T00:00:00.000+05:00`);
}

/** ISO-дата за день до `iso` (для подписи «по …» включительно). */
function dayBeforeISO(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Быстрые периоды по ташкентскому календарю (UTC+5, без DST):
 * месяц / прошлый месяц / текущий квартал / текущий год / всё время.
 */
export function resolveRatingPeriod(
  key: RatingPeriodKey,
  now: Date = new Date(),
): RatingPeriod {
  if (key === "all") {
    return { key, from: null, toExclusive: null, fromISO: null, toISO: null };
  }
  const [y, m] = todayTashkentISO(now).split("-").map(Number);
  let startISO: string;
  let endExclISO: string;
  if (key === "month") {
    startISO = monthStartISO(y, m);
    endExclISO = monthStartISO(y, m + 1);
  } else if (key === "prev-month") {
    startISO = monthStartISO(y, m - 1);
    endExclISO = monthStartISO(y, m);
  } else if (key === "quarter") {
    const qStart = Math.floor((m - 1) / 3) * 3 + 1;
    startISO = monthStartISO(y, qStart);
    endExclISO = monthStartISO(y, qStart + 3);
  } else {
    startISO = `${y}-01-01`;
    endExclISO = `${y + 1}-01-01`;
  }
  return {
    key,
    from: tashkentStart(startISO),
    toExclusive: tashkentStart(endExclISO),
    fromISO: startISO,
    toISO: dayBeforeISO(endExclISO),
  };
}

function rangeWhere(p: RatingPeriod): { gte?: Date; lt?: Date } | undefined {
  if (!p.from || !p.toExclusive) return undefined;
  return { gte: p.from, lt: p.toExclusive };
}

// ───────────────────────── Деньги / площадь ─────────────────────────

/** Decimal-строка → копейки (BigInt). Мусор → 0n. */
export function decToCents(v: Dec): bigint {
  if (v == null) return 0n;
  const m = /^(-?)(\d+)(?:\.(\d{0,2})\d*)?$/.exec(v.toString().trim().replace(",", "."));
  if (!m) return 0n;
  const c = BigInt(m[2] || "0") * 100n + BigInt(((m[3] ?? "") + "00").slice(0, 2));
  return m[1] === "-" ? -c : c;
}

/** Decimal-строка м² → тысячные доли (BigInt). */
export function decToMilli(v: Dec): bigint {
  if (v == null) return 0n;
  const m = /^(-?)(\d+)(?:\.(\d{0,3})\d*)?$/.exec(v.toString().trim().replace(",", "."));
  if (!m) return 0n;
  const c = BigInt(m[2] || "0") * 1000n + BigInt(((m[3] ?? "") + "000").slice(0, 3));
  return m[1] === "-" ? -c : c;
}

export function centsToStr(c: bigint): string {
  const neg = c < 0n;
  const a = neg ? -c : c;
  const body = `${a / 100n}.${(a % 100n).toString().padStart(2, "0")}`;
  return neg ? `-${body}` : body;
}

export function milliToStr(c: bigint): string {
  const neg = c < 0n;
  const a = neg ? -c : c;
  const body = `${a / 1000n}.${(a % 1000n).toString().padStart(3, "0")}`;
  return neg ? `-${body}` : body;
}

/** Суммы по валютам — две отдельные ячейки, никогда не одно число. */
export type PerCurrency = { UZS: string; USD: string };

function isCur(c: unknown): c is MoneyCurrency {
  return c === "UZS" || c === "USD";
}

// ───────────────────────── Сырые группы из БД ─────────────────────────

/** saleRecord.groupBy по (ключ, currency) — только активные продажи. */
export type SaleGroup = {
  key: string | null;
  currency: string | null;
  priceSum: Dec;
  areaSum: Dec;
  count: number;
};

/** debt.groupBy по (ключ, currency) — только ACTIVE. */
export type DebtGroup = {
  key: string | null;
  currency: string;
  amountSum: Dec;
  repaidSum: Dec;
};

/** payment.groupBy по (currency, kind) для одного ключа (менеджера). */
export type PaymentGroup = {
  key: string;
  currency: string;
  kind: "PAYMENT" | "REFUND" | string;
  amountSum: Dec;
};

type Acc = {
  sold: Record<MoneyCurrency, bigint>;
  areaMilli: bigint;
  saleCount: number;
};

function accumulateSales(groups: ReadonlyArray<SaleGroup>): Map<string, Acc> {
  const map = new Map<string, Acc>();
  for (const g of groups) {
    if (g.key == null) continue;
    const a =
      map.get(g.key) ?? { sold: { UZS: 0n, USD: 0n }, areaMilli: 0n, saleCount: 0 };
    // Продажа без валюты (legacy) идёт в счётчик и м², но не в деньги.
    if (isCur(g.currency)) a.sold[g.currency] += decToCents(g.priceSum);
    a.areaMilli += decToMilli(g.areaSum);
    a.saleCount += g.count;
    map.set(g.key, a);
  }
  return map;
}

/** Остаток долга по ключу и валюте: Σamount − ΣrepaidAmount (не ниже 0). */
function accumulateDebts(groups: ReadonlyArray<DebtGroup>): Map<string, Record<MoneyCurrency, bigint>> {
  const map = new Map<string, Record<MoneyCurrency, bigint>>();
  for (const g of groups) {
    if (g.key == null || !isCur(g.currency)) continue;
    const d = map.get(g.key) ?? { UZS: 0n, USD: 0n };
    const rest = decToCents(g.amountSum) - decToCents(g.repaidSum);
    d[g.currency] += rest > 0n ? rest : 0n;
    map.set(g.key, d);
  }
  return map;
}

function toPer(r: Record<MoneyCurrency, bigint>): PerCurrency {
  return { UZS: centsToStr(r.UZS), USD: centsToStr(r.USD) };
}

// ───────────────────────── Рейтинг клиентов ─────────────────────────

export type RatingSort = "amount" | "area" | "count";

export function parseRatingSort(raw: string | null | undefined): RatingSort {
  return raw === "area" || raw === "count" ? raw : "amount";
}

export function parseRatingCurrency(raw: string | null | undefined): MoneyCurrency {
  return raw === "USD" ? "USD" : "UZS";
}

export type ClientRatingRow = {
  place: number;
  clientId: string;
  name: string;
  type: "B2B" | "B2C" | null;
  sold: PerCurrency;
  areaM2: string;
  saleCount: number;
  debt: PerCurrency;
};

/**
 * Чистая сборка рейтинга. Сортировка:
 * - amount — по сумме В ВЫБРАННОЙ валюте (другая валюта не участвует);
 * - area — по м²; count — по числу продаж.
 * Ничьи: число продаж → м² → имя (стабильно).
 */
export function buildClientRating(args: {
  sales: ReadonlyArray<SaleGroup>;
  debts: ReadonlyArray<DebtGroup>;
  clients: ReadonlyArray<{ id: string; name: string; type: string }>;
  sort: RatingSort;
  currency: MoneyCurrency;
}): ClientRatingRow[] {
  const acc = accumulateSales(args.sales);
  const debts = accumulateDebts(args.debts);
  const info = new Map(args.clients.map((c) => [c.id, c]));
  const rows = [...acc.entries()].map(([id, a]) => {
    const c = info.get(id);
    return {
      id,
      a,
      name: c?.name ?? "Клиент",
      type: c?.type === "B2B" || c?.type === "B2C" ? (c.type as "B2B" | "B2C") : null,
    };
  });
  const cmpBig = (x: bigint, y: bigint) => (x === y ? 0 : x > y ? -1 : 1);
  rows.sort((x, y) => {
    let d = 0;
    if (args.sort === "amount") d = cmpBig(x.a.sold[args.currency], y.a.sold[args.currency]);
    else if (args.sort === "area") d = cmpBig(x.a.areaMilli, y.a.areaMilli);
    else d = y.a.saleCount - x.a.saleCount;
    if (d !== 0) return d;
    d = y.a.saleCount - x.a.saleCount;
    if (d !== 0) return d;
    d = cmpBig(x.a.areaMilli, y.a.areaMilli);
    if (d !== 0) return d;
    return x.name.localeCompare(y.name, "ru");
  });
  return rows.map((r, i) => ({
    place: i + 1,
    clientId: r.id,
    name: r.name,
    type: r.type,
    sold: toPer(r.a.sold),
    areaM2: milliToStr(r.a.areaMilli),
    saleCount: r.a.saleCount,
    debt: toPer(debts.get(r.id) ?? { UZS: 0n, USD: 0n }),
  }));
}

/**
 * DB: рейтинг клиентов за период.
 * Скоуп — тот же, что в «Клиентах» (`clientListScope`): владелец — все,
 * менеджер — только клиенты с Client.managerId = он. Продажи без карточки
 * клиента (legacy) в рейтинг не входят.
 */
export async function loadClientRating(
  db: Db,
  args: {
    period: RatingPeriod;
    sort: RatingSort;
    currency: MoneyCurrency;
    canSeeAllClients: boolean;
    actorId: string | null;
  },
): Promise<ClientRatingRow[]> {
  const scope = clientListScope({
    canSeeAllClients: args.canSeeAllClients,
    actorId: args.actorId,
  });
  const range = rangeWhere(args.period);
  const where: Prisma.SaleRecordWhereInput = {
    returnedAt: null,
    clientId: { not: null },
    ...(range ? { soldAt: range } : {}),
    ...(scope.managerId ? { client: { managerId: scope.managerId } } : {}),
  };
  const grouped = await db.saleRecord.groupBy({
    by: ["clientId", "currency"],
    where,
    _sum: { price: true, qtyAreaM2: true, returnedAmount: true, returnedAreaM2: true },
    _count: { _all: true },
  });
  // ТЗ №20 F — частичные возвраты вычитаются из суммы и м².
  const sales: SaleGroup[] = grouped.map((g) => ({
    key: g.clientId,
    currency: g.currency,
    priceSum: netDecStr(g._sum.price, g._sum.returnedAmount, 2),
    areaSum: netDecStr(g._sum.qtyAreaM2, g._sum.returnedAreaM2, 3),
    count: g._count._all,
  }));
  const ids = [...new Set(sales.map((s) => s.key).filter((k): k is string => !!k))];
  if (ids.length === 0) return [];

  const [clients, debtGroups] = await Promise.all([
    db.client.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, type: true },
    }),
    db.debt.groupBy({
      by: ["clientId", "currency"],
      where: { status: "ACTIVE", clientId: { in: ids } },
      _sum: { amount: true, repaidAmount: true },
    }),
  ]);
  const debts: DebtGroup[] = debtGroups.map((g) => ({
    key: g.clientId,
    currency: g.currency,
    amountSum: g._sum.amount,
    repaidSum: g._sum.repaidAmount,
  }));
  return buildClientRating({
    sales,
    debts,
    clients,
    sort: args.sort,
    currency: args.currency,
  });
}

// ───────────────────────── Продажи по менеджерам ─────────────────────────

export type ManagerSalesRow = {
  managerId: string;
  name: string;
  isActive: boolean;
  saleCount: number;
  sold: PerCurrency;
  /** Σ PAYMENT − Σ REFUND с paidAt в периоде, по продажам этого менеджера. */
  collected: PerCurrency;
  areaM2: string;
  /** Текущий остаток ACTIVE-долгов по его продажам. */
  debt: PerCurrency;
};

/**
 * Чистая сборка блока «Продажи по менеджерам». Менеджер без продаж, без
 * поступлений за период и без долга не показывается. Порядок: число продаж ↓,
 * затем имя.
 */
export function buildManagerSales(args: {
  sales: ReadonlyArray<SaleGroup>;
  payments: ReadonlyArray<PaymentGroup>;
  debts: ReadonlyArray<DebtGroup>;
  managers: ReadonlyArray<{ id: string; name: string; isActive: boolean }>;
}): ManagerSalesRow[] {
  const acc = accumulateSales(args.sales);
  const debts = accumulateDebts(args.debts);
  const collected = new Map<string, Record<MoneyCurrency, bigint>>();
  for (const p of args.payments) {
    if (!isCur(p.currency)) continue;
    const c = collected.get(p.key) ?? { UZS: 0n, USD: 0n };
    const v = decToCents(p.amountSum);
    if (p.kind === "REFUND") c[p.currency] -= v;
    else if (p.kind === "PAYMENT") c[p.currency] += v;
    collected.set(p.key, c);
  }
  const zero = () => ({ UZS: 0n, USD: 0n });
  const rows: ManagerSalesRow[] = [];
  for (const m of args.managers) {
    const a = acc.get(m.id);
    const col = collected.get(m.id) ?? zero();
    const debt = debts.get(m.id) ?? zero();
    const empty =
      !a && col.UZS === 0n && col.USD === 0n && debt.UZS === 0n && debt.USD === 0n;
    if (empty) continue;
    rows.push({
      managerId: m.id,
      name: m.name,
      isActive: m.isActive,
      saleCount: a?.saleCount ?? 0,
      sold: toPer(a?.sold ?? zero()),
      collected: toPer(col),
      areaM2: milliToStr(a?.areaMilli ?? 0n),
      debt: toPer(debt),
    });
  }
  rows.sort((x, y) => y.saleCount - x.saleCount || x.name.localeCompare(y.name, "ru"));
  return rows;
}

/**
 * DB: продажи по менеджерам (только владелец — гейт на странице).
 * «Менеджер» = SaleRecord.managerId (кто оформил). Платёж и долг относятся к
 * менеджеру ПРОДАЖИ, а не к тому, кто принял деньги (receivedById).
 * Менеджеров немного — по каждому две агрегатные выборки (payment/debt
 * groupBy с фильтром по связи), без выгрузки строк.
 */
export async function loadManagerSales(
  db: Db,
  args: { period: RatingPeriod },
): Promise<ManagerSalesRow[]> {
  const range = rangeWhere(args.period);
  const [grouped, managers] = await Promise.all([
    db.saleRecord.groupBy({
      by: ["managerId", "currency"],
      where: { returnedAt: null, ...(range ? { soldAt: range } : {}) },
      _sum: { price: true, qtyAreaM2: true, returnedAmount: true, returnedAreaM2: true },
      _count: { _all: true },
    }),
    // Все, кто когда-либо оформлял продажу (в т.ч. уволенные — их долги живы).
    db.user.findMany({
      where: { sales: { some: {} } },
      select: { id: true, name: true, isActive: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const sales: SaleGroup[] = grouped.map((g) => ({
    key: g.managerId,
    currency: g.currency,
    priceSum: netDecStr(g._sum.price, g._sum.returnedAmount, 2),
    areaSum: netDecStr(g._sum.qtyAreaM2, g._sum.returnedAreaM2, 3),
    count: g._count._all,
  }));

  const perManager = await Promise.all(
    managers.map(async (m) => {
      const [pay, debt] = await Promise.all([
        db.payment.groupBy({
          by: ["currency", "kind"],
          where: {
            saleRecord: { managerId: m.id },
            ...(range ? { paidAt: range } : {}),
          },
          _sum: { amount: true },
        }),
        db.debt.groupBy({
          by: ["currency"],
          where: { status: "ACTIVE", saleRecord: { managerId: m.id } },
          _sum: { amount: true, repaidAmount: true },
        }),
      ]);
      return {
        payments: pay.map(
          (p): PaymentGroup => ({
            key: m.id,
            currency: p.currency,
            kind: p.kind,
            amountSum: p._sum.amount,
          }),
        ),
        debts: debt.map(
          (d): DebtGroup => ({
            key: m.id,
            currency: d.currency,
            amountSum: d._sum.amount,
            repaidSum: d._sum.repaidAmount,
          }),
        ),
      };
    }),
  );

  return buildManagerSales({
    sales,
    payments: perManager.flatMap((x) => x.payments),
    debts: perManager.flatMap((x) => x.debts),
    managers,
  });
}
