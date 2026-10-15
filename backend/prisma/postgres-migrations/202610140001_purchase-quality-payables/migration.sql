-- Preserve historical receipt facts and unknown AP/QC provenance as NULL.
ALTER TABLE "purchase_receipts"
  ADD COLUMN IF NOT EXISTS "supplier_batch_no" TEXT,
  ADD COLUMN IF NOT EXISTS "batch_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "payable_amount_native" DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "payable_amount_base" DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "payable_snapshot_json" TEXT,
  ADD COLUMN IF NOT EXISTS "incoming_quality_plan_json" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='purchase_receipts'::regclass AND conname='purchase_receipts_batch_id_fkey') THEN
    ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_batch_id_fkey"
      FOREIGN KEY ("batch_id") REFERENCES "product_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_receipts_batch_id_key" ON "purchase_receipts"("batch_id");

CREATE TABLE IF NOT EXISTS "incoming_quality_checks" (
  "id" SERIAL PRIMARY KEY,
  "check_no" TEXT NOT NULL,
  "purchase_receipt_id" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "request_key" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "submission_json" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'submitted',
  "result" TEXT NOT NULL,
  "sample_no" TEXT,
  "measurements_json" TEXT NOT NULL,
  "note" TEXT,
  "inspector_user_id" INTEGER NOT NULL,
  "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_by_user_id" INTEGER,
  "reviewed_at" TIMESTAMP(3),
  "review_note" TEXT,
  "decision" TEXT,
  "review_json" TEXT,
  CONSTRAINT "incoming_quality_checks_purchase_receipt_id_fkey" FOREIGN KEY ("purchase_receipt_id") REFERENCES "purchase_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "incoming_quality_checks_inspector_user_id_fkey" FOREIGN KEY ("inspector_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "incoming_quality_checks_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "incoming_quality_checks_check_no_key" ON "incoming_quality_checks"("check_no");
CREATE UNIQUE INDEX IF NOT EXISTS "incoming_quality_checks_purchase_receipt_id_revision_key" ON "incoming_quality_checks"("purchase_receipt_id", "revision");
CREATE UNIQUE INDEX IF NOT EXISTS "incoming_quality_checks_purchase_receipt_id_request_key_key" ON "incoming_quality_checks"("purchase_receipt_id", "request_key");
CREATE INDEX IF NOT EXISTS "incoming_quality_checks_status_idx" ON "incoming_quality_checks"("status");

CREATE TABLE IF NOT EXISTS "supplier_payments" (
  "id" SERIAL PRIMARY KEY,
  "payment_no" TEXT NOT NULL,
  "purchase_receipt_id" INTEGER NOT NULL,
  "amount_native" DECIMAL(65,30) NOT NULL,
  "currency" TEXT NOT NULL,
  "base_amount" DECIMAL(65,30) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "request_key" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "submission_json" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "payment_account_ref" TEXT NOT NULL,
  "external_transaction_ref" TEXT NOT NULL,
  "evidence_ref" TEXT NOT NULL,
  "note" TEXT,
  "submitted_by_user_id" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verified_by_user_id" INTEGER,
  "verified_at" TIMESTAMP(3),
  "verification_json" TEXT,
  CONSTRAINT "supplier_payments_purchase_receipt_id_fkey" FOREIGN KEY ("purchase_receipt_id") REFERENCES "purchase_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplier_payments_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplier_payments_verified_by_user_id_fkey" FOREIGN KEY ("verified_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_payments_payment_no_key" ON "supplier_payments"("payment_no");
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_payments_purchase_receipt_id_request_key_key" ON "supplier_payments"("purchase_receipt_id", "request_key");
CREATE INDEX IF NOT EXISTS "supplier_payments_account_transaction_idx" ON "supplier_payments"("payment_account_ref", "external_transaction_ref");
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_payments_account_transaction_key" ON "supplier_payments"("payment_account_ref", "external_transaction_ref") WHERE "status" <> 'cancelled';
CREATE INDEX IF NOT EXISTS "supplier_payments_status_idx" ON "supplier_payments"("status");
