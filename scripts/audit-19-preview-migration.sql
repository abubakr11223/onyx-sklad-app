-- Аудит ТЗ №7 #19 — PREVIEW миграции: ПОКАЖЕТ, какие строки станут изменены
-- (BEFORE → AFTER + collision detection). НИЧЕГО НЕ МУТИРУЕТ.
--
-- Каноничная форма (см. normalizeBlockLetter в src/lib/block-letter.ts):
--   toUpperCase + 12 латинских двойников → кириллица (A→А, B→В, C→С, E→Е,
--   H→Н, K→К, M→М, O→О, P→Р, T→Т, X→Х, Y→У).
--
-- Запуск: Neon SQL Editor / psql `\i scripts/audit-19-preview-migration.sql`.

-- ═════════════ Helper: normalized() ═════════════
-- Возвращает каноничную форму буквы. Postgres-only (CASE + UPPER).
-- Вынесен в CTE (не CREATE FUNCTION) — не требует прав на владельца.

-- ═════════════ 1) BatchLocation — предпросмотр UPDATE ═════════════

WITH will_update AS (
  SELECT
    id,
    "batchId",
    block AS block_before,
    CASE
      WHEN UPPER(block) = 'A' THEN 'А'
      WHEN UPPER(block) = 'B' THEN 'В'
      WHEN UPPER(block) = 'C' THEN 'С'
      WHEN UPPER(block) = 'E' THEN 'Е'
      WHEN UPPER(block) = 'H' THEN 'Н'
      WHEN UPPER(block) = 'K' THEN 'К'
      WHEN UPPER(block) = 'M' THEN 'М'
      WHEN UPPER(block) = 'O' THEN 'О'
      WHEN UPPER(block) = 'P' THEN 'Р'
      WHEN UPPER(block) = 'T' THEN 'Т'
      WHEN UPPER(block) = 'X' THEN 'Х'
      WHEN UPPER(block) = 'Y' THEN 'У'
      ELSE UPPER(block)
    END AS block_after,
    landmark,
    "slabsHere",
    "areaHereM2"
  FROM "BatchLocation"
  WHERE block <> UPPER(block)
     OR block IN ('A','B','C','E','H','K','M','O','P','T','X','Y')
)
SELECT
  'BatchLocation' AS "table",
  id,
  "batchId",
  block_before,
  block_after,
  landmark,
  "slabsHere",
  "areaHereM2"
FROM will_update
ORDER BY "batchId", block_before, landmark;

-- ═════════════ 2) Slab — предпросмотр UPDATE ═════════════

WITH will_update AS (
  SELECT
    id,
    "batchId",
    label,
    block AS block_before,
    CASE
      WHEN UPPER(block) = 'A' THEN 'А' WHEN UPPER(block) = 'B' THEN 'В'
      WHEN UPPER(block) = 'C' THEN 'С' WHEN UPPER(block) = 'E' THEN 'Е'
      WHEN UPPER(block) = 'H' THEN 'Н' WHEN UPPER(block) = 'K' THEN 'К'
      WHEN UPPER(block) = 'M' THEN 'М' WHEN UPPER(block) = 'O' THEN 'О'
      WHEN UPPER(block) = 'P' THEN 'Р' WHEN UPPER(block) = 'T' THEN 'Т'
      WHEN UPPER(block) = 'X' THEN 'Х' WHEN UPPER(block) = 'Y' THEN 'У'
      ELSE UPPER(block)
    END AS block_after,
    landmark,
    status
  FROM "Slab"
  WHERE block <> UPPER(block)
     OR block IN ('A','B','C','E','H','K','M','O','P','T','X','Y')
)
SELECT
  'Slab' AS "table",
  id, "batchId", label, block_before, block_after, landmark, status
FROM will_update
ORDER BY "batchId", label;

-- ═════════════ 3) Piece — предпросмотр UPDATE ═════════════

WITH will_update AS (
  SELECT
    id,
    "batchId",
    kind,
    block AS block_before,
    CASE
      WHEN UPPER(block) = 'A' THEN 'А' WHEN UPPER(block) = 'B' THEN 'В'
      WHEN UPPER(block) = 'C' THEN 'С' WHEN UPPER(block) = 'E' THEN 'Е'
      WHEN UPPER(block) = 'H' THEN 'Н' WHEN UPPER(block) = 'K' THEN 'К'
      WHEN UPPER(block) = 'M' THEN 'М' WHEN UPPER(block) = 'O' THEN 'О'
      WHEN UPPER(block) = 'P' THEN 'Р' WHEN UPPER(block) = 'T' THEN 'Т'
      WHEN UPPER(block) = 'X' THEN 'Х' WHEN UPPER(block) = 'Y' THEN 'У'
      ELSE UPPER(block)
    END AS block_after,
    landmark,
    status
  FROM "Piece"
  WHERE block <> UPPER(block)
     OR block IN ('A','B','C','E','H','K','M','O','P','T','X','Y')
)
SELECT
  'Piece' AS "table",
  id, "batchId", kind, block_before, block_after, landmark, status
FROM will_update
ORDER BY "batchId", id;

