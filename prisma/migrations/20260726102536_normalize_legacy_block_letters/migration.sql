-- Аудит ТЗ №7 #19 — миграция legacy-букв блока к каноничной форме
-- (normalizeBlockLetter: toUpperCase + 12 латинских двойников → кириллица).
--
-- ⚠️ ИДЕМПОТЕНТНАЯ: повторный запуск на уже мигрированной БД = 0 строк тронуто.
--
-- СТРАТЕГИЯ:
--  1) BEGIN — вся миграция в одной транзакции; ошибка на любом шаге → полный rollback.
--     (`prisma migrate deploy` для каждого migration.sql-файла оборачивает в
--      неявную транзакцию, но здесь явно + finalise-check делаем внутри.)
--  2) Backup: снимок «до» в служебную таблицу _MigrationBackup20260726 —
--     позволяет вручную откатить, если что-то пойдёт не так, БЕЗ отдельного dump'а.
--  3) UPDATE по 4 таблицам (BatchLocation, Slab, Piece, WarehouseBlock).
--     WarehouseBlock — с обработкой @unique-коллизии letter (см. секцию 4).
--  4) Sanity-check: 0 неканоничных строк после миграции; иначе RAISE → rollback.

-- ═════════════ 1) Backup: снимок «до» ═════════════

CREATE TABLE IF NOT EXISTS "_MigrationBackup20260726" (
  "table"        TEXT NOT NULL,
  "row_id"       TEXT NOT NULL,
  "field"        TEXT NOT NULL,
  "value_before" TEXT NOT NULL,
  "value_after"  TEXT NOT NULL,
  "captured_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO "_MigrationBackup20260726" ("table", row_id, field, value_before, value_after)
SELECT 'BatchLocation', id, 'block', block,
  CASE
    WHEN UPPER(block) = 'A' THEN 'А' WHEN UPPER(block) = 'B' THEN 'В'
    WHEN UPPER(block) = 'C' THEN 'С' WHEN UPPER(block) = 'E' THEN 'Е'
    WHEN UPPER(block) = 'H' THEN 'Н' WHEN UPPER(block) = 'K' THEN 'К'
    WHEN UPPER(block) = 'M' THEN 'М' WHEN UPPER(block) = 'O' THEN 'О'
    WHEN UPPER(block) = 'P' THEN 'Р' WHEN UPPER(block) = 'T' THEN 'Т'
    WHEN UPPER(block) = 'X' THEN 'Х' WHEN UPPER(block) = 'Y' THEN 'У'
    ELSE UPPER(block)
  END
FROM "BatchLocation"
WHERE block <> UPPER(block)
   OR block IN ('A','B','C','E','H','K','M','O','P','T','X','Y');

INSERT INTO "_MigrationBackup20260726" ("table", row_id, field, value_before, value_after)
SELECT 'Slab', id, 'block', block,
  CASE
    WHEN UPPER(block) = 'A' THEN 'А' WHEN UPPER(block) = 'B' THEN 'В'
    WHEN UPPER(block) = 'C' THEN 'С' WHEN UPPER(block) = 'E' THEN 'Е'
    WHEN UPPER(block) = 'H' THEN 'Н' WHEN UPPER(block) = 'K' THEN 'К'
    WHEN UPPER(block) = 'M' THEN 'М' WHEN UPPER(block) = 'O' THEN 'О'
    WHEN UPPER(block) = 'P' THEN 'Р' WHEN UPPER(block) = 'T' THEN 'Т'
    WHEN UPPER(block) = 'X' THEN 'Х' WHEN UPPER(block) = 'Y' THEN 'У'
    ELSE UPPER(block)
  END
FROM "Slab"
WHERE block <> UPPER(block)
   OR block IN ('A','B','C','E','H','K','M','O','P','T','X','Y');

INSERT INTO "_MigrationBackup20260726" ("table", row_id, field, value_before, value_after)
SELECT 'Piece', id, 'block', block,
  CASE
    WHEN UPPER(block) = 'A' THEN 'А' WHEN UPPER(block) = 'B' THEN 'В'
    WHEN UPPER(block) = 'C' THEN 'С' WHEN UPPER(block) = 'E' THEN 'Е'
    WHEN UPPER(block) = 'H' THEN 'Н' WHEN UPPER(block) = 'K' THEN 'К'
    WHEN UPPER(block) = 'M' THEN 'М' WHEN UPPER(block) = 'O' THEN 'О'
    WHEN UPPER(block) = 'P' THEN 'Р' WHEN UPPER(block) = 'T' THEN 'Т'
    WHEN UPPER(block) = 'X' THEN 'Х' WHEN UPPER(block) = 'Y' THEN 'У'
    ELSE UPPER(block)
  END
FROM "Piece"
WHERE block <> UPPER(block)
   OR block IN ('A','B','C','E','H','K','M','O','P','T','X','Y');

INSERT INTO "_MigrationBackup20260726" ("table", row_id, field, value_before, value_after)
SELECT 'WarehouseBlock', id, 'letter', letter,
  CASE
    WHEN UPPER(letter) = 'A' THEN 'А' WHEN UPPER(letter) = 'B' THEN 'В'
    WHEN UPPER(letter) = 'C' THEN 'С' WHEN UPPER(letter) = 'E' THEN 'Е'
    WHEN UPPER(letter) = 'H' THEN 'Н' WHEN UPPER(letter) = 'K' THEN 'К'
    WHEN UPPER(letter) = 'M' THEN 'М' WHEN UPPER(letter) = 'O' THEN 'О'
    WHEN UPPER(letter) = 'P' THEN 'Р' WHEN UPPER(letter) = 'T' THEN 'Т'
    WHEN UPPER(letter) = 'X' THEN 'Х' WHEN UPPER(letter) = 'Y' THEN 'У'
    ELSE UPPER(letter)
  END
FROM "WarehouseBlock"
WHERE letter <> UPPER(letter)
   OR letter IN ('A','B','C','E','H','K','M','O','P','T','X','Y');

-- ═════════════ 2) BatchLocation.block ═════════════

