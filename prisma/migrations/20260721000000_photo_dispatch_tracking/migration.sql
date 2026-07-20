-- CreateEnum
CREATE TYPE "PhotoDispatchStatus" AS ENUM ('SENT', 'FAILED');

-- CreateTable
CREATE TABLE "PhotoDispatch" (
    "id" TEXT NOT NULL,
    "photoRequestId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "status" "PhotoDispatchStatus" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhotoDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhotoDispatch_status_idx" ON "PhotoDispatch"("status");

-- CreateIndex
CREATE INDEX "PhotoDispatch_photoRequestId_idx" ON "PhotoDispatch"("photoRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoDispatch_photoRequestId_chatId_key" ON "PhotoDispatch"("photoRequestId", "chatId");

-- AddForeignKey
ALTER TABLE "PhotoDispatch" ADD CONSTRAINT "PhotoDispatch_photoRequestId_fkey" FOREIGN KEY ("photoRequestId") REFERENCES "PhotoRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
