// TZ9 cleanup — list/history price display. Amount must use the sale's own
// currency (CONTRACT: UZS | USD). Never invent «сум» for USD or legacy rows.

import {
  CURRENCY_LABEL,
  type SaleCurrency,
} from "@/lib/validators/sale-payment";

const SALE_CURRENCIES = new Set<string>(["UZS", "USD"]);

/**
 * Formats a SaleRecord price for the history list.
 *
 *  - known currency → `12 000 $` / `12 000 сум` (via CURRENCY_LABEL)
 *  - null/unknown currency (pre-TZ9 legacy) → amount **without** unit —
 *    inventing «сум» would mislabel old dollar sales
 *  - null price → null (caller hides the segment)
 */
export function formatSaleListPrice(
  price: { toString(): string } | null | undefined,
  currency: string | null | undefined,
  fmt: Intl.NumberFormat,
): string | null {
  if (price == null) return null;
  const amount = fmt.format(Number(price.toString()));
  if (currency && SALE_CURRENCIES.has(currency)) {
    return `${amount} ${CURRENCY_LABEL[currency as SaleCurrency]}`;
  }
  return amount;
}
