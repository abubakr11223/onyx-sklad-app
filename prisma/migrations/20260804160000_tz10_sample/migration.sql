-- TZ №10 Этап 4 — Sample (образцы) + UnitStatus.SAMPLE + AuditAction sample events.
-- Additive only. Partial unique indexes prevent double-issue of same unit.
-- CHECK targetType↔FK like SaleRecord. OVERDUE is NOT a status.

DO $$ BEGIN
  ALTER TYPE "UnitStatus" ADD VALUE IF NOT EXISTS 'SAMPLE';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SampleStatus" AS ENUM ('ACTIVE', 'RETURNED', 'SOLD');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SAMPLE_ISSUE';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SAMPLE_RETURN';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SAMPLE_SELL';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SAMPLE_EXTEND';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "Sample" (
    "id" TEXT NOT NULL,
    "targetType" "SaleTarget" NOT NULL,
    "slabId" TEXT,
    "pieceId" TEXT,
    "batchId" TEXT,
    "qtySlabs" INTEGER,
    "qtyAreaM2" DECIMAL(12,3),
    "clientId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnDueDate" TIMESTAMP(3) NOT NULL,
    "depositAmount" DECIMAL(14,2),
    "depositCurrency" "Currency",
    "depositReturnedAt" TIMESTAMP(3),
    "comment" TEXT,
    "photoUrl" TEXT,
    "locationNote" TEXT,
    "managerId" TEXT NOT NULL,
    "status" "SampleStatus" NOT NULL DEFAULT 'ACTIVE',
    "saleRecordId" TEXT,
    "linkedRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sample_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Sample_saleRecordId_key" ON "Sample"("saleRecordId");
CREATE INDEX IF NOT EXISTS "Sample_status_returnDueDate_idx" ON "Sample"("status", "returnDueDate");
CREATE INDEX IF NOT EXISTS "Sample_clientId_status_idx" ON "Sample"("clientId", "status");
CREATE INDEX IF NOT EXISTS "Sample_managerId_status_idx" ON "Sample"("managerId", "status");
CREATE INDEX IF NOT EXISTS "Sample_slabId_status_idx" ON "Sample"("slabId", "status");
CREATE INDEX IF NOT EXISTS "Sample_pieceId_status_idx" ON "Sample"("pieceId", "status");
CREATE INDEX IF NOT EXISTS "Sample_batchId_status_idx" ON "Sample"("batchId", "status");

-- Double-issue guard (two managers, concurrent) — DB only.
CREATE UNIQUE INDEX IF NOT EXISTS "sample_active_slab_uniq"
  ON "Sample" ("slabId") WHERE status = 'ACTIVE' AND "slabId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "sample_active_piece_uniq"
  ON "Sample" ("pieceId") WHERE status = 'ACTIVE' AND "pieceId" IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE "Sample" ADD CONSTRAINT "Sample_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Sample" ADD CONSTRAINT "Sample_managerId_fkey"
    FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Sample" ADD CONSTRAINT "Sample_slabId_fkey"
    FOREIGN KEY ("slabId") REFERENCES "Slab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Sample" ADD CONSTRAINT "Sample_pieceId_fkey"
    FOREIGN KEY ("pieceId") REFERENCES "Piece"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Sample" ADD CONSTRAINT "Sample_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Sample" ADD CONSTRAINT "Sample_saleRecordId_fkey"
    FOREIGN KEY ("saleRecordId") REFERENCES "SaleRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Sample" ADD CONSTRAINT "Sample_target_check"
    CHECK (
        ("targetType" = 'SLAB'
            AND "slabId" IS NOT NULL AND "pieceId" IS NULL AND "batchId" IS NULL
            AND "qtySlabs" IS NULL AND "qtyAreaM2" IS NULL)
        OR ("targetType" = 'PIECE'
            AND "pieceId" IS NOT NULL AND "slabId" IS NULL AND "batchId" IS NULL
            AND "qtySlabs" IS NULL AND "qtyAreaM2" IS NULL)
        OR ("targetType" = 'BATCH_VOLUME'
            AND "batchId" IS NOT NULL AND "slabId" IS NULL AND "pieceId" IS NULL
            AND ("qtySlabs" IS NOT NULL OR "qtyAreaM2" IS NOT NULL))
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
