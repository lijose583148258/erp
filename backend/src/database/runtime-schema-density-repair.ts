import { createTableIfMissing, createIndexIfMissing, type SchemaRepairReport } from './runtime-schema-repair-utils';
export async function repairDensitySchema(report: SchemaRepairReport) {
  await createTableIfMissing(report, 'material_density_revisions', `CREATE TABLE "material_density_revisions" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "material_id" INTEGER NOT NULL REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "batch_id" INTEGER NOT NULL REFERENCES "product_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "batch_no" TEXT NOT NULL, "base_unit" TEXT NOT NULL,
  "spec_code" TEXT NOT NULL, "version" TEXT NOT NULL,
  "density_kg_per_l" TEXT NOT NULL, "temperature_c" TEXT NOT NULL, "pressure_kpa_abs" TEXT NOT NULL,
  "composition_reference" TEXT NOT NULL, "method_reference" TEXT NOT NULL, "source_reference" TEXT NOT NULL,
  "measured_at" DATETIME NOT NULL, "status" TEXT NOT NULL DEFAULT 'draft',
  "created_by" INTEGER NOT NULL, "approved_by" INTEGER, "approved_at" DATETIME, "review_reason" TEXT,
  "retired_by" INTEGER, "retired_at" DATETIME, "retire_reason" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await createIndexIfMissing(report, 'material_density_revisions_identity_key', 'CREATE UNIQUE INDEX "material_density_revisions_identity_key" ON "material_density_revisions"("material_id", "batch_id", "spec_code", "version")');
  await createIndexIfMissing(report, 'material_density_revisions_material_id_status_idx', 'CREATE INDEX "material_density_revisions_material_id_status_idx" ON "material_density_revisions"("material_id", "status")');
}
