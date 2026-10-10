CREATE TABLE IF NOT EXISTS "material_packaging_revisions" ("id" SERIAL PRIMARY KEY,
  "material_id" INTEGER NOT NULL REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "spec_code" TEXT NOT NULL, "version" TEXT NOT NULL,
  "package_unit" TEXT NOT NULL, "net_mass" TEXT NOT NULL, "mass_unit" TEXT NOT NULL,
  "source_reference" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'draft',
  "created_by" INTEGER NOT NULL, "approved_by" INTEGER, "approved_at" TIMESTAMP(3), "review_reason" TEXT,
  "retired_by" INTEGER, "retired_at" TIMESTAMP(3), "retire_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX IF NOT EXISTS "material_packaging_revisions_material_id_spec_code_version_key" ON "material_packaging_revisions"("material_id", "spec_code", "version");
CREATE INDEX IF NOT EXISTS "material_packaging_revisions_material_id_status_idx" ON "material_packaging_revisions"("material_id", "status");
ALTER TABLE "production_boms" ADD COLUMN IF NOT EXISTS "packaging_revision_id" INTEGER REFERENCES "material_packaging_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_boms" ADD COLUMN IF NOT EXISTS "packaging_snapshot_json" TEXT;
