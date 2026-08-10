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

/**
 * ТЗ №12 + решение владельца 2026-08-10 — ТОЛЩИНА показывается дробной.
 *
 * Длина и ширина остаются целыми (`formatDim`): 275×185 см. Толщина — нет:
 * на складе есть 18 мм, то есть 1,8 см, и округление до 2 теряет реальный
 * размер камня. Отдельная функция, а не «сделать formatDim дробным», чтобы
 * длина/ширина случайно не начали показывать 275,0.
 *
 * Хвостовые нули убираем (2,0 → «2»), разделитель — запятая (ru).
 */
export function formatThickness(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const rounded = Math.round(n * 10) / 10;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(1).replace(".", ",");
}

/** Максимум для толщины: NUMERIC(5,1) в БД. */
export const MAX_THICKNESS_CM = 9999.9;

/**
 * Разбор поля «Толщина, см» из формы. Принимает «2», «1,8», «1.8».
 *
 * Возвращает (тот же контракт, что у parsePositiveInt в приёмке):
 *   null      — пусто (толщина необязательна);
 *   undefined — ошибка ввода (не число, ноль, минус, слишком много знаков);
 *   number    — значение в см, округлённое до 0,1 (в БД NUMERIC(5,1)).
 *
 * Округляем ЗДЕСЬ, а не в БД: иначе «1,84» молча превратится в 1,8 уже после
 * сохранения, и пользователь увидит не то, что ввёл, без объяснения.
 */
export function parseThicknessCm(raw: string): number | null | undefined {
  const s = (raw ?? "").trim().replace(",", ".");
  if (s === "") return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_THICKNESS_CM) return undefined;
  return Math.round(n * 10) / 10;
}

/** Prisma Decimal | number | null → number | null (толщина). */
export function thicknessToNumber(
  v: { toString(): string } | number | null | undefined,
): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(v.toString());
  return Number.isFinite(n) ? n : null;
}

/** «118×64 см» или «118×64×1,8 см». */
export function formatGabarit(
  length: number | null | undefined,
  width: number | null | undefined,
  thickness?: number | null,
): string {
  if (length == null || width == null) return "—";
  if (thickness != null) {
    return `${formatDim(length)}×${formatDim(width)}×${formatThickness(thickness)} ${DIM_UNIT}`;
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
