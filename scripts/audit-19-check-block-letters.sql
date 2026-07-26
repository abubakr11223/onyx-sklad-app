-- Аудит ТЗ №7 #19 — read-only проверка: есть ли в БД неканоничные буквы блока?
--
-- Каноничная форма после normalizeBlockLetter (src/lib/block-letter.ts):
--   • toUpperCase()
--   • латинские двойники → кириллица: A→А, B→В, C→С, E→Е, H→Н, K→К, M→М,
--                                     O→О, P→Р, T→Т, X→Х, Y→У
--
-- Значит «ненормализованный» блок = хотя бы одно НЕ-каноничное значение:
--   (a) не в верхнем регистре (буква = LOWER(буква)),
--   (b) равен одному из 12 латинских «двойников» (A/B/C/E/H/K/M/O/P/T/X/Y).
--
-- ⚠️ ЭТО SELECT-ONLY. Ничего не мигрирует. Только считает и показывает примеры.
--
-- Запуск в Neon SQL Editor / psql / Prisma Studio → «SQL» → paste и Run.
-- Не требует специальных прав, обычного read-only role хватает.

-- ═══════════════ 1) BatchLocation ═══════════════

-- Сколько строк с «ненормализованной» буквой? (агрегат)
SELECT
  'BatchLocation' AS "table",
  COUNT(*) FILTER (WHERE block <> UPPER(block))                                                        AS "lowercase_count",
  COUNT(*) FILTER (WHERE block IN ('A','B','C','E','H','K','M','O','P','T','X','Y'))                   AS "latin_uppercase_count",
  COUNT(*) FILTER (WHERE block <> UPPER(block)
                       OR block IN ('A','B','C','E','H','K','M','O','P','T','X','Y'))                  AS "total_denormalized"
FROM "BatchLocation";

-- Топ-20 «ненормализованных» значений с их частотой (для решения о миграции).
SELECT block, COUNT(*) AS cnt
FROM "BatchLocation"
WHERE block <> UPPER(block)
   OR block IN ('A','B','C','E','H','K','M','O','P','T','X','Y')
GROUP BY block
ORDER BY cnt DESC, block
LIMIT 20;

-- ═══════════════ 2) Slab ═══════════════

SELECT
  'Slab' AS "table",
  COUNT(*) FILTER (WHERE block <> UPPER(block))                                                        AS "lowercase_count",
  COUNT(*) FILTER (WHERE block IN ('A','B','C','E','H','K','M','O','P','T','X','Y'))                   AS "latin_uppercase_count",
  COUNT(*) FILTER (WHERE block <> UPPER(block)
                       OR block IN ('A','B','C','E','H','K','M','O','P','T','X','Y'))                  AS "total_denormalized"
FROM "Slab";

SELECT block, COUNT(*) AS cnt
FROM "Slab"
WHERE block <> UPPER(block)
   OR block IN ('A','B','C','E','H','K','M','O','P','T','X','Y')
GROUP BY block
ORDER BY cnt DESC, block
LIMIT 20;

-- ═══════════════ 3) Piece ═══════════════

SELECT
  'Piece' AS "table",
  COUNT(*) FILTER (WHERE block <> UPPER(block))                                                        AS "lowercase_count",
  COUNT(*) FILTER (WHERE block IN ('A','B','C','E','H','K','M','O','P','T','X','Y'))                   AS "latin_uppercase_count",
  COUNT(*) FILTER (WHERE block <> UPPER(block)
                       OR block IN ('A','B','C','E','H','K','M','O','P','T','X','Y'))                  AS "total_denormalized"
FROM "Piece";

SELECT block, COUNT(*) AS cnt
FROM "Piece"
WHERE block <> UPPER(block)
   OR block IN ('A','B','C','E','H','K','M','O','P','T','X','Y')
GROUP BY block
ORDER BY cnt DESC, block
LIMIT 20;

-- ═══════════════ 4) WarehouseBlock (сама сетка) ═══════════════

SELECT
  'WarehouseBlock' AS "table",
  COUNT(*) FILTER (WHERE letter <> UPPER(letter))                                                      AS "lowercase_count",
  COUNT(*) FILTER (WHERE letter IN ('A','B','C','E','H','K','M','O','P','T','X','Y'))                  AS "latin_uppercase_count",
  COUNT(*) FILTER (WHERE letter <> UPPER(letter)
                       OR letter IN ('A','B','C','E','H','K','M','O','P','T','X','Y'))                 AS "total_denormalized"
FROM "WarehouseBlock";

SELECT letter, COUNT(*) AS cnt
FROM "WarehouseBlock"
WHERE letter <> UPPER(letter)
   OR letter IN ('A','B','C','E','H','K','M','O','P','T','X','Y')
GROUP BY letter
ORDER BY cnt DESC, letter
LIMIT 20;

-- ═══════════════ 5) Кросс-проверка коллизий (стоит ли ждать конфликтов при миграции) ═══════════════

-- Пара «raw / normalized» присутствуют ОБЕ формы у BatchLocation одной партии?
-- Если да — миграция объединит две локации в одну; надо решать вручную.
WITH loc AS (
  SELECT
    "batchId",
    block AS raw_block,
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
    END AS norm_block
  FROM "BatchLocation"
)
SELECT
  "batchId",
  norm_block,
  COUNT(DISTINCT raw_block) AS distinct_raw_forms,
  ARRAY_AGG(DISTINCT raw_block ORDER BY raw_block) AS raw_forms
FROM loc
GROUP BY "batchId", norm_block
HAVING COUNT(DISTINCT raw_block) > 1
ORDER BY distinct_raw_forms DESC
LIMIT 20;
