/**
 * ТЗ №12 — единая единица размеров: **сантиметры (см)**.
 *
 * ## Naming debt (intentional)
 * Prisma columns remain `lengthMm`, `widthMm`, `boundingLengthMm`,
 * `boundingAreaMm2`, `sidesMm`, etc. — **legacy names**. After migration
 * `20260807120000_tz12_cm_and_batch_dims` (prod 2026-08-07) **stored values
 * are centimetres**, not millimetres. Renaming columns on live data is a
 * separate, risky migration; code and comments must tell the truth instead.
 *
 * UI and all seed/generators must write **cm**. Never apply a second ÷10.
 * Площадь — м², количество — плиты.
 */

export const DIM_UNIT = "см" as const;

/**
 * Cutting allowance for size search (TZ §5.2).
 * Historical: 20 mm. Now **2 cm** (same physical 20 mm, unit is cm).
 */
export const CUTTING_MARGIN_CM = 2;

/**
 * @deprecated Alias of {@link CUTTING_MARGIN_CM}. Name says Mm but value is **cm**.
 * Prefer `CUTTING_MARGIN_CM` in new code.
 */
export const CUTTING_MARGIN_MM = CUTTING_MARGIN_CM;

export function formatDim(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return String(Math.round(n));
}

/** «118×64 см» или «118×64×2 см». */
export function formatGabarit(
  length: number | null | undefined,
  width: number | null | undefined,
  thickness?: number | null,
): string {
  if (length == null || width == null) return "—";
  if (thickness != null) {
    return `${formatDim(length)}×${formatDim(width)}×${formatDim(thickness)} ${DIM_UNIT}`;
  }
  return `${formatDim(length)}×${formatDim(width)} ${DIM_UNIT}`;
}

/** Площадь прямоугольника, м², из см. */
export function areaM2FromCm(lengthCm: number, widthCm: number): number {
  return (lengthCm * widthCm) / 10_000;
}

/** Расхождение %: L×W×count vs введённая площадь. */
export function areaDiscrepancyPct(
  lengthCm: number,
  widthCm: number,
  plateCount: number,
  enteredAreaM2: number,
): number | null {
  if (!lengthCm || !widthCm || !plateCount || !enteredAreaM2) return null;
  const expected = areaM2FromCm(lengthCm, widthCm) * plateCount;
  if (expected <= 0) return null;
  return (Math.abs(expected - enteredAreaM2) / expected) * 100;
}
