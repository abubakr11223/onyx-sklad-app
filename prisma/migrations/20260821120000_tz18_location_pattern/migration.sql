-- ТЗ №18 §3 — «Что здесь»: привязка строки локации к узору партии.
-- NULL = «весь приход» (все существующие строки остаются как есть — §6,
-- миграция данных не нужна). ON DELETE SET NULL: удаление узора при правке
-- партии не сносит строку локации — она деградирует в «весь приход».

ALTER TABLE "BatchLocation" ADD COLUMN "batchPatternId" TEXT;

ALTER TABLE "BatchLocation"
  ADD CONSTRAINT "BatchLocation_batchPatternId_fkey"
  FOREIGN KEY ("batchPatternId") REFERENCES "BatchPattern"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "BatchLocation_batchPatternId_idx"
  ON "BatchLocation"("batchPatternId");
