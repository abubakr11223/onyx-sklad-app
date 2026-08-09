// BreakForm error surface — leftovers for unmounted soldPart / unknown keys.

import {
  leftoverErrorMessages,
  orderedErrorMessages,
} from "@/lib/form-errors";

/** Static preferred keys (piece rows are dynamic p-${i}-*). */
export const BREAK_FORM_STATIC_KEYS = [
  "form",
  "pieces",
  "slabId",
  "batchId",
  "breakCause",
  "soldCustomerName",
  "soldPrice",
] as const;

const PIECE_FIELDS = [
  "kind",
  "boundingLengthMm",
  "boundingWidthMm",
  "thicknessMm",
  "areaM2",
  "block",
  "landmark",
  "sidesMm",
] as const;

/**
 * Keys currently claimed by mounted Fields (depends on mode / soldPart / rows).
 */
export function breakRenderedKeys(args: {
  mode: "slab" | "direct";
  soldPart: boolean;
  pieceRowCount: number;
}): string[] {
  const keys: string[] = ["form", "pieces", "breakCause"];
  if (args.mode === "slab") {
    keys.push("slabId");
    if (args.soldPart) {
      keys.push("soldCustomerName", "soldPrice");
    }
  } else {
    keys.push("batchId");
  }
  for (let i = 0; i < args.pieceRowCount; i++) {
    for (const f of PIECE_FIELDS) {
      keys.push(`p-${i}-${f}`);
    }
  }
  return keys;
}

/** Messages for keys not on currently mounted fields (soldPart edge, drift). */
export function breakLeftoverItems(
  errors: Readonly<Record<string, string | undefined>>,
  rendered: readonly string[],
): string[] {
  return leftoverErrorMessages(errors, rendered);
}

/** Full ordered list for tests / optional top banner. */
export function breakErrorItems(
  errors: Readonly<Record<string, string | undefined>>,
): string[] {
  return orderedErrorMessages(errors, BREAK_FORM_STATIC_KEYS);
}
