// ТЗ №20 H (§9.1) — «Ориентир цены» вида камня: сум/м² и $/м².
//
// Задаёт владелец (canSetPriceHint), видят сотрудники (canSeePriceHint).
// В продаже это ПОДСКАЗКА: цена по-прежнему вводится руками, поле не
// заполняется автоматически. Модуль чистый (client-safe).

/** Верх Decimal(14,2). */
export const PRICE_HINT_MAX = 999_999_999_999.99;

/**
 * «450 000» / «450000» / «35,5» → число; пусто → null (ориентир снят);
 * мусор, ноль, минус, больше 2 знаков после запятой → undefined (ошибка поля).
 */
export function parsePriceHint(raw: string): number | null | undefined {
  const s = raw.replace(/[\s  ]/g, "").replace(",", ".");
  if (s === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || n > PRICE_HINT_MAX) return undefined;
  return n;
}

const uzsFmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const usdFmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

type Num = { toString(): string } | number | null | undefined;
const toNum = (v: Num): number | null =>
  v === null || v === undefined ? null : typeof v === "number" ? v : Number(v.toString());

/** «450 000 сум/м² · $35/м²» или null, если ориентир не задан. */
export function formatPriceHint(uzsM2: Num, usdM2: Num): string | null {
  const uzs = toNum(uzsM2);
  const usd = toNum(usdM2);
  const parts: string[] = [];
  if (uzs !== null) parts.push(`${uzsFmt.format(uzs)} сум/м²`);
  if (usd !== null) parts.push(`$${usdFmt.format(usd)}/м²`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
