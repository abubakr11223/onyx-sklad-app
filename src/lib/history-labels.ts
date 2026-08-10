// Русские подписи журнала действий (/istoriya). Чистый модуль без БД и Next —
// вынесен из страницы, чтобы `src/tests/history-labels.test.ts` мог сверять его
// с `AuditAction` в схеме Prisma.
//
// Зачем сверка. ТЗ №15 §7.9 требует «все действия в Истории». Формально это
// выполнялось: SHIPMENT_CONFIRM, SHOWROOM_SEND и SAMPLE_* писались в AuditLog.
// Но подписи для них не было, и журнал показывал сырой enum — читать его было
// нельзя. Ошибка тихая: новый член enum'а ничего не ломает, просто появляется
// английское слово в русском интерфейсе. Тест закрывает именно этот зазор.

/** AuditAction (schema §1.10) → русская подпись действия. */
export const ACTION_RU: Record<string, string> = {
  INTAKE: "Приёмка",
  SALE: "Продажа",
  RESERVE: "Бронь",
  RESERVE_CANCEL: "Снятие брони",
  RESERVE_EXPIRE: "Бронь истекла",
  SEPARATE_SLAB: "Выделение плиты",
  BREAK: "Разбитие",
  SPLIT: "Разделение",
  MOVE: "Перемещение",
  PHOTO_REQUEST: "Фотозапрос",
  PHOTO_UPLOAD: "Загрузка фото",
  RETURN: "Возврат",
  ADJUSTMENT: "Корректировка",
  STATUS_CHANGE: "Смена статуса",
  // ТЗ №10 (образцы) и ТЗ №15 §7.9 (отгрузки, шоу-рум).
  SAMPLE_ISSUE: "Выдача образца",
  SAMPLE_RETURN: "Возврат образца",
  SAMPLE_SELL: "Продажа образца",
  SAMPLE_EXTEND: "Продление образца",
  SHIPMENT_CONFIRM: "Отгрузка",
  SHOWROOM_SEND: "В шоу-рум",
  SHOWROOM_RETURN: "Возврат из шоу-рума",
};

/** AuditLog.entityType (свободная строка «Batch»/«Slab»/…) → русская подпись. */
export const ENTITY_RU: Record<string, string> = {
  Batch: "Партия",
  Slab: "Плита",
  Piece: "Бой/остаток",
  BatchLocation: "Локация",
  Reservation: "Бронь",
  StoneType: "Вид камня",
  // ТЗ №9/№10/№11/№15 — сущности, появившиеся после первой версии Истории.
  Sample: "Образец",
  Shipment: "Отгрузка",
  ShowroomPlacement: "Шоу-рум",
  Client: "Клиент",
  Site: "Объект",
  Debt: "Долг",
  User: "Сотрудник",
};

export type HistoryBadgeVariant = "success" | "warning" | "danger" | "neutral";

/** Действия, где badge несёт «настроение» (продажа — успех, разбитие — риск). */
export const ACTION_VARIANT: Record<string, HistoryBadgeVariant> = {
  SALE: "success",
  RESERVE: "success",
  BREAK: "warning",
  SPLIT: "warning",
  RESERVE_EXPIRE: "warning",
  RESERVE_CANCEL: "neutral",
  RETURN: "warning",
  ADJUSTMENT: "warning",
  SAMPLE_ISSUE: "warning", // камень ушёл со склада, но не продан — держим на виду
  SAMPLE_RETURN: "success",
  SAMPLE_SELL: "success",
  SHIPMENT_CONFIRM: "success",
  SHOWROOM_SEND: "warning",
  SHOWROOM_RETURN: "success",
};

/** Подпись действия; неизвестное — как есть (лучше сырой код, чем пустота). */
export function actionLabelRu(action: string): string {
  return ACTION_RU[action] ?? action;
}

/** Подпись сущности; неизвестная — как есть. */
export function entityLabelRu(entityType: string): string {
  return ENTITY_RU[entityType] ?? entityType;
}

/** Вариант badge; по умолчанию нейтральный. */
export function actionVariant(action: string): HistoryBadgeVariant {
  return ACTION_VARIANT[action] ?? "neutral";
}
