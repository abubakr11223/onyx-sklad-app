-- ТЗ №12 — толщина в ДРОБНЫХ сантиметрах (решение владельца 2026-08-10).
--
-- Повод. Миграция 20260807120000 перевела все размеры в сантиметры и оставила
-- их целыми. Для длины и ширины это нормально (275×185 см), но толщина камня
-- на складе бывает 18 мм — в целых сантиметрах она непредставима: приходится
-- писать 2 см и терять реальный размер. Владелец подтвердил: 18 мм есть.
--
-- Расширение типа БЕЗОПАСНО и ОБРАТИМО по данным: INTEGER → NUMERIC(5,1)
-- сохраняет каждое существующее значение как есть (2 → 2.0, 3 → 3.0).
-- Никакого деления здесь НЕТ и быть не должно — значения уже в сантиметрах.
--
-- Затронуты только колонки толщины. Длина/ширина остаются INTEGER: там дробная
-- часть не нужна, а лишнее изменение типа — лишний риск.

ALTER TABLE "Batch"
  ALTER COLUMN "thicknessMm" TYPE NUMERIC(5, 1) USING "thicknessMm"::numeric(5, 1);

ALTER TABLE "BatchPattern"
  ALTER COLUMN "thicknessMm" TYPE NUMERIC(5, 1) USING "thicknessMm"::numeric(5, 1);

ALTER TABLE "Slab"
  ALTER COLUMN "thicknessMm" TYPE NUMERIC(5, 1) USING "thicknessMm"::numeric(5, 1);

ALTER TABLE "Piece"
  ALTER COLUMN "thicknessMm" TYPE NUMERIC(5, 1) USING "thicknessMm"::numeric(5, 1);

COMMENT ON COLUMN "Batch"."thicknessMm" IS 'ТЗ №12: толщина в см, дробная (legacy name Mm)';
COMMENT ON COLUMN "BatchPattern"."thicknessMm" IS 'ТЗ №12: толщина в см, дробная (legacy name Mm)';
COMMENT ON COLUMN "Slab"."thicknessMm" IS 'ТЗ №12: толщина в см, дробная (legacy name Mm)';
COMMENT ON COLUMN "Piece"."thicknessMm" IS 'ТЗ №12: толщина в см, дробная (legacy name Mm)';
