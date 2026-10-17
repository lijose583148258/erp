-- Extend the existing receivable credit, not a second quantity/money ledger.
ALTER TABLE "receivable_adjustments"
  ADD COLUMN IF NOT EXISTS "order_item_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "cancelled_quantity" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "request_key" TEXT,
  ADD COLUMN IF NOT EXISTS "request_fingerprint" TEXT;

DO $$ BEGIN
  ALTER TABLE "receivable_adjustments" ADD CONSTRAINT "receivable_adjustments_order_item_id_fkey"
    FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "receivable_adjustments" ADD CONSTRAINT "receivable_adjustments_quantity_cancellation_check"
    CHECK (
      ("adjustment_type" = 'order_quantity_cancellation' AND "order_item_id" IS NOT NULL
       AND "cancelled_quantity" > 0 AND "cancelled_quantity" < 'Infinity'::float8
       AND "cancelled_quantity" IS NOT NULL AND "request_key" IS NOT NULL AND "request_fingerprint" IS NOT NULL)
      OR ("adjustment_type" <> 'order_quantity_cancellation' AND "order_item_id" IS NULL
       AND "cancelled_quantity" IS NULL AND "request_key" IS NULL AND "request_fingerprint" IS NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "receivable_adjustments_request_key_key" ON "receivable_adjustments"("request_key");
CREATE INDEX IF NOT EXISTS "receivable_adjustments_order_item_id_idx" ON "receivable_adjustments"("order_item_id");
