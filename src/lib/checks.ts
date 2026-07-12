// SK-2 — Ручная пометка «проверить» (пересорт): TZ, обработка ошибок
// «Камень нашли, но по факту его нет → помечается «проверить»». Складчик,
// физически обнаружив расхождение, вручную ставит/снимает needsCheck на партии,
// плите или обрезке (Batch/Slab/Piece). Здесь — ЧИСТЫЕ (без DB, без next, без
// new Date()) хелперы: allowlist-гвард сущности, разбор булевого значения из
// формы и сборка self-описывающего payload'а для аудита STATUS_CHANGE. UI ga
// bog'liq narsa yo'q — bu funksiyalar server action'dan ham, kelajakdagi
// Telegram botdan ham chaqirilishi mumkin va alohida unit-testlanadi.
//
// Track B (ОТЛОЖЕНО, НЕ здесь): пометку «проверить» со стороны менеджера
// (canManageWarehouse=false). Пока — только склад (OWNER/WAREHOUSE) переключает.

// ──────────────────── Sof helperlar (DB YO'Q — unit-test) ────────────────────

/** Сущность склада, у которой есть флаг needsCheck (schema §Batch/Slab/Piece). */
export type CheckEntity = "Batch" | "Slab" | "Piece";

/** Ruxsat etilgan sущности roʻyxati — bitta manba (guard + delegate tanlash). */
const CHECK_ENTITIES: readonly CheckEntity[] = ["Batch", "Slab", "Piece"];

/**
 * Allowlist-гвард: пришедшая из формы строка — валидная CheckEntity?
 * Регистрозависимо (ровно «Batch»/«Slab»/«Piece»), чтобы entityType в аудите
 * совпадал с именем Prisma-модели. Type-guard → сужает тип у вызывающего.
 */
export function isValidCheckEntity(v: string): v is CheckEntity {
  return (CHECK_ENTITIES as readonly string[]).includes(v);
}

/**
 * Разбор желаемого булевого значения из строки формы. «1»/«true» (без учёта
 * регистра, с триммингом) → true; всё остальное (включая «0», «false», "") →
 * false. Скрытое поле формы несёт ПРОТИВОПОЛОЖНОЕ текущему значению (toggle),
 * поэтому разбор должен быть предсказуемым и тестируемым.
 */
export function parseCheckValue(raw: unknown): boolean {
  const s = String(raw ?? "").trim().toLowerCase();
  return s === "1" || s === "true";
}

/**
 * Self-описывающий payload для аудита STATUS_CHANGE: фиксируем сущность и
 * переход флага `{ needsCheck: { from, to } }`. Показываем обе стороны всегда
 * (в отличие от MOVE-дельты) — это булев toggle, полный переход информативен.
 * Чистая функция: никакого DB/времени внутри.
 */
export function buildCheckPayload(
  entity: CheckEntity,
  before: boolean,
  after: boolean,
): Record<string, unknown> {
  return { entity, needsCheck: { from: before, to: after } };
}
