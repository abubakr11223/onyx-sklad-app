-- CreateTable
CREATE TABLE "TelegramAccessRequest" (
    "id" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "name" TEXT,
    "username" TEXT,
    "phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramAccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramAccessRequest_telegramId_key" ON "TelegramAccessRequest"("telegramId");

-- CreateIndex
CREATE INDEX "TelegramAccessRequest_status_createdAt_idx" ON "TelegramAccessRequest"("status", "createdAt");
