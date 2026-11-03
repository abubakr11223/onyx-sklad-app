-- ТЗ №20, волна 1: платежи (A), плановая отгрузка (B), мин. остаток (C),
-- напоминания о долгах (D), постоянные коды ONX (G).

-- ─────────────── enums ───────────────
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'TRANSFER';
CREATE TYPE "PaymentKind" AS ENUM ('PAYMENT', 'REFUND');
CREATE TYPE "ShipmentDeliveryMode" AS ENUM ('PICKUP', 'DELIVERY');
CREATE TYPE "StockUnit" AS ENUM ('SLABS', 'AREA_M2');

-- ─────────────── G: коды ONX-XXXXX ───────────────
-- Уникальность по ВСЕМ пяти таблицам: функция проверяет каждую. Алфавит без
-- похожих символов (0/O, 1/I). 32^5 ≈ 33,5 млн кодов — повтор маловероятен,
-- но цикл всё равно перебирает до свободного.
ALTER TABLE "StoneType" ADD COLUMN "code" TEXT;
ALTER TABLE "Batch" ADD COLUMN "code" TEXT;
ALTER TABLE "BatchPattern" ADD COLUMN "code" TEXT;
ALTER TABLE "Slab" ADD COLUMN "code" TEXT;
ALTER TABLE "Piece" ADD COLUMN "code" TEXT;

CREATE OR REPLACE FUNCTION onx_new_code() RETURNS TEXT
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  alphabet CONSTANT TEXT := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  c TEXT;
  i INT;
BEGIN
  LOOP
    c := 'ONX-';
    FOR i IN 1..5 LOOP
      c := c || substr(alphabet, 1 + floor(random() * 32)::INT, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM "StoneType" WHERE "code" = c)
      AND NOT EXISTS (SELECT 1 FROM "Batch" WHERE "code" = c)
      AND NOT EXISTS (SELECT 1 FROM "BatchPattern" WHERE "code" = c)
      AND NOT EXISTS (SELECT 1 FROM "Slab" WHERE "code" = c)
      AND NOT EXISTS (SELECT 1 FROM "Piece" WHERE "code" = c);
  END LOOP;
  RETURN c;
END $$;

-- Построчно: каждая строка видит уже выданные коды (один UPDATE их бы не видел).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM "StoneType" WHERE "code" IS NULL ORDER BY "createdAt" LOOP
    UPDATE "StoneType" SET "code" = onx_new_code() WHERE id = r.id;
  END LOOP;
  FOR r IN SELECT id FROM "Batch" WHERE "code" IS NULL ORDER BY "createdAt" LOOP
    UPDATE "Batch" SET "code" = onx_new_code() WHERE id = r.id;
  END LOOP;
  FOR r IN SELECT id FROM "BatchPattern" WHERE "code" IS NULL ORDER BY "createdAt" LOOP
    UPDATE "BatchPattern" SET "code" = onx_new_code() WHERE id = r.id;
  END LOOP;
  FOR r IN SELECT id FROM "Slab" WHERE "code" IS NULL ORDER BY "createdAt" LOOP
    UPDATE "Slab" SET "code" = onx_new_code() WHERE id = r.id;
  END LOOP;
  FOR r IN SELECT id FROM "Piece" WHERE "code" IS NULL ORDER BY "createdAt" LOOP
    UPDATE "Piece" SET "code" = onx_new_code() WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE "StoneType" ALTER COLUMN "code" SET DEFAULT onx_new_code(), ALTER COLUMN "code" SET NOT NULL;
ALTER TABLE "Batch" ALTER COLUMN "code" SET DEFAULT onx_new_code(), ALTER COLUMN "code" SET NOT NULL;
ALTER TABLE "BatchPattern" ALTER COLUMN "code" SET DEFAULT onx_new_code(), ALTER COLUMN "code" SET NOT NULL;
ALTER TABLE "Slab" ALTER COLUMN "code" SET DEFAULT onx_new_code(), ALTER COLUMN "code" SET NOT NULL;
ALTER TABLE "Piece" ALTER COLUMN "code" SET DEFAULT onx_new_code(), ALTER COLUMN "code" SET NOT NULL;

CREATE UNIQUE INDEX "StoneType_code_key" ON "StoneType"("code");
CREATE UNIQUE INDEX "Batch_code_key" ON "Batch"("code");
CREATE UNIQUE INDEX "BatchPattern_code_key" ON "BatchPattern"("code");
CREATE UNIQUE INDEX "Slab_code_key" ON "Slab"("code");
CREATE UNIQUE INDEX "Piece_code_key" ON "Piece"("code");

