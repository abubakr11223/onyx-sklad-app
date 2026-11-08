-- ТЗ №20 J — интерьеры, текстуры для 3D. Только добавления.

-- §11.1 — фото «В интерьере» (загрузка владельцем/менеджером).
ALTER TYPE "PhotoKind" ADD VALUE IF NOT EXISTS 'INTERIOR';
-- §11.2 — история загрузок текстур и «Интерес: скачал текстуру».
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TEXTURE_UPLOAD';
ALTER TYPE "LeadKind" ADD VALUE IF NOT EXISTS 'TEXTURE_DOWNLOAD';

CREATE TABLE "StoneTexture" (
  "id" TEXT NOT NULL,
  "stoneTypeId" TEXT NOT NULL,
  "batchId" TEXT,
  "batchPatternId" TEXT,
  "originalKey" TEXT NOT NULL,
  "previewKey" TEXT NOT NULL,
  "widthPx" INTEGER NOT NULL,
  "heightPx" INTEGER NOT NULL,
  "previewWidthPx" INTEGER NOT NULL,
  "previewHeightPx" INTEGER NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "aspectMismatch" BOOLEAN NOT NULL DEFAULT false,
  "zipKey" TEXT,
  "zipSignature" TEXT,
  "uploadedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StoneTexture_pkey" PRIMARY KEY ("id"),
  -- Ровно один владелец: узор ИЛИ однородная партия.
  CONSTRAINT "StoneTexture_owner_check" CHECK (
    ("batchId" IS NOT NULL AND "batchPatternId" IS NULL)
    OR ("batchId" IS NULL AND "batchPatternId" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "StoneTexture_batchId_key" ON "StoneTexture"("batchId");
CREATE UNIQUE INDEX "StoneTexture_batchPatternId_key" ON "StoneTexture"("batchPatternId");
CREATE INDEX "StoneTexture_stoneTypeId_idx" ON "StoneTexture"("stoneTypeId");
ALTER TABLE "StoneTexture" ADD CONSTRAINT "StoneTexture_stoneTypeId_fkey"
  FOREIGN KEY ("stoneTypeId") REFERENCES "StoneType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoneTexture" ADD CONSTRAINT "StoneTexture_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoneTexture" ADD CONSTRAINT "StoneTexture_batchPatternId_fkey"
  FOREIGN KEY ("batchPatternId") REFERENCES "BatchPattern"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoneTexture" ADD CONSTRAINT "StoneTexture_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
