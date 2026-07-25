// Аудит ТЗ №7 #7 — раньше три отдельных парсера десятичных полей:
//   • validators/intake.ts:parsePositiveDecimal — с MAX-clamp'ом (Decimal(12,3));
//   • karta-sklada/actions.ts (2 сайта) — parseFloat без верхней границы →
//     ввод 99999999999 приводил к Prisma numeric-overflow → 500 (вместо ?err=area);
//   • stone-edit.ts:parseMoneyField — parseFloat без верхней границы для Decimal(12,2)
//     (basePrice/purchasePrice).
// Здесь — один bounded-парсер, разные вызывающие передают свой max и allowZero.
// Регрессия: MAX_DECIMAL_FIELD сохранён и re-export'ится ниже + intake.ts продолжает
// работать; parsePositiveDecimal становится тонким адаптером через parseBoundedDecimal.

/** Decimal(12,3) — площади, объёмы. Максимум = 999 999 999.999. */
export const MAX_DECIMAL_12_3 = 999_999_999.999;
/** Decimal(12,2) — денежные поля. Максимум = 9 999 999 999.99. */
export const MAX_DECIMAL_12_2 = 9_999_999_999.99;

export interface BoundedDecimalOpts {
  /** Верхняя граница включительно. Значение выше → { ok:false, reason:'overflow' }. */
  max: number;
  /** true — принимаем 0 (например, площадь блока); false — только > 0. */
  allowZero: boolean;
}

export type BoundedDecimalReason = "not_number" | "negative" | "zero" | "overflow";

export type BoundedDecimalResult =
  | { ok: true; value: number | null } // null = поле пустое
  | { ok: false; reason: BoundedDecimalReason };

/**
 * «12,5» → 12.5. Пустая строка → { ok:true, value:null } (поле не заполнено).
 * Не число / отрицательное / (0 при !allowZero) / больше max → { ok:false, reason }.
 * Единая точка для всех Decimal-полей: приёмка, карта, каталог.
 */
export function parseBoundedDecimal(
  raw: string,
  opts: BoundedDecimalOpts,
): BoundedDecimalResult {
  const s = raw.trim().replace(",", ".");
  if (s === "") return { ok: true, value: null };
  if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false, reason: "not_number" };
  const n = Number(s);
  if (!Number.isFinite(n)) return { ok: false, reason: "not_number" };
  if (n < 0) return { ok: false, reason: "negative" };
  if (n === 0 && !opts.allowZero) return { ok: false, reason: "zero" };
  if (n > opts.max) return { ok: false, reason: "overflow" };
  return { ok: true, value: n };
}
