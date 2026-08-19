-- ТЗ №17 §3.1 — read-only проверка ПЕРЕД деплоем миграции
-- 20260819120000_tz17_latin_block_codes.
--
-- Отвечает на три вопроса:
--   1) сколько строк поменяет конверсия кир→лат;
--   2) упадёт ли миграция на предохранителе (два блока схлопнутся в один код);
--   3) какие коды останутся кириллическими (Б, Г, Д, Ж…) — их зав. склада
--      переименовывает вручную по бумажному плану (§4).
--
-- ⚠️ SELECT-ONLY. Ничего не меняет. Запуск: Neon SQL Editor / psql.

-- ═══════════ 1) Сколько строк затронет конверсия ═══════════

SELECT 'WarehouseBlock' AS "table", COUNT(*) AS "will_change"
FROM "WarehouseBlock"
WHERE letter <> TRANSLATE(UPPER(letter), 'АВСЕНКМОРТХУ', 'ABCEHKMOPTXY')
UNION ALL
SELECT 'BatchLocation', COUNT(*)
FROM "BatchLocation"
WHERE block <> TRANSLATE(UPPER(block), 'АВСЕНКМОРТХУ', 'ABCEHKMOPTXY')
UNION ALL
SELECT 'Slab', COUNT(*)
FROM "Slab"
WHERE block <> TRANSLATE(UPPER(block), 'АВСЕНКМОРТХУ', 'ABCEHKMOPTXY')
UNION ALL
SELECT 'Piece', COUNT(*)
FROM "Piece"
WHERE block <> TRANSLATE(UPPER(block), 'АВСЕНКМОРТХУ', 'ABCEHKMOPTXY');

-- Что именно во что превратится (сетка склада).
SELECT
  letter AS "было",
  TRANSLATE(UPPER(letter), 'АВСЕНКМОРТХУ', 'ABCEHKMOPTXY') AS "станет"
FROM "WarehouseBlock"
ORDER BY 2;

-- ═══════════ 2) Конфликты — миграция упадёт, если тут есть строки ═══════════

SELECT
  TRANSLATE(UPPER(letter), 'АВСЕНКМОРТХУ', 'ABCEHKMOPTXY') AS "общий_код",
  COUNT(*)                                                  AS "сколько_блоков",
  ARRAY_AGG(letter ORDER BY letter)                         AS "исходные_коды"
FROM "WarehouseBlock"
GROUP BY 1
HAVING COUNT(*) > 1
ORDER BY 2 DESC;

-- Если строки есть — где лежит камень каждого из конфликтующих блоков
-- (чтобы решить, какой блок оставить и куда перенести).
SELECT block AS "код_блока", COUNT(*) AS "локаций_партий"
FROM "BatchLocation"
GROUP BY 1
ORDER BY 2 DESC;

-- ═══════════ 3) Останется кириллица без латинского двойника ═══════════
-- Эти коды миграция НЕ трогает — переименование вручную (§4), после того как
-- зав. склада физически сверит, какому ряду плана они соответствуют.

SELECT letter AS "останется_кириллицей"
FROM "WarehouseBlock"
WHERE TRANSLATE(UPPER(letter), 'АВСЕНКМОРТХУ', 'ABCEHKMOPTXY') !~ '^[A-Z0-9 -]*$'
ORDER BY 1;

SELECT DISTINCT block AS "останется_кириллицей_в_камне"
FROM "BatchLocation"
WHERE TRANSLATE(UPPER(block), 'АВСЕНКМОРТХУ', 'ABCEHKMOPTXY') !~ '^[A-Z0-9 -]*$'
ORDER BY 1;
