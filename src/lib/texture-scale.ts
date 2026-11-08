// ТЗ №20 J (§11.3) — масштаб текстуры в 3D-сцене. Отдельный модуль без
// node:-импортов: его тянет клиентский 3D-просмотр.

/** Размер плиты, если у узора/партии он не указан (типовой слэб). */
export const DEFAULT_SLAB_CM = { lengthCm: 280, widthCm: 160 } as const;


/**
 * Сколько раз плита укладывается на поверхность (repeat текстуры). Текстура
 * всегда «альбомная»: её ширина = длинная сторона плиты. Поверхность в метрах,
 * плита в сантиметрах. Нет размера плиты → типовой 280 × 160.
 */
export function textureRepeat(
  surfaceWidthM: number,
  surfaceHeightM: number,
  lengthCm: number | null,
  widthCm: number | null,
): [number, number] {
  const L = lengthCm && widthCm ? Math.max(lengthCm, widthCm) : DEFAULT_SLAB_CM.lengthCm;
  const W = lengthCm && widthCm ? Math.min(lengthCm, widthCm) : DEFAULT_SLAB_CM.widthCm;
  return [surfaceWidthM / (L / 100), surfaceHeightM / (W / 100)];
}
