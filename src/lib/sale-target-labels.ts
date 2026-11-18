// ТЗ №21 А2 — тип продажи/брони русской подписью, не кодом из базы.
// Одна таблица для карточек клиента и объекта.
const TARGET_TYPE_RU: Record<string, string> = {
  SLAB: "Плита",
  PIECE: "Бой / остаток",
  BATCH_VOLUME: "Объём из партии",
  PATTERN_VOLUME: "Узор",
  WHOLE_BATCH: "Партия целиком",
  SHOWROOM: "Шоу-рум",
};

export const targetTypeRu = (t: string): string => TARGET_TYPE_RU[t] ?? t;
