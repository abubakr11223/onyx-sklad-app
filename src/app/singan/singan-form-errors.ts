// SinganForm — поверхность ошибок (тот же контракт, что break-form-errors.ts).
// Смысл: ключ, который сервер вернул, а форма нигде не рисует, обязан попасть в
// верхний баннер — иначе кнопка выглядит «мёртвой» (lib/form-errors.ts).

import {
  leftoverErrorMessages,
  orderedErrorMessages,
} from "@/lib/form-errors";

/** Статические ключи в порядке показа (side_N — динамические). */
export const SINGAN_FORM_STATIC_KEYS = [
  "form",
  "sides",
  "boundingLengthMm",
  "boundingWidthMm",
  "thicknessMm",
  "areaM2",
  "kind",
  "batchId",
  "block",
  "landmark",
  "breakCause",
] as const;

/** Ключи, занятые смонтированными полями (зависит от числа сторон чертежа). */
export function singanRenderedKeys(sideCount: number): string[] {
  const keys: string[] = [...SINGAN_FORM_STATIC_KEYS];
  for (let i = 1; i <= sideCount; i++) keys.push(`side_${i}`);
  return keys;
}

/** Сообщения ключей, которых нет ни на одном поле (дрейф валидатора). */
export function singanLeftoverItems(
  errors: Readonly<Record<string, string | undefined>>,
  sideCount: number,
): string[] {
  return leftoverErrorMessages(errors, singanRenderedKeys(sideCount));
}

/** Полный упорядоченный список — для тестов / верхнего баннера. */
export function singanErrorItems(
  errors: Readonly<Record<string, string | undefined>>,
): string[] {
  return orderedErrorMessages(errors, SINGAN_FORM_STATIC_KEYS);
}
