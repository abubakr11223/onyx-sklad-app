/**
 * ТЗ №12 — единая единица размеров: сантиметры.
 *
 * В БД поля по-прежнему называются *Mm (legacy), но **значения хранятся в см**
 * после миграции 20260807 (÷10). UI и ввод — только «см».
 * Площадь — м², количество — плиты.
 */

export const DIM_UNIT = "см" as const;

/** Запас на рез (раньше 20 мм) — 2 см. */
export const CUTTING_MARGIN_CM = 2;

/** @deprecated используйте CUTTING_MARGIN_CM — то же значение (см). */
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
