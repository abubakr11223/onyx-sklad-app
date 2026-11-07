-- ТЗ №20 H — карточка камня по скану (§9). Только добавления: старые заявки
-- получают source = PARTNER и пустые новые поля; createdById становится
-- необязательным (заявка клиента без входа), существующие значения не трогаются.

-- §9.1 — «Ориентир цены» вида камня (сум/м², $/м²).
ALTER TABLE "StoneType" ADD COLUMN "priceHintUzsM2" DECIMAL(14,2);
ALTER TABLE "StoneType" ADD COLUMN "priceHintUsdM2" DECIMAL(14,2);

-- §9.2 — заявка клиента с карточки: источник «QR / каталог».
CREATE TYPE "LeadSource" AS ENUM ('PARTNER', 'QR_CATALOG');

ALTER TABLE "Lead" ALTER COLUMN "createdById" DROP NOT NULL;
ALTER TABLE "Lead" ADD COLUMN "source" "LeadSource" NOT NULL DEFAULT 'PARTNER';
ALTER TABLE "Lead" ADD COLUMN "clientName" TEXT;
ALTER TABLE "Lead" ADD COLUMN "clientPhone" TEXT;
ALTER TABLE "Lead" ADD COLUMN "phoneKey" TEXT;
ALTER TABLE "Lead" ADD COLUMN "clientId" TEXT;
ALTER TABLE "Lead" ADD COLUMN "stoneCode" TEXT;
ALTER TABLE "Lead" ADD COLUMN "dedupeKey" TEXT;

CREATE UNIQUE INDEX "Lead_dedupeKey_key" ON "Lead"("dedupeKey");
CREATE INDEX "Lead_clientId_idx" ON "Lead"("clientId");
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- §9.3 — счётчик сканирований: дневной агрегат по коду.
CREATE TABLE "StoneCodeScan" (
  "code" TEXT NOT NULL,
  "day" DATE NOT NULL,
  "stoneTypeId" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StoneCodeScan_pkey" PRIMARY KEY ("code", "day")
);
CREATE INDEX "StoneCodeScan_day_idx" ON "StoneCodeScan"("day");
CREATE INDEX "StoneCodeScan_stoneTypeId_idx" ON "StoneCodeScan"("stoneTypeId");
ALTER TABLE "StoneCodeScan" ADD CONSTRAINT "StoneCodeScan_stoneTypeId_fkey"
  FOREIGN KEY ("stoneTypeId") REFERENCES "StoneType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
