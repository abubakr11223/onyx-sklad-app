-- CreateTable
CREATE TABLE "ConsumedMagicLinkToken" (
    "jti" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsumedMagicLinkToken_pkey" PRIMARY KEY ("jti")
);

-- CreateIndex
CREATE INDEX "ConsumedMagicLinkToken_expiresAt_idx" ON "ConsumedMagicLinkToken"("expiresAt");