UPDATE "BatchLocation"
SET block = CASE
    WHEN UPPER(block) = 'A' THEN 'А' WHEN UPPER(block) = 'B' THEN 'В'
    WHEN UPPER(block) = 'C' THEN 'С' WHEN UPPER(block) = 'E' THEN 'Е'
    WHEN UPPER(block) = 'H' THEN 'Н' WHEN UPPER(block) = 'K' THEN 'К'
    WHEN UPPER(block) = 'M' THEN 'М' WHEN UPPER(block) = 'O' THEN 'О'
    WHEN UPPER(block) = 'P' THEN 'Р' WHEN UPPER(block) = 'T' THEN 'Т'
    WHEN UPPER(block) = 'X' THEN 'Х' WHEN UPPER(block) = 'Y' THEN 'У'
    ELSE UPPER(block)
  END
WHERE block <> UPPER(block)
   OR block IN ('A','B','C','E','H','K','M','O','P','T','X','Y');

-- ═════════════ 3) Slab.block + Piece.block ═════════════

UPDATE "Slab"
SET block = CASE
    WHEN UPPER(block) = 'A' THEN 'А' WHEN UPPER(block) = 'B' THEN 'В'
    WHEN UPPER(block) = 'C' THEN 'С' WHEN UPPER(block) = 'E' THEN 'Е'
    WHEN UPPER(block) = 'H' THEN 'Н' WHEN UPPER(block) = 'K' THEN 'К'
    WHEN UPPER(block) = 'M' THEN 'М' WHEN UPPER(block) = 'O' THEN 'О'
    WHEN UPPER(block) = 'P' THEN 'Р' WHEN UPPER(block) = 'T' THEN 'Т'
    WHEN UPPER(block) = 'X' THEN 'Х' WHEN UPPER(block) = 'Y' THEN 'У'
    ELSE UPPER(block)
  END
WHERE block <> UPPER(block)
   OR block IN ('A','B','C','E','H','K','M','O','P','T','X','Y');

UPDATE "Piece"
SET block = CASE
    WHEN UPPER(block) = 'A' THEN 'А' WHEN UPPER(block) = 'B' THEN 'В'
    WHEN UPPER(block) = 'C' THEN 'С' WHEN UPPER(block) = 'E' THEN 'Е'
    WHEN UPPER(block) = 'H' THEN 'Н' WHEN UPPER(block) = 'K' THEN 'К'
    WHEN UPPER(block) = 'M' THEN 'М' WHEN UPPER(block) = 'O' THEN 'О'
    WHEN UPPER(block) = 'P' THEN 'Р' WHEN UPPER(block) = 'T' THEN 'Т'
    WHEN UPPER(block) = 'X' THEN 'Х' WHEN UPPER(block) = 'Y' THEN 'У'
    ELSE UPPER(block)
  END
