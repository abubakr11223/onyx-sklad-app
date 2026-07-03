/*
  Warnings:

  - You are about to drop the `HealthCheck` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "UnitStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'SOLD', 'BROKEN_OFFCUT', 'RETURNED');

-- CreateEnum
CREATE TYPE "PieceKind" AS ENUM ('BROKEN', 'OFFCUT');

-- CreateEnum
CREATE TYPE "ReservationTarget" AS ENUM ('SLAB', 'PIECE', 'BATCH_VOLUME');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'MANAGER', 'WAREHOUSE', 'PARTNER');

-- CreateEnum
CREATE TYPE "PhotoRequestStatus" AS ENUM ('PENDING', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PhotoKind" AS ENUM ('SLAB', 'PIECE', 'SAMPLE', 'INTERIOR_AI', 'DRAWING');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('INTAKE', 'SALE', 'RESERVE', 'RESERVE_CANCEL', 'RESERVE_EXPIRE', 'SEPARATE_SLAB', 'BREAK', 'SPLIT', 'MOVE', 'PHOTO_REQUEST', 'PHOTO_UPLOAD', 'RETURN', 'ADJUSTMENT', 'STATUS_CHANGE');

-- CreateEnum
CREATE TYPE "SaleTarget" AS ENUM ('SLAB', 'PIECE', 'BATCH_VOLUME');

-- DropTable
DROP TABLE "HealthCheck";

-- CreateTable
CREATE TABLE "StoneType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rockType" TEXT NOT NULL,
    "color" TEXT,
    "description" TEXT,
    "properties" JSONB,
    "basePrice" DECIMAL(12,2),
    "purchasePrice" DECIMAL(12,2),
    "textureFileUrl" TEXT,
    "qrSlug" TEXT NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoneType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL,
    "stoneTypeId" TEXT NOT NULL,
    "arrivedAt" TIMESTAMP(3) NOT NULL,
    "supplierNote" TEXT,
    "slabsTotal" INTEGER,
    "areaTotalM2" DECIMAL(12,3),
    "slabsSoldDirect" INTEGER NOT NULL DEFAULT 0,
    "areaSoldDirectM2" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "slabsAdjusted" INTEGER NOT NULL DEFAULT 0,
    "areaAdjustedM2" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "purchasePrice" DECIMAL(12,2),
    "needsCheck" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchLocation" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "block" TEXT NOT NULL,
    "landmark" TEXT NOT NULL,
    "slabsHere" INTEGER,
    "areaHereM2" DECIMAL(12,3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BatchLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Slab" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "stoneTypeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" "UnitStatus" NOT NULL DEFAULT 'AVAILABLE',
    "lengthMm" INTEGER,
    "widthMm" INTEGER,
    "thicknessMm" INTEGER,
    "areaM2" DECIMAL(12,3),
    "isAreaEstimated" BOOLEAN NOT NULL DEFAULT true,
    "block" TEXT NOT NULL,
    "landmark" TEXT NOT NULL,
    "needsCheck" BOOLEAN NOT NULL DEFAULT false,
    "photoRequestId" TEXT,
    "separatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Slab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Piece" (
    "id" TEXT NOT NULL,
    "stoneTypeId" TEXT NOT NULL,
    "batchId" TEXT,
    "originSlabId" TEXT,
    "kind" "PieceKind" NOT NULL,
    "status" "UnitStatus" NOT NULL DEFAULT 'AVAILABLE',
    "sidesMm" JSONB NOT NULL,
    "boundingLengthMm" INTEGER NOT NULL,
    "boundingWidthMm" INTEGER NOT NULL,
    "thicknessMm" INTEGER,
    "areaM2" DECIMAL(12,3),
    "drawingUrl" TEXT,
    "block" TEXT NOT NULL,
    "landmark" TEXT NOT NULL,
    "needsCheck" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Piece_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "targetType" "ReservationTarget" NOT NULL,
    "slabId" TEXT,
    "pieceId" TEXT,
    "batchId" TEXT,
    "qtySlabs" INTEGER,
    "qtyAreaM2" DECIMAL(12,3),
    "managerId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerContact" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "phone" TEXT,
    "telegramId" TEXT,
    "email" TEXT,
    "passwordHash" TEXT,
    "canSeePurchasePrice" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoRequest" (
    "id" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "batchId" TEXT NOT NULL,
    "batchLocationId" TEXT,
    "slabId" TEXT,
    "comment" TEXT,
    "status" "PhotoRequestStatus" NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhotoRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "kind" "PhotoKind" NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "takenById" TEXT,
    "stoneTypeId" TEXT,
    "slabId" TEXT,
    "pieceId" TEXT,
    "photoRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleRecord" (
    "id" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerContact" TEXT,
    "targetType" "SaleTarget" NOT NULL,
    "slabId" TEXT,
    "pieceId" TEXT,
    "batchId" TEXT,
    "qtySlabs" INTEGER,
    "qtyAreaM2" DECIMAL(12,3),
    "price" DECIMAL(12,2),
    "soldAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaleRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoneType_name_key" ON "StoneType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "StoneType_qrSlug_key" ON "StoneType"("qrSlug");

-- CreateIndex
CREATE INDEX "StoneType_rockType_idx" ON "StoneType"("rockType");

-- CreateIndex
CREATE INDEX "StoneType_color_idx" ON "StoneType"("color");

-- CreateIndex
CREATE INDEX "Batch_stoneTypeId_idx" ON "Batch"("stoneTypeId");

-- CreateIndex
CREATE INDEX "Batch_arrivedAt_idx" ON "Batch"("arrivedAt");

-- CreateIndex
CREATE INDEX "Batch_stoneTypeId_needsCheck_idx" ON "Batch"("stoneTypeId", "needsCheck");

-- CreateIndex
CREATE INDEX "BatchLocation_batchId_idx" ON "BatchLocation"("batchId");

-- CreateIndex
CREATE INDEX "BatchLocation_block_landmark_idx" ON "BatchLocation"("block", "landmark");

-- CreateIndex
CREATE INDEX "Slab_stoneTypeId_status_idx" ON "Slab"("stoneTypeId", "status");

-- CreateIndex
CREATE INDEX "Slab_batchId_idx" ON "Slab"("batchId");

-- CreateIndex
CREATE INDEX "Slab_block_landmark_idx" ON "Slab"("block", "landmark");

-- CreateIndex
CREATE UNIQUE INDEX "Slab_batchId_label_key" ON "Slab"("batchId", "label");

-- CreateIndex
CREATE INDEX "Piece_stoneTypeId_status_idx" ON "Piece"("stoneTypeId", "status");

-- CreateIndex
CREATE INDEX "Piece_status_boundingLengthMm_boundingWidthMm_idx" ON "Piece"("status", "boundingLengthMm", "boundingWidthMm");

-- CreateIndex
CREATE INDEX "Piece_batchId_idx" ON "Piece"("batchId");

-- CreateIndex
CREATE INDEX "Piece_block_landmark_idx" ON "Piece"("block", "landmark");

-- CreateIndex
CREATE INDEX "Reservation_status_expiresAt_idx" ON "Reservation"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Reservation_managerId_status_idx" ON "Reservation"("managerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "PhotoRequest_status_createdAt_idx" ON "PhotoRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PhotoRequest_assigneeId_status_idx" ON "PhotoRequest"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "PhotoRequest_managerId_idx" ON "PhotoRequest"("managerId");

-- CreateIndex
CREATE INDEX "Photo_slabId_idx" ON "Photo"("slabId");

-- CreateIndex
CREATE INDEX "Photo_pieceId_idx" ON "Photo"("pieceId");

-- CreateIndex
CREATE INDEX "Photo_stoneTypeId_kind_idx" ON "Photo"("stoneTypeId", "kind");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AppConfig_key_key" ON "AppConfig"("key");

-- CreateIndex
CREATE INDEX "SaleRecord_managerId_soldAt_idx" ON "SaleRecord"("managerId", "soldAt");

-- CreateIndex
CREATE INDEX "SaleRecord_soldAt_idx" ON "SaleRecord"("soldAt");

-- CreateIndex
CREATE INDEX "SaleRecord_batchId_idx" ON "SaleRecord"("batchId");

-- CreateIndex
CREATE INDEX "SaleRecord_slabId_idx" ON "SaleRecord"("slabId");

-- CreateIndex
CREATE INDEX "SaleRecord_pieceId_idx" ON "SaleRecord"("pieceId");

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_stoneTypeId_fkey" FOREIGN KEY ("stoneTypeId") REFERENCES "StoneType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchLocation" ADD CONSTRAINT "BatchLocation_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Slab" ADD CONSTRAINT "Slab_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Slab" ADD CONSTRAINT "Slab_stoneTypeId_fkey" FOREIGN KEY ("stoneTypeId") REFERENCES "StoneType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Slab" ADD CONSTRAINT "Slab_photoRequestId_fkey" FOREIGN KEY ("photoRequestId") REFERENCES "PhotoRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Slab" ADD CONSTRAINT "Slab_separatedById_fkey" FOREIGN KEY ("separatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Piece" ADD CONSTRAINT "Piece_stoneTypeId_fkey" FOREIGN KEY ("stoneTypeId") REFERENCES "StoneType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Piece" ADD CONSTRAINT "Piece_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Piece" ADD CONSTRAINT "Piece_originSlabId_fkey" FOREIGN KEY ("originSlabId") REFERENCES "Slab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Piece" ADD CONSTRAINT "Piece_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_slabId_fkey" FOREIGN KEY ("slabId") REFERENCES "Slab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_pieceId_fkey" FOREIGN KEY ("pieceId") REFERENCES "Piece"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoRequest" ADD CONSTRAINT "PhotoRequest_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoRequest" ADD CONSTRAINT "PhotoRequest_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoRequest" ADD CONSTRAINT "PhotoRequest_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoRequest" ADD CONSTRAINT "PhotoRequest_batchLocationId_fkey" FOREIGN KEY ("batchLocationId") REFERENCES "BatchLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoRequest" ADD CONSTRAINT "PhotoRequest_slabId_fkey" FOREIGN KEY ("slabId") REFERENCES "Slab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_takenById_fkey" FOREIGN KEY ("takenById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_stoneTypeId_fkey" FOREIGN KEY ("stoneTypeId") REFERENCES "StoneType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_slabId_fkey" FOREIGN KEY ("slabId") REFERENCES "Slab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_pieceId_fkey" FOREIGN KEY ("pieceId") REFERENCES "Piece"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_photoRequestId_fkey" FOREIGN KEY ("photoRequestId") REFERENCES "PhotoRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleRecord" ADD CONSTRAINT "SaleRecord_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleRecord" ADD CONSTRAINT "SaleRecord_slabId_fkey" FOREIGN KEY ("slabId") REFERENCES "Slab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleRecord" ADD CONSTRAINT "SaleRecord_pieceId_fkey" FOREIGN KEY ("pieceId") REFERENCES "Piece"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleRecord" ADD CONSTRAINT "SaleRecord_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- QO'LDA QO'SHILGAN QISM (S1-C) — Prisma sxema tilida ifodalab bo'lmaydigan
-- cheklovlar. Manba: docs/data-model.md §1.2, §1.6, §1.9, §1.12.
-- ─────────────────────────────────────────────────────────────────────────────

-- §1.6: bitta birlikda bir vaqtda faqat BITTA faol bron (TZ §7.5 — «bitta tosh
-- ikki klientga» DB darajasida yechiladi: birinchi INSERT o'tadi, ikkinchisi xato oladi).
CREATE UNIQUE INDEX "Reservation_slabId_active_key"
    ON "Reservation"("slabId")
    WHERE "status" = 'ACTIVE' AND "slabId" IS NOT NULL;

CREATE UNIQUE INDEX "Reservation_pieceId_active_key"
    ON "Reservation"("pieceId")
    WHERE "status" = 'ACTIVE' AND "pieceId" IS NOT NULL;

-- §1.2: slabsTotal va areaTotalM2 dan kamida bittasi to'ldirilgan bo'lishi shart
-- (TZ §5.1: «плиты и/или площадь»).
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_totals_check"
    CHECK ("slabsTotal" IS NOT NULL OR "areaTotalM2" IS NOT NULL);

-- §1.6: targetType ga mos FK to'ldirilgan, qolganlari null.
-- BATCH_VOLUME uchun qtySlabs/qtyAreaM2 dan kamida bittasi to'ldiriladi.
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_target_check"
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

-- §1.12: SaleRecord — Reservation bilan bir xil naqsh (ADR-006).
ALTER TABLE "SaleRecord" ADD CONSTRAINT "SaleRecord_target_check"
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

-- §1.9: «egasiz» foto bo'lmaydi — kamida bitta bog' to'ldirilgan.
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_owner_check"
    CHECK ("stoneTypeId" IS NOT NULL OR "slabId" IS NOT NULL OR "pieceId" IS NOT NULL);
