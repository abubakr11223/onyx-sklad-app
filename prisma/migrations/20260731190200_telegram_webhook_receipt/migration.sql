-- W9-D / TG-C-next — TelegramWebhookReceipt: update_id at-most-once claim.
--
-- Pattern: ConsumedMagicLinkToken (UNIQUE @id + P2002 = replay) /
-- MutationReceipt (same shape). Webhook path stores update_id as TEXT PK;
-- second delivery of the same update_id is a no-op (no duplicate Photo/slab).
--
-- Retention: expiresAt (default claim sets now+7d). Lazy prune in
-- src/lib/telegram-update-receipt.ts — unbounded growth avoided.
-- Telegram only retries for a short window; 7d >> that window.
--
-- IF NOT EXISTS — idempotent deploy style (see 20260731111621_mutation_receipt).
-- CONCURRENTLY YO'Q — multi-statement Prisma migrate runs in a transaction.
-- NEVER run migrate dev / reset / db push against production from this task.

CREATE TABLE IF NOT EXISTS "TelegramWebhookReceipt" (
    "updateId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramWebhookReceipt_pkey" PRIMARY KEY ("updateId")
);

CREATE INDEX IF NOT EXISTS "TelegramWebhookReceipt_expiresAt_idx"
    ON "TelegramWebhookReceipt"("expiresAt");