-- ═════════════ 4) WarehouseBlock — предпросмотр UPDATE + COLLISION ═════════════
-- ⚠️ WarehouseBlock.letter — @unique. Если raw «E» И normalized «Е» уже ОБА
-- существуют — прямой UPDATE «E»→«Е» даст P2002. План действий:
--   • «Е» уже есть, «E» будет удалён (его landmarks мигрированы в «Е»);
--   • «E» есть, «Е» нет — прямой rename UPDATE.
-- Preview показывает обе категории отдельно.

WITH normalized AS (
  SELECT
    id,
    letter AS letter_before,
    CASE
      WHEN UPPER(letter) = 'A' THEN 'А' WHEN UPPER(letter) = 'B' THEN 'В'
      WHEN UPPER(letter) = 'C' THEN 'С' WHEN UPPER(letter) = 'E' THEN 'Е'
      WHEN UPPER(letter) = 'H' THEN 'Н' WHEN UPPER(letter) = 'K' THEN 'К'
      WHEN UPPER(letter) = 'M' THEN 'М' WHEN UPPER(letter) = 'O' THEN 'О'
      WHEN UPPER(letter) = 'P' THEN 'Р' WHEN UPPER(letter) = 'T' THEN 'Т'
      WHEN UPPER(letter) = 'X' THEN 'Х' WHEN UPPER(letter) = 'Y' THEN 'У'
      ELSE UPPER(letter)
    END AS letter_after,
    "sortOrder"
  FROM "WarehouseBlock"
  WHERE letter <> UPPER(letter)
     OR letter IN ('A','B','C','E','H','K','M','O','P','T','X','Y')
),
existing_letters AS (
  SELECT letter FROM "WarehouseBlock"
)
SELECT
  'WarehouseBlock' AS "table",
  n.id,
  n.letter_before,
  n.letter_after,
  n."sortOrder",
  CASE
    WHEN EXISTS (SELECT 1 FROM existing_letters e WHERE e.letter = n.letter_after)
      THEN '⚠ COLLISION: target letter already exists (merge/delete raw block)'
    ELSE 'rename OK'
  END AS action
FROM normalized n
ORDER BY n.letter_before;

-- ═════════════ 5) BatchLocation cross-collision (одна партия ↔ обе формы) ═════════════
-- Если в одной партии ЕСТЬ и raw «E», и normalized «Е» — миграция объединит
-- две локации в одну (batchId+block-ключ станет одинаковым). Это нормально
-- (BatchLocation НЕ имеет @@unique[batchId, block, landmark] — см. schema),
-- но полезно знать: могут появиться две BatchLocation-строки с одинаковым
-- ключом. При желании — вручную сложить slabsHere/areaHereM2 и оставить одну.

WITH norm AS (
  SELECT
    id,
    "batchId",
    landmark,
    block AS raw_block,
    CASE
      WHEN UPPER(block) = 'A' THEN 'А' WHEN UPPER(block) = 'B' THEN 'В'
      WHEN UPPER(block) = 'C' THEN 'С' WHEN UPPER(block) = 'E' THEN 'Е'
      WHEN UPPER(block) = 'H' THEN 'Н' WHEN UPPER(block) = 'K' THEN 'К'
      WHEN UPPER(block) = 'M' THEN 'М' WHEN UPPER(block) = 'O' THEN 'О'
      WHEN UPPER(block) = 'P' THEN 'Р' WHEN UPPER(block) = 'T' THEN 'Т'
      WHEN UPPER(block) = 'X' THEN 'Х' WHEN UPPER(block) = 'Y' THEN 'У'
      ELSE UPPER(block)
    END AS norm_block
  FROM "BatchLocation"
)
SELECT
  'BatchLocation cross-collision' AS "table",
  "batchId",
  norm_block,
  ARRAY_AGG(DISTINCT raw_block ORDER BY raw_block) AS raw_forms,
  COUNT(*) AS rows_involved
FROM norm
GROUP BY "batchId", norm_block
HAVING COUNT(DISTINCT raw_block) > 1
ORDER BY rows_involved DESC;

-- ═════════════ 6) Итоговый счётчик (что мигрируем) ═════════════

SELECT
  'BatchLocation'  AS "table",
  COUNT(*) FILTER (WHERE block <> UPPER(block)
                       OR block IN ('A','B','C','E','H','K','M','O','P','T','X','Y')) AS rows_to_migrate
FROM "BatchLocation"
UNION ALL
SELECT 'Slab',           COUNT(*) FILTER (WHERE block <> UPPER(block)
                       OR block IN ('A','B','C','E','H','K','M','O','P','T','X','Y'))
FROM "Slab"
UNION ALL
SELECT 'Piece',          COUNT(*) FILTER (WHERE block <> UPPER(block)
                       OR block IN ('A','B','C','E','H','K','M','O','P','T','X','Y'))
FROM "Piece"
UNION ALL
SELECT 'WarehouseBlock', COUNT(*) FILTER (WHERE letter <> UPPER(letter)
                       OR letter IN ('A','B','C','E','H','K','M','O','P','T','X','Y'))
FROM "WarehouseBlock";
