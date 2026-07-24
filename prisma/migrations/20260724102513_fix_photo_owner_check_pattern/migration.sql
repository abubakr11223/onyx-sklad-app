-- ТЗ №3 — узор-фото. `add_batch_pattern` добавила Photo.batchPatternId, но НЕ
-- обновила Photo_owner_check (§1.9: «безхозного» фото не бывает). Из-за этого
-- вставка фото узор-подгруппы (только batchPatternId, без stoneType/slab/piece)
-- нарушала CHECK и падала на INSERT в проде — фото узора не сохранялось.
-- Добавляем batchPatternId в список допустимых «владельцев» фото.
ALTER TABLE "Photo" DROP CONSTRAINT "Photo_owner_check";
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_owner_check"
    CHECK (
        "stoneTypeId" IS NOT NULL
        OR "slabId" IS NOT NULL
        OR "pieceId" IS NOT NULL
        OR "batchPatternId" IS NOT NULL
    );
