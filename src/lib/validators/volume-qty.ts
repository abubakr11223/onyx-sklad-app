// Volume qty parsing for /prodazha (BATCH_VOLUME / PATTERN_VOLUME).
// Separated from intake parsePositiveDecimal so we can give clear UX messages
// for the common typo: spaces inside the area field (e.g. "55 12.5" from
// typing two numbers, or paste of a formatted string).
//
// CRITICAL: we do NOT strip internal spaces and re-parse. "55 12.5" must NOT
// become 5512.5 — that would silently sell far more m² than the user meant.

import { parsePositiveDecimal, parsePositiveInt } from "@/lib/validators/intake";

/** Internal whitespace (regular + NBSP / thin space from Intl formatting). */
const INTERNAL_SPACE = /[\s\u00A0\u202F\u2009]/;

export type VolumeQtyParse =
  | { ok: true; qtySlabs: number | null; qtyAreaM2: number | null }
  | { ok: false; errors: Record<string, string> };

/**
 * Parse slab count + area for a volume sale.
 * Empty both → error. Invalid → field errors (never silent).
 */
export function parseVolumeQtyFields(
  rawSlabs: string,
  rawArea: string,
): VolumeQtyParse {
  const errors: Record<string, string> = {};
  const slabsTrim = rawSlabs.trim();
  const areaTrim = rawArea.trim();

  let qtySlabs: number | null = null;
  let qtyAreaM2: number | null = null;

  if (slabsTrim !== "") {
    if (INTERNAL_SPACE.test(slabsTrim)) {
      errors.qtySlabs =
        "Число плит — одно целое число без пробелов, например 12";
    } else {
      const qs = parsePositiveInt(slabsTrim);
      if (qs === undefined) {
        errors.qtySlabs = "Число плит — целое положительное число";
      } else {
        qtySlabs = qs;
      }
    }
  }

  if (areaTrim !== "") {
    if (INTERNAL_SPACE.test(areaTrim)) {
      // Explicit: do not collapse "55 12.5" → 5512.5
      errors.qtyAreaM2 =
        "Площадь — одно число без пробелов (дробь через запятую: 12,5 или 55)";
    } else {
      const qa = parsePositiveDecimal(areaTrim);
      if (qa === undefined) {
        errors.qtyAreaM2 =
          "Площадь — положительное число, например 12,5 или 55";
      } else {
        qtyAreaM2 = qa;
      }
    }
  }

  if (qtySlabs === null && qtyAreaM2 === null && Object.keys(errors).length === 0) {
    errors.qty = "Укажите объём: число плит и/или площадь (м²)";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, qtySlabs, qtyAreaM2 };
}

/**
 * Human-readable volume line for confirmation (same rules as the form).
 * Joins with " · " so two numbers never look like one broken value.
 */
export function formatVolumeQtyDisplay(
  qtySlabs: string,
  qtyAreaM2: string,
): string {
  const parts = [
    qtySlabs.trim() && `${qtySlabs.trim()} плит`,
    qtyAreaM2.trim() && `${qtyAreaM2.trim()} м²`,
  ].filter(Boolean);
  return parts.join(" · ");
}
