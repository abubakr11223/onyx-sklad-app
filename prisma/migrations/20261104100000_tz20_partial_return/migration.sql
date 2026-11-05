-- ТЗ №20 F — частичный возврат продажи. Только добавления: старые строки
-- получают нули (returned* = 0), их итоги в «Сводке»/«Клиентах» не меняются.

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'RETURN_ACCEPT';
CREATE TYPE "ReturnDestination" AS ENUM ('SAME_PATTERN', 'REMAINDER');

ALTER TABLE "SaleRecord" ADD COLUMN "returnedSlabs" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SaleRecord" ADD COLUMN "returnedAreaM2" DECIMAL(12,3) NOT NULL DEFAULT 0;
ALTER TABLE "SaleRecord" ADD COLUMN "returnedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

CREATE TABLE "SaleReturn" (
  "id" TEXT NOT NULL,
  "saleRecordId" TEXT NOT NULL,
  "qtySlabs" INTEGER,
  "qtyAreaM2" DECIMAL(12,3),
  "refundAmount" DECIMAL(14,2) NOT NULL,
  "debtReduction" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "cashRefund" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "method" "PaymentMethod",
  "destination" "ReturnDestination" NOT NULL DEFAULT 'SAME_PATTERN',
  "reason" TEXT,
  "isFull" BOOLEAN NOT NULL DEFAULT false,
  "immediateSlabs" INTEGER NOT NULL DEFAULT 0,
  "immediateAreaM2" DECIMAL(12,3) NOT NULL DEFAULT 0,
  "pendingSlabs" INTEGER NOT NULL DEFAULT 0,
  "pendingAreaM2" DECIMAL(12,3) NOT NULL DEFAULT 0,
  "parts" JSONB NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "acceptedById" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SaleReturn_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SaleReturn_saleRecordId_idx" ON "SaleReturn"("saleRecordId");
CREATE INDEX "SaleReturn_acceptedAt_createdAt_idx" ON "SaleReturn"("acceptedAt", "createdAt");
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_saleRecordId_fkey"
  FOREIGN KEY ("saleRecordId") REFERENCES "SaleRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_acceptedById_fkey"
  FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
