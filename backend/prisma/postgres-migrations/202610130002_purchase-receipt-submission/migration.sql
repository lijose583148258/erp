-- Existing receipts have unknown submission identities; preserve NULL and their original facts.
ALTER TABLE "purchase_receipts"
  ADD COLUMN IF NOT EXISTS "submission_key" TEXT,
  ADD COLUMN IF NOT EXISTS "submission_fingerprint" TEXT,
  ADD COLUMN IF NOT EXISTS "submission_json" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "purchase_receipts_purchase_order_id_submission_key_key"
  ON "purchase_receipts"("purchase_order_id", "submission_key");
