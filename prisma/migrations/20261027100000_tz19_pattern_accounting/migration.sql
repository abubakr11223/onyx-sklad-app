-- ТЗ №19 — учёт по узорам (подгруппам) во всех операциях.
-- Только ADDITIVE: новые nullable-колонки + FK + индексы. Старые строки
-- остаются NULL = «однородная партия / legacy» — миграция данных не нужна (§2 п.5).

-- Плита, выделенная из узора (шоу-рум, фотозапрос, Разбить → Плита).
ALTER TABLE "Slab" ADD COLUMN "batchPatternId" TEXT;
ALTER TABLE "Slab"
  ADD CONSTRAINT "Slab_batchPatternId_fkey"
  FOREIGN KEY ("batchPatternId") REFERENCES "BatchPattern"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Slab_batchPatternId_idx" ON "Slab"("batchPatternId");

-- Бой прямо из узора (Разбить → Бой в партии).
ALTER TABLE "Piece" ADD COLUMN "batchPatternId" TEXT;
ALTER TABLE "Piece"
  ADD CONSTRAINT "Piece_batchPatternId_fkey"
  FOREIGN KEY ("batchPatternId") REFERENCES "BatchPattern"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Piece_batchPatternId_idx" ON "Piece"("batchPatternId");

-- Бронь из узора + клиент из справочника.
ALTER TABLE "Reservation" ADD COLUMN "batchPatternId" TEXT;
ALTER TABLE "Reservation" ADD COLUMN "clientId" TEXT;
ALTER TABLE "Reservation"
  ADD CONSTRAINT "Reservation_batchPatternId_fkey"
  FOREIGN KEY ("batchPatternId") REFERENCES "BatchPattern"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Reservation"
  ADD CONSTRAINT "Reservation_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Reservation_batchPatternId_idx" ON "Reservation"("batchPatternId");
CREATE INDEX "Reservation_clientId_idx" ON "Reservation"("clientId");

-- Образец из узора.
ALTER TABLE "Sample" ADD COLUMN "batchPatternId" TEXT;
ALTER TABLE "Sample"
  ADD CONSTRAINT "Sample_batchPatternId_fkey"
  FOREIGN KEY ("batchPatternId") REFERENCES "BatchPattern"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Sample_batchPatternId_idx" ON "Sample"("batchPatternId");

-- Строка отгрузки: узор + место, откуда брать (возврат — туда же).
ALTER TABLE "ShipmentLine" ADD COLUMN "batchPatternId" TEXT;
ALTER TABLE "ShipmentLine" ADD COLUMN "batchLocationId" TEXT;
ALTER TABLE "ShipmentLine"
  ADD CONSTRAINT "ShipmentLine_batchPatternId_fkey"
  FOREIGN KEY ("batchPatternId") REFERENCES "BatchPattern"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ShipmentLine"
  ADD CONSTRAINT "ShipmentLine_batchLocationId_fkey"
  FOREIGN KEY ("batchLocationId") REFERENCES "BatchLocation"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
