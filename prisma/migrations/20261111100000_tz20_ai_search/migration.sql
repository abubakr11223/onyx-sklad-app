-- ТЗ №20 K — ИИ-поиск камня: признаки узора/партии и журнал запросов.
-- Только добавления; признаки появятся после фонового пересчёта.

CREATE TYPE "StoneTone" AS ENUM ('LIGHT', 'MEDIUM', 'DARK');
CREATE TYPE "StonePattern" AS ENUM ('UNIFORM', 'CLOUDY', 'VEINS', 'BOLD_VEINS', 'BRECCIA');
CREATE TYPE "TraitsSource" AS ENUM ('AI', 'MANUAL');
CREATE TYPE "AiSearchChannel" AS ENUM ('STAFF', 'CATALOG', 'BOT');
CREATE TYPE "AiSearchKind" AS ENUM ('TEXT', 'PHOTO');
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TRAITS_EDIT';

CREATE TABLE "StoneTraits" (
  "id" TEXT NOT NULL,
  "stoneTypeId" TEXT NOT NULL,
  "batchId" TEXT,
  "batchPatternId" TEXT,
  "color" TEXT,
  "tone" "StoneTone",
  "pattern" "StonePattern",
  "veinColor" TEXT,
  "source" "TraitsSource" NOT NULL DEFAULT 'AI',
  "photoId" TEXT,
  "editedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StoneTraits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StoneTraits_owner_check" CHECK (
    ("batchId" IS NOT NULL AND "batchPatternId" IS NULL)
    OR ("batchId" IS NULL AND "batchPatternId" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "StoneTraits_batchId_key" ON "StoneTraits"("batchId");
CREATE UNIQUE INDEX "StoneTraits_batchPatternId_key" ON "StoneTraits"("batchPatternId");
CREATE INDEX "StoneTraits_stoneTypeId_idx" ON "StoneTraits"("stoneTypeId");
ALTER TABLE "StoneTraits" ADD CONSTRAINT "StoneTraits_stoneTypeId_fkey"
  FOREIGN KEY ("stoneTypeId") REFERENCES "StoneType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoneTraits" ADD CONSTRAINT "StoneTraits_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoneTraits" ADD CONSTRAINT "StoneTraits_batchPatternId_fkey"
  FOREIGN KEY ("batchPatternId") REFERENCES "BatchPattern"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoneTraits" ADD CONSTRAINT "StoneTraits_editedById_fkey"
  FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AiSearchLog" (
  "id" TEXT NOT NULL,
  "channel" "AiSearchChannel" NOT NULL,
  "kind" "AiSearchKind" NOT NULL,
  "query" TEXT,
  "filters" JSONB NOT NULL,
  "aiOk" BOOLEAN NOT NULL,
  "resultCount" INTEGER NOT NULL,
  "inStockCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiSearchLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiSearchLog_createdAt_idx" ON "AiSearchLog"("createdAt");
