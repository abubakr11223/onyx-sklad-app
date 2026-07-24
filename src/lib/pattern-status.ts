// ТЗ №3 §2 — статус узор-подгруппы. «Наследуется от партии, но уточняется на
// уровне подгруппы»: узор может быть уже ПРОДАН, пока в партии есть другие.
//
// ⚠️ Статус ВЫЧИСЛЯЕТСЯ из счётчиков остатка (slabsSold/areaSoldM2) — отдельного
// поля в БД НЕТ. Значит, он НИКОГДА не рассинхронизируется с остатком и НЕ влияет
// на деньги/продажу (чисто отображение). «Бронь» здесь не выводится: volume-брони
// привязаны к партии, а не к узору (это отдельная механика).

export type PatternStatus = "AVAILABLE" | "PARTIAL" | "SOLD";

// Тот же порядок эпсилона, что и в охране объёмной продажи (шум float по м²).
const AREA_EPS = 0.001;

export interface PatternCounters {
  slabsCount: number;
  slabsSold: number;
  areaM2: number;
  areaSoldM2: number;
}

/**
 * Статус подгруппы по остатку:
 *   - SOLD      — остатка нет ни по плитам, ни по м² (полностью продан).
 *   - AVAILABLE — ничего не продано (в наличии целиком).
 *   - PARTIAL   — что-то продано, но остаток ещё есть.
 */
export function patternStatus(p: PatternCounters): PatternStatus {
  const remSlabs = p.slabsCount - p.slabsSold;
  const remArea = p.areaM2 - p.areaSoldM2;
  // Полностью продан: не осталось ни плит, ни площади (эпсилон гасит шум float).
  if (remSlabs <= 0 && remArea <= AREA_EPS) return "SOLD";
  // Ничего не продано ни по одному измерению → в наличии целиком.
  if (p.slabsSold <= 0 && p.areaSoldM2 <= AREA_EPS) return "AVAILABLE";
  return "PARTIAL";
}

/** RU-подпись статуса подгруппы. */
export const PATTERN_STATUS_RU: Record<PatternStatus, string> = {
  AVAILABLE: "в наличии",
  PARTIAL: "частично продан",
  SOLD: "продан",
};
