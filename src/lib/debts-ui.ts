// TZ №9 Part B — pure presentation helpers for /dolzhniki (no DB, no domain).
// Domain lives in src/lib/debts.ts (o1). Currency amounts are NEVER combined.

import type { CurrencyMoney, DebtListItem } from "@/lib/debts";
import { isDebtOverdue } from "@/lib/debts";

export const DEBT_PAGE_SIZE = 30;

/** Parse decimal string → integer cents (BigInt). Invalid → 0n. */
export function decimalStringToCents(amount: string): bigint {
  const s = amount.trim().replace(",", ".");
  const m = /^(-?)(\d+)(?:\.(\d{0,2})\d*)?$/.exec(s);
  if (!m) return 0n;
  const neg = m[1] === "-";
  const whole = BigInt(m[2] || "0");
  const frac = BigInt(((m[3] ?? "") + "00").slice(0, 2));
  const cents = whole * 100n + frac;
  return neg ? -cents : cents;
}

export function centsToDecimalString(cents: bigint): string {
  const neg = cents < 0n;
  const a = neg ? -cents : cents;
  const whole = a / 100n;
  const frac = a % 100n;
  const body = `${whole.toString()}.${frac.toString().padStart(2, "0")}`;
  return neg ? `-${body}` : body;
}

const UZS_FMT = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});
const USD_FMT = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

/** Format a money amount for UI. Amount is a decimal string (never float math). */
export function formatDebtMoney(
  amount: string,
  currency: "UZS" | "USD",
): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  if (currency === "USD") return `$${USD_FMT.format(n)}`;
  return `${UZS_FMT.format(n)} сум`;
}

/**
 * Join per-currency summary lines. Empty currencies omitted (CONTRACT.md).
 * Never sums UZS+USD into one number.
 */
export function formatCurrencySummaryLine(
  rows: ReadonlyArray<CurrencyMoney>,
): string | null {
  const parts: string[] = [];
  for (const r of rows) {
    if (r.count <= 0) continue;
    parts.push(formatDebtMoney(r.amount, r.currency));
  }
  return parts.length > 0 ? parts.join("  ·  ") : null;
}

/**
 * Overdue boundary for display (mirrors debts.isDebtOverdue).
 * dueDate === now → NOT overdue (strict <).
 */
export function isOverdueAtBoundary(
  debt: { status: "ACTIVE" | "REPAID" | "CANCELLED"; dueDate: Date | null },
  now: Date,
): boolean {
  return isDebtOverdue(debt, now);
}

/** What was bought — from DebtListItem.sale (no re-entry). */
export function formatDebtPurchase(sale: DebtListItem["sale"]): string {
  const type = sale.targetType;
  const qty: string[] = [];
  if (sale.qtySlabs != null && sale.qtySlabs > 0) {
    qty.push(`${sale.qtySlabs} плит`);
  }
  if (sale.qtyAreaM2 != null && sale.qtyAreaM2 !== "0") {
    qty.push(`${sale.qtyAreaM2} м²`);
  }
  const vol = qty.length > 0 ? qty.join(" / ") : null;
  if (type === "SLAB") return vol ? `Плита · ${vol}` : "Плита";
  if (type === "PIECE") return vol ? `Бой/остаток · ${vol}` : "Бой/остаток";
  if (type === "BATCH_VOLUME") return vol ? `Объём партии · ${vol}` : "Объём партии";
  if (type === "WHOLE_BATCH") return vol ? `Партия целиком · ${vol}` : "Партия целиком";
  if (type === "PATTERN_VOLUME") return vol ? `Узор · ${vol}` : "Узор";
  return vol ?? type;
}

export type ClientDebtGroup = {
  key: string;
  customerName: string;
  customerContact: string | null;
  debts: DebtListItem[];
  /** Per-currency totals for this client only. */
  totalsByCurrency: CurrencyMoney[];
};

/**
 * Group debts by client (name + phone). Sort groups by earliest soldAt desc
 * (date — cannot rank mixed currencies by amount, CONTRACT.md).
 */
export function groupDebtsByClient(
  items: readonly DebtListItem[],
): ClientDebtGroup[] {
  const map = new Map<string, ClientDebtGroup>();
  for (const d of items) {
    const key = `${d.sale.customerName}\0${d.sale.customerContact ?? ""}`;
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        customerName: d.sale.customerName,
        customerContact: d.sale.customerContact,
        debts: [],
        totalsByCurrency: [],
      };
      map.set(key, g);
    }
    g.debts.push(d);
  }

  const groups = [...map.values()];
  for (const g of groups) {
    // Cent-integer sum (no float, no cross-currency add).
    const acc = new Map<"UZS" | "USD", { cents: bigint; count: number }>();
    for (const d of g.debts) {
      const prev = acc.get(d.currency) ?? { cents: 0n, count: 0 };
      prev.cents += decimalStringToCents(d.amount);
      prev.count += 1;
      acc.set(d.currency, prev);
    }
    g.totalsByCurrency = [];
    for (const cur of ["UZS", "USD"] as const) {
      const row = acc.get(cur);
      if (!row || row.count === 0) continue;
      g.totalsByCurrency.push({
        currency: cur,
        amount: centsToDecimalString(row.cents),
        count: row.count,
      });
    }
    // Within client: newest sale first
    g.debts.sort(
      (a, b) =>
        b.sale.soldAt.getTime() - a.sale.soldAt.getTime() ||
        (a.id < b.id ? 1 : -1),
    );
  }

  groups.sort((a, b) => {
    const ta = a.debts[0]?.sale.soldAt.getTime() ?? 0;
    const tb = b.debts[0]?.sale.soldAt.getTime() ?? 0;
    return tb - ta;
  });
  return groups;
}

/** Keyset page split (take N+1) — same idea as sale-history. */
export function applyKeysetPage<T>(
  rows: readonly T[],
  pageSize: number,
): { page: T[]; hasMore: boolean; nextCursorIndex: number | null } {
  const size = Math.max(1, pageSize);
  if (rows.length <= size) {
    return { page: [...rows], hasMore: false, nextCursorIndex: null };
  }
  return {
    page: rows.slice(0, size),
    hasMore: true,
    nextCursorIndex: size - 1,
  };
}

export type PaymentMethodKey = "CASH" | "CARD" | "CREDIT";

export type RevenueByMethodRow = {
  method: PaymentMethodKey;
  currency: "UZS" | "USD";
  amount: string;
  count: number;
};

/**
 * Format revenue-by-method for owner (TZ №9 §9.2). Per currency, never mixed.
 * Rows with count 0 omitted.
 */
export function formatRevenueByMethod(
  rows: readonly RevenueByMethodRow[],
): Array<{ methodRu: string; line: string }> {
  const METHOD_RU: Record<PaymentMethodKey, string> = {
    CASH: "Наличные",
    CARD: "Карта",
    CREDIT: "В долг",
  };
  const byMethod = new Map<PaymentMethodKey, RevenueByMethodRow[]>();
  for (const r of rows) {
    if (r.count <= 0) continue;
    const list = byMethod.get(r.method) ?? [];
    list.push(r);
    byMethod.set(r.method, list);
  }
  const out: Array<{ methodRu: string; line: string }> = [];
  for (const m of ["CASH", "CARD", "CREDIT"] as PaymentMethodKey[]) {
    const list = byMethod.get(m);
    if (!list || list.length === 0) continue;
    const line = list
      .map((r) => formatDebtMoney(r.amount, r.currency))
      .join("  ·  ");
    out.push({ methodRu: METHOD_RU[m], line });
  }
  return out;
}
