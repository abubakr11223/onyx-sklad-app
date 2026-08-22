// IntakeForm / BatchEditForm — leftover surface for unknown keys.

import { orderedErrorMessages } from "@/lib/form-errors";

/** Top-level preferred keys (dynamic loc-N / pattern-N still append as leftovers). */
export const INTAKE_FORM_TOP_KEYS = [
  "form",
  "stoneTypeId",
  "newName",
  "newRockType",
  "newDescription",
  "newBasePrice",
  "slabsTotal",
  "areaTotalM2",
  "quantity",
  "lengthMm",
  "widthMm",
  "thicknessMm",
  "locations",
  "locationsSum",
  "patterns",
  "patternsTotals",
  "patternsSum",
  "arrivedAt",
] as const;

export const BATCH_EDIT_TOP_KEYS = [
  "form",
  "slabsTotal",
  "areaTotalM2",
  "lengthMm",
  "widthMm",
  "thicknessMm",
  "arrivedAt",
] as const;

export function intakeErrorItems(
  errors: Readonly<Record<string, string | undefined>>,
): string[] {
  return orderedErrorMessages(errors, INTAKE_FORM_TOP_KEYS);
}

export function batchEditErrorItems(
  errors: Readonly<Record<string, string | undefined>>,
): string[] {
  return orderedErrorMessages(errors, BATCH_EDIT_TOP_KEYS);
}
