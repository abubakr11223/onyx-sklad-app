-- TZ №9 — PaymentMethod / Currency / DebtStatus enums + SaleRecord payment cols
-- + Debt model (one credit sale = one debt).
--
-- Style: IF NOT EXISTS / CREATE IF NOT EXISTS — idempotent deploy
-- (see 20260731111621_mutation_receipt). CONCURRENTLY YO'Q — multi-statement
-- Prisma migrate runs in a transaction.
--
-- SaleRecord.paymentMethod / currency / price stay NULLABLE at DB level:
-- production holds pre-TZ9 rows without them. New sales enforce via validators.

-- ── Enums (idempotent via DO block if re-applied) ──
DO $$ BEGIN
  CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'CREDIT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "Currency" AS ENUM ('UZS', 'USD');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "DebtStatus" AS ENUM ('ACTIVE', 'REPAID', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── SaleRecord payment columns ──
ALTER TABLE "SaleRecord" ADD COLUMN IF NOT EXISTS "paymentMethod" "PaymentMethod";
ALTER TABLE "SaleRecord" ADD COLUMN IF NOT EXISTS "currency" "Currency";

-- Widen SaleRecord.price Decimal(12,2) → (14,2): total sale amount in UZS can
-- exceed ~10B so'm on large B2B batches (see TZ9 result-1 arithmetic). Debt
-- copies this field — both MUST share precision. Safe before first prod debt
-- rows; existing prices fit in the wider type without cast issues.
ALTER TABLE "SaleRecord"
  ALTER COLUMN "price" TYPE DECIMAL(14,2);

CREATE INDEX IF NOT EXISTS "SaleRecord_paymentMethod_soldAt_idx"
  ON "SaleRecord"("paymentMethod", "soldAt");

-- ── Debt ──
-- amount / repaidAmount DECIMAL(14,2) — same as SaleRecord.price (copy of total).
CREATE TABLE IF NOT EXISTS "Debt" (
    "id" TEXT NOT NULL,
    "saleRecordId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "status" "DebtStatus" NOT NULL DEFAULT 'ACTIVE',
    "dueDate" TIMESTAMP(3),
    "comment" TEXT,
    "repaidAt" TIMESTAMP(3),
    "repaidAmount" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Debt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Debt_saleRecordId_key"
  ON "Debt"("saleRecordId");

CREATE INDEX IF NOT EXISTS "Debt_status_dueDate_idx"
  ON "Debt"("status", "dueDate");

CREATE INDEX IF NOT EXISTS "Debt_status_createdAt_idx"
  ON "Debt"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "Debt_currency_status_idx"
  ON "Debt"("currency", "status");

-- Restrict: sale hard-delete blocked while debt exists (accounting trail).
DO $$ BEGIN
  ALTER TABLE "Debt"
    ADD CONSTRAINT "Debt_saleRecordId_fkey"
    FOREIGN KEY ("saleRecordId") REFERENCES "SaleRecord"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
