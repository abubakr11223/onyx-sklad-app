// ТЗ №20 F — «чистые» цифры продажи после частичных возвратов.
// Итоги клиента/объекта, «Сводка», рейтинги считают не price/qty продажи, а
// price − returnedAmount, qty − returned*. Полностью возвращённые продажи
// (returnedAt) по-прежнему отсекаются фильтром returnedAt: null у вызывающих.
// Чистый модуль: целые центы / тысячные м² — без плавающих хвостов.

type Dec = { toString(): string } | null | undefined;

const cents = (d: Dec): number => (d == null ? 0 : Math.round(Number(d.toString()) * 100));
const milli = (d: Dec): number => (d == null ? 0 : Math.round(Number(d.toString()) * 1000));

/** Поля продажи, которые нужно выбрать для пересчёта (Prisma select). */
export const SALE_RETURNED_SELECT = {
  returnedSlabs: true,
  returnedAreaM2: true,
  returnedAmount: true,
} as const;

/** Разность двух Decimal-значений в виде строки (scale 2 — деньги, 3 — м²). */
export function netDecStr(value: Dec, returned: Dec, scale: 2 | 3): string | null {
  if (value == null) return null;
  const f = scale === 2 ? cents : milli;
  const k = scale === 2 ? 100 : 1000;
  return (Math.max(0, f(value) - f(returned)) / k).toFixed(scale);
}

/** price / qtySlabs / qtyAreaM2 продажи за вычетом частичных возвратов. */
export function netSaleFields(s: {
  price: Dec;
  qtySlabs: number | null;
  qtyAreaM2: Dec;
  returnedSlabs?: number | null;
  returnedAreaM2?: Dec;
  returnedAmount?: Dec;
}): { price: string | null; qtySlabs: number | null; qtyAreaM2: string | null } {
  return {
    price: netDecStr(s.price, s.returnedAmount, 2),
    qtySlabs: s.qtySlabs === null ? null : Math.max(0, s.qtySlabs - (s.returnedSlabs ?? 0)),
    qtyAreaM2: netDecStr(s.qtyAreaM2, s.returnedAreaM2, 3),
  };
}
