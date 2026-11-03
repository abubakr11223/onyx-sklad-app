// ТЗ №20 A — способы оплаты и чистая математика платежей (без БД).
// Отдельно от payments.ts: этот модуль импортирует и клиентская форма продажи.

export type PayMethod = "CASH" | "CARD" | "TRANSFER";
export type PayCurrency = "UZS" | "USD";

export const PAY_METHODS: readonly PayMethod[] = ["CASH", "CARD", "TRANSFER"];

export const PAY_METHOD_LABEL: Record<PayMethod, string> = {
  CASH: "Наличные",
  CARD: "Карта",
  TRANSFER: "Перечисление",
};

export interface PaymentRowInput {
  amount: number;
  method: PayMethod;
}

/** number (сумма) → целые копейки. */
export const toCents = (n: number): number => Math.round(n * 100);
export const centsToStr = (c: number): string => (c / 100).toFixed(2);
export const decToCents = (d: { toString(): string } | null | undefined): number =>
  d == null ? 0 : Math.round(Number(d.toString()) * 100);

export function isPayMethod(s: string): s is PayMethod {
  return (PAY_METHODS as readonly string[]).includes(s);
}

/**
 * Чистая проверка строк оплаты при продаже: суммы > 0, способ известен,
 * Σ ≤ цене (§2.2 «оплачено больше цены — не даём сохранить»). Пустые строки
 * (сумма 0/пусто) отбрасываются — «оплачено 0» = нынешнее «в долг».
 */
export function checkSalePayments(
  price: number,
  rows: readonly PaymentRowInput[],
): { ok: true; rows: PaymentRowInput[]; paidCents: number; debtCents: number } | { ok: false; message: string } {
  const out: PaymentRowInput[] = [];
  let paid = 0;
  for (const r of rows) {
    if (!Number.isFinite(r.amount) || r.amount < 0) {
      return { ok: false, message: "Сумма оплаты — положительное число" };
    }
    if (r.amount === 0) continue;
    if (!isPayMethod(r.method)) {
      return { ok: false, message: "Выберите способ оплаты: наличные, карта или перечисление" };
    }
    paid += toCents(r.amount);
    out.push(r);
  }
  const priceCents = toCents(price);
  if (paid > priceCents) {
    return { ok: false, message: "Оплачено больше цены продажи — проверьте суммы" };
  }
  return { ok: true, rows: out, paidCents: paid, debtCents: priceCents - paid };
}

/**
 * Сводный «способ» продажи для старых экранов и фильтров (SaleRecord.paymentMethod):
 * один способ → он; несколько → способ большей суммы; без оплат → CREDIT.
 * Отчёты по деньгам считают по Payment, не по этому полю.
 */
export function summaryMethod(rows: readonly PaymentRowInput[]): PayMethod | "CREDIT" {
  if (rows.length === 0) return "CREDIT";
  const by = new Map<PayMethod, number>();
  for (const r of rows) by.set(r.method, (by.get(r.method) ?? 0) + r.amount);
  return [...by.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

