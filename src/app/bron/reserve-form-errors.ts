// ReserveForm error surface — preferred keys + leftovers (form-errors.ts).
// Conditional fields (target, qty*) may be unmounted; leftovers still show.

import { orderedErrorMessages } from "@/lib/form-errors";

/** Keys the form knows about (order stable for banner). */
export const RESERVE_FORM_ERROR_KEYS = [
  "form",
  "target",
  "qtySlabs",
  "qtyAreaM2",
  "customerName",
  "days",
] as const;

/**
 * Keys currently claimed by mounted Field widgets.
 * Unmounted keys (e.g. target without stone, qty without BATCH) become leftovers.
 */
export function reserveRenderedKeys(args: {
  stoneSelected: boolean;
  isBatch: boolean;
}): string[] {
  const keys = ["form", "customerName", "days"];
  if (args.stoneSelected) keys.push("target");
  if (args.isBatch) {
    keys.push("qtySlabs", "qtyAreaM2");
  }
  return keys;
}

/** Full banner list (preferred + any future unknown keys). */
export function reserveErrorItems(
  errors: Readonly<Record<string, string | undefined>>,
): string[] {
  return orderedErrorMessages(errors, RESERVE_FORM_ERROR_KEYS);
}