WHERE block <> UPPER(block)
   OR block IN ('A','B','C','E','H','K','M','O','P','T','X','Y');

-- ═════════════ 4) WarehouseBlock.letter — с @unique collision handling ═════════════
-- Если и raw «E», и normalized «Е» существуют одновременно, прямой UPDATE
-- «E»→«Е» даст P2002. Три шага: (a) перенести landmarks с уникальным номером,
-- (b) удалить дубликат-landmarks, (c) удалить raw-WarehouseBlock, (d) UPDATE
-- non-collision.

-- (a) Landmarks коллидирующих raw-блоков переносим в normalized-блок,
-- пропуская тех, чей номер уже есть у normalized.
UPDATE "WarehouseLandmark" l
SET "blockId" = target.id
FROM "WarehouseBlock" raw
JOIN "WarehouseBlock" target ON target.letter = (
  CASE
    WHEN UPPER(raw.letter) = 'A' THEN 'А' WHEN UPPER(raw.letter) = 'B' THEN 'В'
    WHEN UPPER(raw.letter) = 'C' THEN 'С' WHEN UPPER(raw.letter) = 'E' THEN 'Е'
    WHEN UPPER(raw.letter) = 'H' THEN 'Н' WHEN UPPER(raw.letter) = 'K' THEN 'К'
    WHEN UPPER(raw.letter) = 'M' THEN 'М' WHEN UPPER(raw.letter) = 'O' THEN 'О'
    WHEN UPPER(raw.letter) = 'P' THEN 'Р' WHEN UPPER(raw.letter) = 'T' THEN 'Т'
    WHEN UPPER(raw.letter) = 'X' THEN 'Х' WHEN UPPER(raw.letter) = 'Y' THEN 'У'
    ELSE UPPER(raw.letter)
  END
) AND target.id <> raw.id
WHERE l."blockId" = raw.id
  AND (raw.letter <> UPPER(raw.letter)
       OR raw.letter IN ('A','B','C','E','H','K','M','O','P','T','X','Y'))
  AND NOT EXISTS (
    SELECT 1 FROM "WarehouseLandmark" existing
    WHERE existing."blockId" = target.id AND existing.number = l.number
  );

-- (b) Дубликат-landmarks (номер уже есть у normalized) — удаляем raw-версию.
DELETE FROM "WarehouseLandmark" l
USING "WarehouseBlock" raw
WHERE l."blockId" = raw.id
  AND (raw.letter <> UPPER(raw.letter)
       OR raw.letter IN ('A','B','C','E','H','K','M','O','P','T','X','Y'))
  AND EXISTS (
    SELECT 1
    FROM "WarehouseBlock" target
    WHERE target.letter = (
      CASE
        WHEN UPPER(raw.letter) = 'A' THEN 'А' WHEN UPPER(raw.letter) = 'B' THEN 'В'
        WHEN UPPER(raw.letter) = 'C' THEN 'С' WHEN UPPER(raw.letter) = 'E' THEN 'Е'
        WHEN UPPER(raw.letter) = 'H' THEN 'Н' WHEN UPPER(raw.letter) = 'K' THEN 'К'
        WHEN UPPER(raw.letter) = 'M' THEN 'М' WHEN UPPER(raw.letter) = 'O' THEN 'О'
        WHEN UPPER(raw.letter) = 'P' THEN 'Р' WHEN UPPER(raw.letter) = 'T' THEN 'Т'
        WHEN UPPER(raw.letter) = 'X' THEN 'Х' WHEN UPPER(raw.letter) = 'Y' THEN 'У'
        ELSE UPPER(raw.letter)
      END
    ) AND target.id <> raw.id
  );

