-- ТЗ №20 L — кабинет партнёра. Только добавления; существующие партнёры
-- получают тип «дизайнер» (§13.1).

CREATE TYPE "PartnerType" AS ENUM ('DESIGNER', 'FOREMAN', 'CONTRACTOR');
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LEAD_CREATE';

ALTER TABLE "User" ADD COLUMN "partnerType" "PartnerType";
ALTER TABLE "User" ADD COLUMN "partnerManagerId" TEXT;
ALTER TABLE "User" ADD CONSTRAINT "User_partnerManagerId_fkey"
  FOREIGN KEY ("partnerManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
UPDATE "User" SET "partnerType" = 'DESIGNER' WHERE "role" = 'PARTNER';

ALTER TABLE "Lead" ADD COLUMN "siteText" TEXT;
ALTER TABLE "Lead" ADD COLUMN "dueDate" TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN "saleRecordId" TEXT;
CREATE UNIQUE INDEX "Lead_saleRecordId_key" ON "Lead"("saleRecordId");
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_saleRecordId_fkey"
  FOREIGN KEY ("saleRecordId") REFERENCES "SaleRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
