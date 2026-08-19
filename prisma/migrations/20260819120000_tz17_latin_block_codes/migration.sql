-- ТЗ №17 — Карта склада: единый алфавит ЛАТИНИЦА + заготовка под 2D-схему.
--
-- Две части:
--   1) WarehouseBlock: nullable-поля геометрии (§9). Данных не трогают.
--   2) Перевод кириллических «двойников» в кодах блока на латиницу (§3.1).
--
-- Почему это миграция, а не ручной скрипт: с этого релиза код нормализует ввод
-- В ЛАТИНИЦУ (src/lib/block-letter.ts). Если данные останутся кириллическими,
-- следующая же приёмка создаст ВТОРОЙ блок «B» рядом со старым «В» — ровно тот
-- тихий дубль, ради которого писался BUG-01. Поэтому конверсия едет вместе с
-- кодом, одной транзакцией.
--
-- Транслитерируются ТОЛЬКО 12 визуальных двойников (А В С Е Н К М О Р Т Х У).
-- Кириллица без латинского аналога (Б, Г, Д, Ж…) остаётся как есть: «Б»→«B»
-- столкнулось бы с «В»→«B» и молча слило бы два РАЗНЫХ блока. Такие коды
-- переименовывает зав. склада вручную после сверки с планом (§4).
--
-- ⚠️ Миграция ПАДАЕТ (и откатывается целиком), если после конверсии в
-- WarehouseBlock появились бы два блока с одинаковым кодом (например уже есть и
-- «В», и «B»). Это не сбой, а требование ручного решения: объединять блоки
-- молча нельзя — камень окажется не там, где лежит. Порядок действий в этом
-- случае: открыть «Карта склада», перенести камень из одного блока в другой,
-- удалить пустой, повторить деплой. Предварительно посмотреть, ждать ли
-- конфликта, можно read-only скриптом scripts/audit-tz17-check-latin.sql.
--
-- ShipmentLine.locationSnapshot НЕ трогаем: это исторический снимок адреса на
-- момент отгрузки, а не живая ссылка на блок. Переписывать историю нельзя.

-- ═══════════════ 1) Геометрия (§9) — заглушки, не заполняются ═══════════════

ALTER TABLE "WarehouseBlock"
  ADD COLUMN "x"      INTEGER,
  ADD COLUMN "y"      INTEGER,
  ADD COLUMN "width"  INTEGER,
  ADD COLUMN "height" INTEGER,
  ADD COLUMN "zone"   TEXT,
  ADD COLUMN "type"   TEXT;

-- ═══════════════ 2) Кириллица → латиница в кодах блока (§3.1) ═══════════════
-- Правило конверсии одно на все таблицы:
--   TRANSLATE(UPPER(code), 'АВСЕНКМОРТХУ', 'ABCEHKMOPTXY')
-- (слева — кириллица, справа — латиница; порядок символов совпадает).

-- Предохранитель: конверсия не должна схлопнуть два разных блока в один код.
DO $$
DECLARE
  dup TEXT;
BEGIN
  SELECT string_agg(t.code, ', ') INTO dup
  FROM (
    SELECT TRANSLATE(UPPER(letter), 'АВСЕНКМОРТХУ', 'ABCEHKMOPTXY') AS code
    FROM "WarehouseBlock"
    GROUP BY 1
    HAVING COUNT(*) > 1
  ) t;

  IF dup IS NOT NULL THEN
    RAISE EXCEPTION
      'ТЗ №17: перевод на латиницу схлопнул бы разные блоки в один код: %. Объедините их вручную в «Карта склада» и повторите деплой.', dup;
  END IF;
END $$;

UPDATE "WarehouseBlock"
   SET letter = TRANSLATE(UPPER(letter), 'АВСЕНКМОРТХУ', 'ABCEHKMOPTXY')
 WHERE letter <> TRANSLATE(UPPER(letter), 'АВСЕНКМОРТХУ', 'ABCEHKMOPTXY');

UPDATE "BatchLocation"
   SET block = TRANSLATE(UPPER(block), 'АВСЕНКМОРТХУ', 'ABCEHKMOPTXY')
 WHERE block <> TRANSLATE(UPPER(block), 'АВСЕНКМОРТХУ', 'ABCEHKMOPTXY');

UPDATE "Slab"
   SET block = TRANSLATE(UPPER(block), 'АВСЕНКМОРТХУ', 'ABCEHKMOPTXY')
 WHERE block <> TRANSLATE(UPPER(block), 'АВСЕНКМОРТХУ', 'ABCEHKMOPTXY');

UPDATE "Piece"
   SET block = TRANSLATE(UPPER(block), 'АВСЕНКМОРТХУ', 'ABCEHKMOPTXY')
 WHERE block <> TRANSLATE(UPPER(block), 'АВСЕНКМОРТХУ', 'ABCEHKMOPTXY');
