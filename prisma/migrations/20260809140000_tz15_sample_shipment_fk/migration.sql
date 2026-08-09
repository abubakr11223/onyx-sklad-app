-- TZ №15 Slice 2 — Shipment.sampleId → Sample FK (column+unique already in tz15_shipment).
-- Confirm does not create Sample; issueSample remains single writer. Hand-written, idempotent.

DO $$ BEGIN
  ALTER TABLE "Shipment"
    ADD CONSTRAINT "Shipment_sampleId_fkey"
    FOREIGN KEY ("sampleId") REFERENCES "Sample"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