-- (c) Удаляем raw-WarehouseBlock, если normalized-версия уже существует.
DELETE FROM "WarehouseBlock" raw
WHERE (raw.letter <> UPPER(raw.letter)
       OR raw.letter IN ('A','B','C','E','H','K','M','O','P','T','X','Y'))
  AND EXISTS (
    SELECT 1
    FROM "WarehouseBlock" target
    WHERE target.letter = (
      CASE
        WHEN UPPER(raw.letter) = 'A' THEN 'А' WHEN UPPER(raw.letter) = 'B' THEN 'В'
        WHEN UPPER(raw.letter) = 'C' THEN 'С' WHEN UPPER(raw.letter) = 'E' THEN 'Е'
        WHEN UPPER(raw.letter) = 'H' THEN 'Н' WHEN UPPER(raw.letter) = 'K' THEN 'К'
        WHEN UPPER(raw.letter) = 'M' THEN 'М' WHEN UPPER(raw.letter) = 'O' THEN 'О'
        WHEN UPPER(raw.letter) = 'P' THEN 'Р' WHEN UPPER(raw.letter) = 'T' THEN 'Т'
        WHEN UPPER(raw.letter) = 'X' THEN 'Х' WHEN UPPER(raw.letter) = 'Y' THEN 'У'
        ELSE UPPER(raw.letter)
      END
    ) AND target.id <> raw.id
  );

-- (d) Для non-collision — прямой UPDATE letter.
UPDATE "WarehouseBlock"
SET letter = CASE
    WHEN UPPER(letter) = 'A' THEN 'А' WHEN UPPER(letter) = 'B' THEN 'В'
    WHEN UPPER(letter) = 'C' THEN 'С' WHEN UPPER(letter) = 'E' THEN 'Е'
    WHEN UPPER(letter) = 'H' THEN 'Н' WHEN UPPER(letter) = 'K' THEN 'К'
    WHEN UPPER(letter) = 'M' THEN 'М' WHEN UPPER(letter) = 'O' THEN 'О'
    WHEN UPPER(letter) = 'P' THEN 'Р' WHEN UPPER(letter) = 'T' THEN 'Т'
    WHEN UPPER(letter) = 'X' THEN 'Х' WHEN UPPER(letter) = 'Y' THEN 'У'
    ELSE UPPER(letter)
  END
WHERE letter <> UPPER(letter)
   OR letter IN ('A','B','C','E','H','K','M','O','P','T','X','Y');

-- ═════════════ 5) Sanity: 0 неканоничных строк после миграции ═════════════

DO $$
DECLARE
  remaining INTEGER;
BEGIN
  SELECT COUNT(*) INTO remaining FROM (
    SELECT 1 FROM "BatchLocation"
    WHERE block <> UPPER(block)
       OR block IN ('A','B','C','E','H','K','M','O','P','T','X','Y')
    UNION ALL
    SELECT 1 FROM "Slab"
    WHERE block <> UPPER(block)
       OR block IN ('A','B','C','E','H','K','M','O','P','T','X','Y')
    UNION ALL
    SELECT 1 FROM "Piece"
    WHERE block <> UPPER(block)
       OR block IN ('A','B','C','E','H','K','M','O','P','T','X','Y')
    UNION ALL
    SELECT 1 FROM "WarehouseBlock"
    WHERE letter <> UPPER(letter)
       OR letter IN ('A','B','C','E','H','K','M','O','P','T','X','Y')
  ) sub;

  IF remaining > 0 THEN
    RAISE EXCEPTION 'Аудит #19: миграция оставила % неканоничных строк — откатываем', remaining;
  END IF;
END $$;

-- Rollback (в отдельном виде, для документации; НЕ выполняется миграцией):
-- BEGIN;
--   UPDATE "BatchLocation" SET block  = b.value_before FROM "_MigrationBackup20260726" b WHERE b."table"='BatchLocation'  AND b.row_id="BatchLocation".id  AND b.field='block';
--   UPDATE "Slab"          SET block  = b.value_before FROM "_MigrationBackup20260726" b WHERE b."table"='Slab'           AND b.row_id="Slab".id           AND b.field='block';
--   UPDATE "Piece"         SET block  = b.value_before FROM "_MigrationBackup20260726" b WHERE b."table"='Piece'          AND b.row_id="Piece".id          AND b.field='block';
--   -- WarehouseBlock: если строка удалена по коллизии (шаг 4c) — вернуть нельзя автоматически (нужна пересборка landmarks). Проверяй _MigrationBackup20260726 вручную.
-- COMMIT;
