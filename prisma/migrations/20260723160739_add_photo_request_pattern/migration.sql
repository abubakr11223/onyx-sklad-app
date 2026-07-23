-- AlterTable
ALTER TABLE "PhotoRequest" ADD COLUMN     "batchPatternId" TEXT;

-- CreateIndex
CREATE INDEX "PhotoRequest_batchPatternId_idx" ON "PhotoRequest"("batchPatternId");

-- AddForeignKey
ALTER TABLE "PhotoRequest" ADD CONSTRAINT "PhotoRequest_batchPatternId_fkey" FOREIGN KEY ("batchPatternId") REFERENCES "BatchPattern"("id") ON DELETE CASCADE ON UPDATE CASCADE;
