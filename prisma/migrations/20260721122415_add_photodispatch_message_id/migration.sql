-- AlterTable
ALTER TABLE "PhotoDispatch" ADD COLUMN     "messageId" INTEGER;

-- CreateIndex
CREATE INDEX "PhotoDispatch_chatId_messageId_idx" ON "PhotoDispatch"("chatId", "messageId");
