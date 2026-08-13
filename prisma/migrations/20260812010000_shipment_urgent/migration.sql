-- ТЗ №15 §8.5 — пометка «Срочно» на задаче отгрузки.
-- Согласовано 2026-08-12 (второй по приоритету после накладной).
--
-- Флаг, а не статус: срочность не меняет жизненный цикл отгрузки
-- (OPEN → PARTIAL → DONE), только порядок в очереди складчика.

ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "isUrgent" BOOLEAN NOT NULL DEFAULT false;

-- Очередь сортируется «срочные сверху, потом свежие» — индекс под этот порядок.
CREATE INDEX IF NOT EXISTS "Shipment_isUrgent_createdAt_idx"
    ON "Shipment"("isUrgent", "createdAt");
