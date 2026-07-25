// OWN-02 (ТЗ №2) — редактирование карточки камня владельцем: ЧИСТАЯ валидация
// (без БД, без next). Server-action (kamen/actions.ts editStoneType) вызывает
// это и дополнительно проверяет роль OWNER на сервере (defense-in-depth).
// Отдельно unit-тестируется — как validators/intake.ts, accounts.ts.

import { MAX_DECIMAL_12_2, parseBoundedDecimal } from "@/lib/decimal";

export interface StoneEditInput {
  name: string;
  rockType: string;
  color: string;
  description: string;
  basePrice: string;
  purchasePrice: string;
  /** properties: textarea, по строке «ключ: значение». */
  properties: string;
}

export interface ValidStoneEdit {
  name: string;
  rockType: string;
  color: string | null;
  description: string | null;
  basePrice: number | null;
  purchasePrice: number | null;
  properties: Record<string, string> | null;
}

export type StoneEditError = "name" | "rockType" | "basePrice" | "purchasePrice";

/**
 * Денежное поле: пусто → null (цена не задана). Иначе число ≥ 0 (запятая как
 * разделитель тоже принимается). Отрицательное / текст / переполнение → ошибка.
 *
 * Аудит ТЗ №7 #7 — раньше был локальный parseFloat без верхней границы, из-за
 * чего ввод типа 10000000000 (11 цифр) при Decimal(12,2) приводил к Prisma
 * numeric-overflow → 500 вместо ok:false. Теперь через parseBoundedDecimal
 * с MAX_DECIMAL_12_2 (9 999 999 999.99).
 */
export function parseMoneyField(
  raw: string,
): { ok: true; value: number | null } | { ok: false } {
  const res = parseBoundedDecimal(raw, {
    max: MAX_DECIMAL_12_2,
    allowZero: true,
  });
  if (!res.ok) return { ok: false };
  return { ok: true, value: res.value };
}

/**
 * properties из textarea: каждая непустая строка «ключ: значение» → пара.
 * Строки без «:» или с пустым ключом пропускаются (не роняем сохранение).
 * Нет валидных пар → null (properties очищается).
 */
export function parseProperties(raw: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  let count = 0;
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const idx = t.indexOf(":");
    if (idx <= 0) continue; // нет двоеточия или пустой ключ — пропуск
    const key = t.slice(0, idx).trim();
    const val = t.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = val;
    count++;
  }
  return count > 0 ? out : null;
}

/**
 * Валидирует правки карточки. name и rockType обязательны; цены — число ≥ 0
 * или пусто. Возвращает нормализованные значения либо код первого ошибочного поля.
 */
export function validateStoneEdit(
  input: StoneEditInput,
): { ok: true; value: ValidStoneEdit } | { ok: false; error: StoneEditError } {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "name" };

  const rockType = input.rockType.trim();
  if (!rockType) return { ok: false, error: "rockType" };

  const bp = parseMoneyField(input.basePrice);
  if (!bp.ok) return { ok: false, error: "basePrice" };

  const pp = parseMoneyField(input.purchasePrice);
  if (!pp.ok) return { ok: false, error: "purchasePrice" };

  return {
    ok: true,
    value: {
      name,
      rockType,
      color: input.color.trim() || null,
      description: input.description.trim() || null,
      basePrice: bp.value,
      purchasePrice: pp.value,
      properties: parseProperties(input.properties),
    },
  };
}
