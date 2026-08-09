-- TZ №15 Slice 3 — UnitStatus.SHOWROOM + ShowroomPlacement.
-- Stock state changes on send (conditional UPDATE), not on warehouse confirm.
-- Hand-written, idempotent. Never apply via migrate dev against prod URL.

-- ── Enum values ──
DO $$ BEGIN
  ALTER TYPE "UnitStatus" ADD VALUE IF NOT EXISTS 'SHOWROOM';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SHOWROOM_SEND';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SHOWROOM_RETURN';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Placement metadata ──
CREATE TABLE IF NOT EXISTS "ShowroomPlacement" (
    "id" TEXT NOT NULL,
    "targetType" "SaleTarget" NOT NULL,
    "slabId" TEXT,
    "pieceId" TEXT,
    "standNote" TEXT,
    "sentById" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "shipmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShowroomPlacement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShowroomPlacement_shipmentId_key"
  ON "ShowroomPlacement"("shipmentId");
CREATE INDEX IF NOT EXISTS "ShowroomPlacement_closedAt_sentAt_idx"
  ON "ShowroomPlacement"("closedAt", "sentAt");
CREATE INDEX IF NOT EXISTS "ShowroomPlacement_slabId_closedAt_idx"
  ON "ShowroomPlacement"("slabId", "closedAt");
CREATE INDEX IF NOT EXISTS "ShowroomPlacement_pieceId_closedAt_idx"
  ON "ShowroomPlacement"("pieceId", "closedAt");
CREATE INDEX IF NOT EXISTS "ShowroomPlacement_sentById_sentAt_idx"
  ON "ShowroomPlacement"("sentById", "sentAt");

DO $$ BEGIN
  ALTER TABLE "ShowroomPlacement"
    ADD CONSTRAINT "ShowroomPlacement_slabId_fkey"
    FOREIGN KEY ("slabId") REFERENCES "Slab"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ShowroomPlacement"
    ADD CONSTRAINT "ShowroomPlacement_pieceId_fkey"
    FOREIGN KEY ("pieceId") REFERENCES "Piece"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ShowroomPlacement"
    ADD CONSTRAINT "ShowroomPlacement_sentById_fkey"
    FOREIGN KEY ("sentById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ShowroomPlacement"
    ADD CONSTRAINT "ShowroomPlacement_shipmentId_fkey"
    FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Target CHECK: SLAB xor PIECE only (no volume showroom in slice 3).
DO $$ BEGIN
  ALTER TABLE "ShowroomPlacement" ADD CONSTRAINT "ShowroomPlacement_target_check"
    CHECK (
      ("targetType" = 'SLAB'
        AND "slabId" IS NOT NULL AND "pieceId" IS NULL)
      OR ("targetType" = 'PIECE'
        AND "pieceId" IS NOT NULL AND "slabId" IS NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
