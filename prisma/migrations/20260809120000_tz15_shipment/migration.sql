-- TZ №15 Slice 1 — Shipment + ShipmentLine for SALE hand-over tasks.
-- Stock write-off remains on sale TX; confirm only advances shipped qty.
-- Style: IF NOT EXISTS / DO EXCEPTION — idempotent (see 20260803120000_tz9_debt).

-- ── Enums ──
DO $$ BEGIN
  CREATE TYPE "ShipmentKind" AS ENUM ('SALE', 'SAMPLE', 'SHOWROOM');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SHIPMENT_CONFIRM';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── Shipment header ──
CREATE TABLE IF NOT EXISTS "Shipment" (
    "id" TEXT NOT NULL,
    "kind" "ShipmentKind" NOT NULL DEFAULT 'SALE',
    "saleRecordId" TEXT,
    "sampleId" TEXT,
    "managerId" TEXT NOT NULL,
    "clientId" TEXT,
    "siteId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Shipment_saleRecordId_key"
  ON "Shipment"("saleRecordId");
CREATE UNIQUE INDEX IF NOT EXISTS "Shipment_sampleId_key"
  ON "Shipment"("sampleId");
CREATE INDEX IF NOT EXISTS "Shipment_cancelledAt_completedAt_createdAt_idx"
  ON "Shipment"("cancelledAt", "completedAt", "createdAt");
CREATE INDEX IF NOT EXISTS "Shipment_managerId_createdAt_idx"
  ON "Shipment"("managerId", "createdAt");
CREATE INDEX IF NOT EXISTS "Shipment_kind_createdAt_idx"
  ON "Shipment"("kind", "createdAt");

DO $$ BEGIN
  ALTER TABLE "Shipment"
    ADD CONSTRAINT "Shipment_saleRecordId_fkey"
    FOREIGN KEY ("saleRecordId") REFERENCES "SaleRecord"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Shipment"
    ADD CONSTRAINT "Shipment_managerId_fkey"
    FOREIGN KEY ("managerId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Shipment"
    ADD CONSTRAINT "Shipment_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Shipment"
    ADD CONSTRAINT "Shipment_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Lines ──
CREATE TABLE IF NOT EXISTS "ShipmentLine" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "targetType" "SaleTarget" NOT NULL,
    "slabId" TEXT,
    "pieceId" TEXT,
    "batchId" TEXT,
    "qtyOrderedSlabs" INTEGER,
    "qtyOrderedAreaM2" DECIMAL(12,3),
    "qtyShippedSlabs" INTEGER NOT NULL DEFAULT 0,
    "qtyShippedAreaM2" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "locationSnapshot" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ShipmentLine_shipmentId_idx" ON "ShipmentLine"("shipmentId");
CREATE INDEX IF NOT EXISTS "ShipmentLine_slabId_idx" ON "ShipmentLine"("slabId");
CREATE INDEX IF NOT EXISTS "ShipmentLine_pieceId_idx" ON "ShipmentLine"("pieceId");
CREATE INDEX IF NOT EXISTS "ShipmentLine_batchId_idx" ON "ShipmentLine"("batchId");

DO $$ BEGIN
  ALTER TABLE "ShipmentLine"
    ADD CONSTRAINT "ShipmentLine_shipmentId_fkey"
    FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ShipmentLine"
    ADD CONSTRAINT "ShipmentLine_slabId_fkey"
    FOREIGN KEY ("slabId") REFERENCES "Slab"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ShipmentLine"
    ADD CONSTRAINT "ShipmentLine_pieceId_fkey"
    FOREIGN KEY ("pieceId") REFERENCES "Piece"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ShipmentLine"
    ADD CONSTRAINT "ShipmentLine_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "Batch"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Target CHECK (same spirit as SaleRecord): unit XOR volume FKs.
DO $$ BEGIN
  ALTER TABLE "ShipmentLine" ADD CONSTRAINT "ShipmentLine_target_check"
    CHECK (
      ("targetType" = 'SLAB'
        AND "slabId" IS NOT NULL AND "pieceId" IS NULL AND "batchId" IS NULL)
      OR ("targetType" = 'PIECE'
        AND "pieceId" IS NOT NULL AND "slabId" IS NULL AND "batchId" IS NULL)
      OR ("targetType" = 'BATCH_VOLUME'
        AND "batchId" IS NOT NULL AND "slabId" IS NULL AND "pieceId" IS NULL
        AND ("qtyOrderedSlabs" IS NOT NULL OR "qtyOrderedAreaM2" IS NOT NULL))
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
