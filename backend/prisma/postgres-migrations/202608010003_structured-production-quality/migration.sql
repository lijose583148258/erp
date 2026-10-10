ALTER TABLE "product_batches" ADD COLUMN IF NOT EXISTS "quality_status" TEXT NOT NULL DEFAULT 'not_required';
CREATE INDEX IF NOT EXISTS "product_batches_quality_status_idx" ON "product_batches"("quality_status");

CREATE TABLE IF NOT EXISTS "production_quality_characteristics" (
  "id" SERIAL PRIMARY KEY,
  "bom_id" INTEGER NOT NULL REFERENCES "production_boms"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "value_type" TEXT NOT NULL DEFAULT 'numeric',
  "unit" TEXT,
  "lower_limit" NUMERIC(24,8),
  "upper_limit" NUMERIC(24,8),
  "target_text" TEXT,
  "test_method" TEXT,
  "required" BOOLEAN NOT NULL DEFAULT TRUE,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "production_quality_characteristics_bom_id_code_key" ON "production_quality_characteristics"("bom_id", "code");
CREATE INDEX IF NOT EXISTS "production_quality_characteristics_bom_id_sort_order_idx" ON "production_quality_characteristics"("bom_id", "sort_order");

ALTER TABLE "production_quality_checks" ADD COLUMN IF NOT EXISTS "revision" INTEGER;
ALTER TABLE "production_quality_checks" ADD COLUMN IF NOT EXISTS "status" TEXT;
ALTER TABLE "production_quality_checks" ADD COLUMN IF NOT EXISTS "disposition" TEXT;
ALTER TABLE "production_quality_checks" ADD COLUMN IF NOT EXISTS "sample_no" TEXT;
ALTER TABLE "production_quality_checks" ADD COLUMN IF NOT EXISTS "inspector_user_id" INTEGER;
ALTER TABLE "production_quality_checks" ADD COLUMN IF NOT EXISTS "reviewed_by_user_id" INTEGER;
ALTER TABLE "production_quality_checks" ADD COLUMN IF NOT EXISTS "reviewed_by" TEXT;
ALTER TABLE "production_quality_checks" ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMP(3);
ALTER TABLE "production_quality_checks" ADD COLUMN IF NOT EXISTS "review_note" TEXT;

WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "work_order_id" ORDER BY "created_at", "id") AS revision_no
  FROM "production_quality_checks"
)
UPDATE "production_quality_checks" AS qc
SET "revision" = ranked.revision_no
FROM ranked
WHERE qc."id" = ranked."id" AND qc."revision" IS NULL;
ALTER TABLE "production_quality_checks" ALTER COLUMN "revision" SET NOT NULL;
ALTER TABLE "production_quality_checks" ALTER COLUMN "revision" SET DEFAULT 1;
UPDATE "production_quality_checks" SET "status" = 'legacy_recorded' WHERE "status" IS NULL;
UPDATE "production_quality_checks" SET "disposition" = 'legacy' WHERE "disposition" IS NULL;
ALTER TABLE "production_quality_checks" ALTER COLUMN "status" SET DEFAULT 'submitted';
ALTER TABLE "production_quality_checks" ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "production_quality_checks" ALTER COLUMN "disposition" SET DEFAULT 'pending';
ALTER TABLE "production_quality_checks" ALTER COLUMN "disposition" SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE "production_quality_checks" ADD CONSTRAINT "production_quality_checks_inspector_user_id_fkey" FOREIGN KEY ("inspector_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "production_quality_checks" ADD CONSTRAINT "production_quality_checks_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "production_quality_checks_work_order_id_revision_key" ON "production_quality_checks"("work_order_id", "revision");
CREATE INDEX IF NOT EXISTS "production_quality_checks_status_idx" ON "production_quality_checks"("status");

CREATE TABLE IF NOT EXISTS "production_quality_measurements" (
  "id" SERIAL PRIMARY KEY,
  "quality_check_id" INTEGER NOT NULL REFERENCES "production_quality_checks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "characteristic_id" INTEGER REFERENCES "production_quality_characteristics"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "characteristic_code" TEXT NOT NULL,
  "characteristic_name" TEXT NOT NULL,
  "value_type" TEXT NOT NULL,
  "unit" TEXT,
  "lower_limit" NUMERIC(24,8),
  "upper_limit" NUMERIC(24,8),
  "target_text" TEXT,
  "measured_numeric" NUMERIC(24,8),
  "measured_text" TEXT,
  "result" TEXT NOT NULL,
  "test_method" TEXT,
  "instrument_no" TEXT,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "production_quality_measurements_quality_check_id_characteristic_code_key" ON "production_quality_measurements"("quality_check_id", "characteristic_code");
CREATE INDEX IF NOT EXISTS "production_quality_measurements_quality_check_id_idx" ON "production_quality_measurements"("quality_check_id");
CREATE INDEX IF NOT EXISTS "production_quality_measurements_characteristic_id_idx" ON "production_quality_measurements"("characteristic_id");
