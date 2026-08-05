-- TZ №10+11 Этап 1 — справочники Client + Site + nullable FKs on SaleRecord/Debt.
--
-- Style: IF NOT EXISTS / CREATE IF NOT EXISTS — idempotent deploy
-- (same pattern as 20260803120000_tz9_debt). CONCURRENTLY YO'Q — multi-statement
-- Prisma migrate runs in a transaction.
--
-- SaleRecord.clientId / siteId and Debt.clientId stay NULLABLE at DB level:
-- production holds pre-directory rows with only text customerName.
-- No forced backfill. New sales will enforce clientId via validators (этап 2).

-- ── Enums (idempotent via DO block) ──
DO $$ BEGIN
  CREATE TYPE "ClientType" AS ENUM ('B2C', 'B2B');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SiteType" AS ENUM ('RESIDENTIAL', 'COMMERCIAL', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SiteStatus" AS ENUM ('ACTIVE', 'COMPLETED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── Client ──
CREATE TABLE IF NOT EXISTS "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ClientType" NOT NULL,
    "phone" TEXT NOT NULL,
    "extraContacts" TEXT,
    "comment" TEXT,
    "managerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Client_managerId_createdAt_idx"
  ON "Client"("managerId", "createdAt");

CREATE INDEX IF NOT EXISTS "Client_phone_idx"
  ON "Client"("phone");

CREATE INDEX IF NOT EXISTS "Client_type_name_idx"
  ON "Client"("type", "name");

CREATE INDEX IF NOT EXISTS "Client_name_idx"
  ON "Client"("name");

DO $$ BEGIN
  ALTER TABLE "Client"
    ADD CONSTRAINT "Client_managerId_fkey"
    FOREIGN KEY ("managerId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── Site ──
CREATE TABLE IF NOT EXISTS "Site" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SiteType" NOT NULL,
    "address" TEXT,
    "clientId" TEXT NOT NULL,
    "status" "SiteStatus" NOT NULL DEFAULT 'ACTIVE',
    "comment" TEXT,
    "contactPerson" TEXT,
    "managerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Site_clientId_status_idx"
  ON "Site"("clientId", "status");

CREATE INDEX IF NOT EXISTS "Site_managerId_createdAt_idx"
  ON "Site"("managerId", "createdAt");

CREATE INDEX IF NOT EXISTS "Site_status_name_idx"
  ON "Site"("status", "name");

CREATE INDEX IF NOT EXISTS "Site_name_idx"
  ON "Site"("name");

DO $$ BEGIN
  ALTER TABLE "Site"
    ADD CONSTRAINT "Site_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Site"
    ADD CONSTRAINT "Site_managerId_fkey"
    FOREIGN KEY ("managerId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── SaleRecord nullable FKs (legacy text customer stays intact) ──
ALTER TABLE "SaleRecord" ADD COLUMN IF NOT EXISTS "clientId" TEXT;
ALTER TABLE "SaleRecord" ADD COLUMN IF NOT EXISTS "siteId" TEXT;

CREATE INDEX IF NOT EXISTS "SaleRecord_clientId_soldAt_idx"
  ON "SaleRecord"("clientId", "soldAt");

CREATE INDEX IF NOT EXISTS "SaleRecord_siteId_soldAt_idx"
  ON "SaleRecord"("siteId", "soldAt");

DO $$ BEGIN
  ALTER TABLE "SaleRecord"
    ADD CONSTRAINT "SaleRecord_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SaleRecord"
    ADD CONSTRAINT "SaleRecord_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── Debt.clientId (nullable denormalized link for client card) ──
ALTER TABLE "Debt" ADD COLUMN IF NOT EXISTS "clientId" TEXT;

CREATE INDEX IF NOT EXISTS "Debt_clientId_status_idx"
  ON "Debt"("clientId", "status");

DO $$ BEGIN
  ALTER TABLE "Debt"
    ADD CONSTRAINT "Debt_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
