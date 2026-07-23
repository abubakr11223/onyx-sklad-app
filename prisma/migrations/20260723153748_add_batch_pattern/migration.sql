-- AlterTable
ALTER TABLE "Photo" ADD COLUMN     "batchPatternId" TEXT;

-- CreateTable
CREATE TABLE "BatchPattern" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "thicknessMm" INTEGER,
    "slabsCount" INTEGER NOT NULL,
    "areaM2" DECIMAL(12,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BatchPattern_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BatchPattern_batchId_idx" ON "BatchPattern"("batchId");

-- CreateIndex
CREATE INDEX "Photo_batchPatternId_idx" ON "Photo"("batchPatternId");

-- AddForeignKey
ALTER TABLE "BatchPattern" ADD CONSTRAINT "BatchPattern_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_batchPatternId_fkey" FOREIGN KEY ("batchPatternId") REFERENCES "BatchPattern"("id") ON DELETE CASCADE ON UPDATE CASCADE;
