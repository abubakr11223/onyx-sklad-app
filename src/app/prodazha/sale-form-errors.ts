// SaleForm step-4: which error keys surface on confirmation banner.
// Shared by SaleForm.tsx and sale-form-errors.test.ts — test must import THIS
// module (not a local copy), or production drift goes silent.
//
// round2: preferred keys keep stable order; UNKNOWN keys are no longer dropped
// (see orderedErrorMessages in @/lib/form-errors). Allowlist drift → leftover
// banner, not silence.

import { orderedErrorMessages } from "@/lib/form-errors";

/** Preferred keys (order stable for UI). Unknown keys still append. */
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
 * Sample issue path on the same SaleForm confirm step.
 * Preferred order; leftovers still surface (structural, not hand-list only).
 */
export const SAMPLE_FORM_ERROR_KEYS = [
  "form",
  "clientId",
  "returnDueDate",
  "depositAmount",
  "qty",
  "qtySlabs",
  "qtyAreaM2",
  "unitId",
  "batchId",
] as const;

/**
 * Build confirmation-step error list from server action errors map.
 * Preferred keys first (stable order), then any leftover unknown keys.
 */
export function fieldErrorItems(
  errors: Readonly<Record<string, string | undefined>>,
): string[] {
  return orderedErrorMessages(errors, SALE_FORM_ERROR_KEYS);
}

/** Same contract for issue-sample errors on step 4. */
export function sampleFieldErrorItems(
  errors: Readonly<Record<string, string | undefined>>,
): string[] {
  return orderedErrorMessages(errors, SAMPLE_FORM_ERROR_KEYS);
}
