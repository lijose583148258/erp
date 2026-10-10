CREATE TABLE IF NOT EXISTS "material_density_revisions" ("id" SERIAL PRIMARY KEY,
  "material_id" INTEGER NOT NULL REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "batch_id" INTEGER NOT NULL REFERENCES "product_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "batch_no" TEXT NOT NULL, "base_unit" TEXT NOT NULL,
  "spec_code" TEXT NOT NULL, "version" TEXT NOT NULL,
  "density_kg_per_l" TEXT NOT NULL, "temperature_c" TEXT NOT NULL, "pressure_kpa_abs" TEXT NOT NULL,
  "composition_reference" TEXT NOT NULL, "method_reference" TEXT NOT NULL, "source_reference" TEXT NOT NULL,
  "measured_at" TIMESTAMP(3) NOT NULL, "status" TEXT NOT NULL DEFAULT 'draft',
  "created_by" INTEGER NOT NULL, "approved_by" INTEGER, "approved_at" TIMESTAMP(3), "review_reason" TEXT,
  "retired_by" INTEGER, "retired_at" TIMESTAMP(3), "retire_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX IF NOT EXISTS "material_density_revisions_identity_key" ON "material_density_revisions"("material_id", "batch_id", "spec_code", "version");
CREATE INDEX IF NOT EXISTS "material_density_revisions_material_id_status_idx" ON "material_density_revisions"("material_id", "status");
