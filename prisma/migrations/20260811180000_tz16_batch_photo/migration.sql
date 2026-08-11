-- ТЗ №16 B — общее фото партии при приёмке.
--
-- ⚠️ ГЛАВНОЕ В ЭТОЙ МИГРАЦИИ — ОБНОВЛЕНИЕ `Photo_owner_check`.
--
-- Прецедент: миграция `20260724102513_fix_photo_owner_check_pattern` появилась
-- ровно потому, что `batchPatternId` добавили БЕЗ обновления этого CHECK. Фото
-- узора нарушало ограничение и падало на INSERT — уже в проде, молча: приёмка
-- проходила, фото не сохранялось. Тесты этого не ловят (они мокают БД).
-- Поэтому колонка и ограничение меняются ОДНОЙ миграцией, а не «потом».

-- 1) Новый вид фото.
ALTER TYPE "PhotoKind" ADD VALUE IF NOT EXISTS 'BATCH';

-- 2) Владелец фото — партия.
ALTER TABLE "Photo" ADD COLUMN IF NOT EXISTS "batchId" TEXT;

ALTER TABLE "Photo"
    DROP CONSTRAINT IF EXISTS "Photo_batchId_fkey";
ALTER TABLE "Photo"
    ADD CONSTRAINT "Photo_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "Batch"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Photo_batchId_idx" ON "Photo"("batchId");

-- 3) §1.9 «безхозного» фото не бывает — batchId в список допустимых владельцев.
ALTER TABLE "Photo" DROP CONSTRAINT IF EXISTS "Photo_owner_check";
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_owner_check"
    CHECK (
        "stoneTypeId" IS NOT NULL
        OR "slabId" IS NOT NULL
        OR "pieceId" IS NOT NULL
        OR "batchPatternId" IS NOT NULL
        OR "batchId" IS NOT NULL
    );
