-- ТЗ №12: все размеры → сантиметры (значения ÷10). Имена колонок *Mm legacy.
-- + обязательные габариты плиты на партии / узоре (nullable для старых записей).

-- 1) Slab
UPDATE "Slab"
SET
  "lengthMm" = CASE WHEN "lengthMm" IS NOT NULL THEN GREATEST(1, ("lengthMm" / 10)) ELSE NULL END,
  "widthMm" = CASE WHEN "widthMm" IS NOT NULL THEN GREATEST(1, ("widthMm" / 10)) ELSE NULL END,
  "thicknessMm" = CASE WHEN "thicknessMm" IS NOT NULL THEN GREATEST(1, ("thicknessMm" / 10)) ELSE NULL END;

-- 2) Piece: sidesMm JSON array of ints
UPDATE "Piece"
SET "sidesMm" = (
  SELECT COALESCE(jsonb_agg(GREATEST(1, (elem::numeric / 10)::int) ORDER BY ord), '[]'::jsonb)
  FROM jsonb_array_elements_text(COALESCE("sidesMm"::jsonb, '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord)
);

UPDATE "Piece"
SET
  "boundingLengthMm" = GREATEST(1, ("boundingLengthMm" / 10)),
  "boundingWidthMm" = GREATEST(1, ("boundingWidthMm" / 10)),
  "thicknessMm" = CASE WHEN "thicknessMm" IS NOT NULL THEN GREATEST(1, ("thicknessMm" / 10)) ELSE NULL END;
-- boundingAreaMm2 is GENERATED from L×W — recalculates automatically

-- 3) BatchPattern thickness
UPDATE "BatchPattern"
SET "thicknessMm" = CASE WHEN "thicknessMm" IS NOT NULL THEN GREATEST(1, ("thicknessMm" / 10)) ELSE NULL END;

-- 4) New batch-level plate dims (cm). Required only for NEW intakes (app validator).
ALTER TABLE "Batch"
  ADD COLUMN IF NOT EXISTS "lengthMm" INTEGER,
  ADD COLUMN IF NOT EXISTS "widthMm" INTEGER,
  ADD COLUMN IF NOT EXISTS "thicknessMm" INTEGER;

-- 5) Pattern-level length/width when plates differ within batch
ALTER TABLE "BatchPattern"
  ADD COLUMN IF NOT EXISTS "lengthMm" INTEGER,
  ADD COLUMN IF NOT EXISTS "widthMm" INTEGER;

-- 6) Comment on unit (Postgres)
COMMENT ON COLUMN "Slab"."lengthMm" IS 'ТЗ №12: значение в см (legacy name Mm)';
COMMENT ON COLUMN "Piece"."boundingLengthMm" IS 'ТЗ №12: значение в см (legacy name Mm)';
COMMENT ON COLUMN "Batch"."lengthMm" IS 'ТЗ №12: длина плиты партии, см';