-- ─────────────── C: минимальный остаток ───────────────
ALTER TABLE "StoneType" ADD COLUMN "minStockQty" DECIMAL(12,3);
ALTER TABLE "StoneType" ADD COLUMN "minStockUnit" "StockUnit";
ALTER TABLE "StoneType" ADD COLUMN "lowStockAlertedAt" TIMESTAMP(3);

-- ─────────────── D: напоминания о долгах ───────────────
ALTER TABLE "Debt" ADD COLUMN "remindedDueAt" TIMESTAMP(3);
ALTER TABLE "Debt" ADD COLUMN "overdueRemindDay" INTEGER NOT NULL DEFAULT 0;

-- ─────────────── B: плановая отгрузка ───────────────
ALTER TABLE "Shipment" ADD COLUMN "plannedAt" TIMESTAMP(3);
ALTER TABLE "Shipment" ADD COLUMN "plannedHasTime" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Shipment" ADD COLUMN "deliveryMode" "ShipmentDeliveryMode";
CREATE INDEX "Shipment_plannedAt_idx" ON "Shipment"("plannedAt");

-- ─────────────── A: платежи ───────────────
CREATE TABLE "Payment" (
  "id" TEXT NOT NULL,
  "saleRecordId" TEXT NOT NULL,
  "debtId" TEXT,
  "kind" "PaymentKind" NOT NULL DEFAULT 'PAYMENT',
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" "Currency" NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "paidAt" TIMESTAMP(3) NOT NULL,
  "receivedById" TEXT NOT NULL,
  "comment" TEXT,
  "clientPaymentGroup" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Payment_saleRecordId_idx" ON "Payment"("saleRecordId");
CREATE INDEX "Payment_debtId_idx" ON "Payment"("debtId");
CREATE INDEX "Payment_paidAt_currency_idx" ON "Payment"("paidAt", "currency");
CREATE INDEX "Payment_receivedById_paidAt_idx" ON "Payment"("receivedById", "paidAt");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_saleRecordId_fkey"
  FOREIGN KEY ("saleRecordId") REFERENCES "SaleRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_debtId_fkey"
  FOREIGN KEY ("debtId") REFERENCES "Debt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_receivedById_fkey"
  FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- §2.5 перенос старых продаж. Суммы в «Сводке» и «Должниках» не меняются:
--  • Наличные / Карта → один платёж на всю цену датой продажи;
--  • «В долг» → платежей нет, долг = цена;
--  • погашенный долг → один платёж датой погашения (способ не записывался —
--    ставим «наличные» с пометкой в комментарии);
--  • возвращённая продажа → возврат денег клиенту на всё оплаченное.
INSERT INTO "Payment" ("id", "saleRecordId", "kind", "amount", "currency", "method", "paidAt", "receivedById", "comment")
SELECT 'mig_p_' || s."id", s."id", 'PAYMENT', s."price", s."currency", s."paymentMethod", s."soldAt", s."managerId",
       'перенос ТЗ №20: оплата при продаже'
FROM "SaleRecord" s
WHERE s."paymentMethod" IN ('CASH', 'CARD') AND s."price" IS NOT NULL AND s."currency" IS NOT NULL;

INSERT INTO "Payment" ("id", "saleRecordId", "debtId", "kind", "amount", "currency", "method", "paidAt", "receivedById", "comment")
SELECT 'mig_d_' || d."id", d."saleRecordId", d."id", 'PAYMENT', COALESCE(d."repaidAmount", d."amount"), d."currency", 'CASH',
       COALESCE(d."repaidAt", d."updatedAt"), s."managerId",
       'перенос ТЗ №20: погашение долга (способ не записывался)'
FROM "Debt" d JOIN "SaleRecord" s ON s."id" = d."saleRecordId"
WHERE d."status" = 'REPAID';

INSERT INTO "Payment" ("id", "saleRecordId", "kind", "amount", "currency", "method", "paidAt", "receivedById", "comment")
SELECT 'mig_r_' || s."id", s."id", 'REFUND', paid.total, paid.currency, 'CASH', s."returnedAt", s."managerId",
       'перенос ТЗ №20: возврат продажи'
FROM "SaleRecord" s
JOIN (
  SELECT "saleRecordId", "currency", SUM("amount") AS total
  FROM "Payment" WHERE "kind" = 'PAYMENT'
  GROUP BY "saleRecordId", "currency"
) paid ON paid."saleRecordId" = s."id"
WHERE s."returnedAt" IS NOT NULL;

-- Погашенный долг: repaidAmount = сумма его платежей.
UPDATE "Debt" d SET "repaidAmount" = COALESCE(d."repaidAmount", d."amount")
WHERE d."status" = 'REPAID';
