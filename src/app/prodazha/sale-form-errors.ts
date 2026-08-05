// SaleForm step-4: which error keys surface on confirmation banner.
// Shared by SaleForm.tsx and sale-form-errors.test.ts — test must import THIS
// module (not a local copy), or production drift goes silent.

/** Keys shown as list items after failed submit (salebug: qty* must be included). */
export const SALE_FORM_ERROR_KEYS = [
  "form",
  "qty",
  "qtySlabs",
  "qtyAreaM2",
  "clientId",
  "customerName",
  "customerContact",
  "siteId",
  "paymentMethod",
  "price",
  "currency",
  "debtDueDate",
  "debtComment",
] as const;

export type SaleFormErrorKey = (typeof SALE_FORM_ERROR_KEYS)[number];

/**
 * Build confirmation-step error list from server action errors map.
 * Order matches SALE_FORM_ERROR_KEYS (stable for UI).
 */
export function fieldErrorItems(
  errors: Readonly<Record<string, string | undefined>>,
): string[] {
  return SALE_FORM_ERROR_KEYS.map((k) => errors[k])
    .filter((msg): msg is string => Boolean(msg));
}
