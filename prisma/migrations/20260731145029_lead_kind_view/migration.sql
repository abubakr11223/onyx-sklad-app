-- W8-A — Lead.kind: REQUEST (explicit) vs VIEW (passive interest, TZ §6.8.5).
-- «В ЛЮБОМ случае заявка уходит менеджеру — даже если дизайнер просто
-- посмотрел и ничего не заказал.» Existing rows default to REQUEST.
--
-- IF NOT EXISTS / style of 20260731111621_mutation_receipt.
-- No CONCURRENTLY (Prisma multi-statement transaction).
-- NEVER applied from this agent session (DATABASE_URL = live prod).

-- Create enum if missing (idempotent-ish: DO block).
DO $$ BEGIN
    CREATE TYPE "LeadKind" AS ENUM ('REQUEST', 'VIEW');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "Lead"
    ADD COLUMN IF NOT EXISTS "kind" "LeadKind" NOT NULL DEFAULT 'REQUEST';

CREATE INDEX IF NOT EXISTS "Lead_createdById_stoneTypeId_kind_status_idx"
    ON "Lead"("createdById", "stoneTypeId", "kind", "status");
