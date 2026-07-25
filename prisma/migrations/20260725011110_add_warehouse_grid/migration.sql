-- CreateTable
CREATE TABLE "WarehouseBlock" (
    "id" TEXT NOT NULL,
    "letter" TEXT NOT NULL,
    "areaM2" DECIMAL(12,3),
    "note" TEXT,
    "isFull" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseLandmark" (
    "id" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "number" TEXT NOT NULL,

    CONSTRAINT "WarehouseLandmark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseBlock_letter_key" ON "WarehouseBlock"("letter");

-- CreateIndex
CREATE INDEX "WarehouseBlock_sortOrder_idx" ON "WarehouseBlock"("sortOrder");

-- CreateIndex
CREATE INDEX "WarehouseLandmark_blockId_idx" ON "WarehouseLandmark"("blockId");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseLandmark_blockId_number_key" ON "WarehouseLandmark"("blockId", "number");

-- AddForeignKey
ALTER TABLE "WarehouseLandmark" ADD CONSTRAINT "WarehouseLandmark_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "WarehouseBlock"("id") ON DELETE CASCADE ON UPDATE CASCADE;
