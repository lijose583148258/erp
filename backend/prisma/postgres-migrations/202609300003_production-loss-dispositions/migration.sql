CREATE TABLE IF NOT EXISTS "production_dispositions" (
  "id" SERIAL PRIMARY KEY,
  "disposition_no" TEXT NOT NULL UNIQUE,
  "idempotency_key" TEXT NOT NULL UNIQUE,
  "work_order_id" INTEGER NOT NULL REFERENCES "production_work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "batch_id" INTEGER NOT NULL REFERENCES "product_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "stock_balance_id" INTEGER NOT NULL REFERENCES "stock_balances"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "disposition_type" TEXT NOT NULL,
  "source_disposition_id" INTEGER,
  "quantity" DOUBLE PRECISION NOT NULL,
  "unit" TEXT NOT NULL DEFAULT 'kg',
  "cost_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reworked_quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reworked_cost_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reason" TEXT NOT NULL,
  "note" TEXT,
  "before_snapshot" TEXT,
  "after_snapshot" TEXT,
  "status" TEXT NOT NULL DEFAULT 'posted',
  "created_by" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "production_dispositions_type_check" CHECK ("disposition_type" IN ('scrap', 'rework_return')),
  CONSTRAINT "production_dispositions_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "production_dispositions_reworked_quantity_check" CHECK ("reworked_quantity" >= 0 AND "reworked_quantity" <= "quantity"),
  CONSTRAINT "production_dispositions_reworked_cost_check" CHECK ("reworked_cost_amount" >= 0 AND "reworked_cost_amount" <= "cost_amount")
);

DO $$ BEGIN
  ALTER TABLE "production_dispositions" ADD CONSTRAINT "production_dispositions_source_disposition_id_fkey"
    FOREIGN KEY ("source_disposition_id") REFERENCES "production_dispositions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "production_dispositions_work_order_id_idx" ON "production_dispositions"("work_order_id");
CREATE INDEX IF NOT EXISTS "production_dispositions_batch_id_idx" ON "production_dispositions"("batch_id");
CREATE INDEX IF NOT EXISTS "production_dispositions_stock_balance_id_idx" ON "production_dispositions"("stock_balance_id");
CREATE INDEX IF NOT EXISTS "production_dispositions_source_disposition_id_idx" ON "production_dispositions"("source_disposition_id");
CREATE INDEX IF NOT EXISTS "production_dispositions_disposition_type_status_idx" ON "production_dispositions"("disposition_type", "status");
