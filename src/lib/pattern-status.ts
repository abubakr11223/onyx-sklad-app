// ТЗ №3 §2 — статус узор-подгруппы. «Наследуется от партии, но уточняется на
// уровне подгруппы»: узор может быть уже ПРОДАН, пока в партии есть другие.
//
// ⚠️ Статус ВЫЧИСЛЯЕТСЯ из счётчиков остатка (slabsSold/areaSoldM2) — отдельного
// поля в БД НЕТ. НО:
//
// Аудит ТЗ №7 #20 — узор-счётчики трогают ТОЛЬКО пул-продажи из узора; прямой
// бой / выделение плиты уменьшают batch free-remainder, но узор.slabsSold
// остаётся прежним. Поэтому «остаток узора» на дисплее (slabsCount − slabsSold)
// может ПРЕВЫШАТЬ реально свободный остаток партии. Деньги защищены (batch-guard
// в sales.ts отказывает oversell'у), но UI обещает больше, чем есть.
//
// Решение — clampPatternRemainder: показываем min(узор-остаток, batch-free). Это
// исключительно display-fix; счётчики в БД не трогаем.

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

/**
 * Отображаемый остаток узора — с учётом clamp'а по свободному остатку партии
 * (аудит ТЗ №7 #20). null-batchFree (partiya bo'yicha o'lchov o'chirilgan) →
 * узор-остаток без clamp. Отрицательные значения обрезаются до 0 (UI никогда
 * не показывает минус — это была бы ложь про наличие).
 */
export interface ClampedPatternRemainder {
  slabsRemaining: number;
  areaRemainingM2: number;
}
export function clampPatternRemainder(
  pat: PatternCounters,
  batchFree: { slabsFree: number | null; areaFreeM2: number | null },
): ClampedPatternRemainder {
  const patSlabs = pat.slabsCount - pat.slabsSold;
  const patArea = pat.areaM2 - pat.areaSoldM2;
  const slabsRemaining =
    batchFree.slabsFree === null
      ? Math.max(0, patSlabs)
      : Math.max(0, Math.min(patSlabs, batchFree.slabsFree));
  const areaRemainingM2 =
    batchFree.areaFreeM2 === null
      ? Math.max(0, patArea)
      : Math.max(0, Math.min(patArea, batchFree.areaFreeM2));
  return { slabsRemaining, areaRemainingM2 };
}
