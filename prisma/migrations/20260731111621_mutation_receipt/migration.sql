-- W7-A2 — MutationReceipt: client mutationId → at-most-one domain write.
--
-- Slice 1 (offline design): intake double-submit (auto-online + manual tap,
-- flaky retry, React re-submit) must not create two Batch rows.
-- Pattern: ConsumedMagicLinkToken (UNIQUE @id + P2002 = replay) —
-- here P2002 means "already applied" → return existing entityId, not deny login.
--
-- Retention: no expiresAt, no prune cron. Intake volume is low; keeping receipts
-- forever prevents a very late replay after prune from creating a second batch.
--
-- IF NOT EXISTS / CREATE IF NOT EXISTS — idempotent deploy style
-- (see 20260730185115_poisk_search_indexes, 20260731102837_piece_bounding_area).
-- CONCURRENTLY YO'Q — multi-statement Prisma migrate runs in a transaction.

CREATE TABLE IF NOT EXISTS "MutationReceipt" (
    "mutationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "userId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "resultJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MutationReceipt_pkey" PRIMARY KEY ("mutationId")
);

CREATE INDEX IF NOT EXISTS "MutationReceipt_kind_createdAt_idx"
    ON "MutationReceipt"("kind", "createdAt");

CREATE INDEX IF NOT EXISTS "MutationReceipt_userId_createdAt_idx"
    ON "MutationReceipt"("userId", "createdAt");
