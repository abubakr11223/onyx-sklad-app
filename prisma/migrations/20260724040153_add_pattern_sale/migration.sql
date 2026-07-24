-- AlterTable
ALTER TABLE "BatchPattern" ADD COLUMN     "areaSoldM2" DECIMAL(12,3) NOT NULL DEFAULT 0,
ADD COLUMN     "slabsSold" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SaleRecord" ADD COLUMN     "batchPatternId" TEXT;

-- CreateIndex
CREATE INDEX "SaleRecord_batchPatternId_idx" ON "SaleRecord"("batchPatternId");

-- AddForeignKey
ALTER TABLE "SaleRecord" ADD CONSTRAINT "SaleRecord_batchPatternId_fkey" FOREIGN KEY ("batchPatternId") REFERENCES "BatchPattern"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
