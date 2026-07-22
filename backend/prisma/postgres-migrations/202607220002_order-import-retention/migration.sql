ALTER TABLE "order_import_batches" ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMP(3);

UPDATE "order_import_batches"
SET "completed_at" = "updated_at"
WHERE "status" = 'completed' AND "completed_at" IS NULL;

CREATE INDEX IF NOT EXISTS "order_import_batches_status_completed_at_idx"
  ON "order_import_batches"("status", "completed_at");

CREATE INDEX IF NOT EXISTS "order_import_batches_status_created_at_idx"
  ON "order_import_batches"("status", "created_at");
