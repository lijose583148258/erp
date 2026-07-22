CREATE TABLE IF NOT EXISTS "order_import_batches" (
  "id" SERIAL PRIMARY KEY,
  "user_id" INTEGER NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'processing',
  "lease_token" TEXT NOT NULL,
  "lease_expires_at" TIMESTAMP(3) NOT NULL,
  "result_json" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_import_batches_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "order_import_batches_user_id_idempotency_key_key"
  ON "order_import_batches"("user_id", "idempotency_key");

CREATE INDEX IF NOT EXISTS "order_import_batches_status_lease_expires_at_idx"
  ON "order_import_batches"("status", "lease_expires_at");

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "import_batch_id" INTEGER;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "import_row_number" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "orders_import_batch_id_import_row_number_key"
  ON "orders"("import_batch_id", "import_row_number");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_import_batch_id_fkey'
      AND conrelid = 'orders'::regclass
  ) THEN
    ALTER TABLE "orders"
      ADD CONSTRAINT "orders_import_batch_id_fkey"
      FOREIGN KEY ("import_batch_id") REFERENCES "order_import_batches"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
