import { createTableIfMissing, createIndexIfMissing, addColumnIfMissing, type SchemaRepairReport } from './runtime-schema-repair-utils';
export async function repairPackagingSchema(report: SchemaRepairReport) {
  await createTableIfMissing(report, 'material_packaging_revisions', `CREATE TABLE "material_packaging_revisions" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "material_id" INTEGER NOT NULL REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "spec_code" TEXT NOT NULL, "version" TEXT NOT NULL,
  "package_unit" TEXT NOT NULL, "net_mass" TEXT NOT NULL, "mass_unit" TEXT NOT NULL,
  "source_reference" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'draft',
  "created_by" INTEGER NOT NULL, "approved_by" INTEGER, "approved_at" DATETIME, "review_reason" TEXT,
  "retired_by" INTEGER, "retired_at" DATETIME, "retire_reason" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await createIndexIfMissing(report, 'material_packaging_revisions_material_id_spec_code_version_key', 'CREATE UNIQUE INDEX "material_packaging_revisions_material_id_spec_code_version_key" ON "material_packaging_revisions"("material_id", "spec_code", "version")');
  await createIndexIfMissing(report, 'material_packaging_revisions_material_id_status_idx', 'CREATE INDEX "material_packaging_revisions_material_id_status_idx" ON "material_packaging_revisions"("material_id", "status")');
  await addColumnIfMissing(report, 'production_boms', 'packaging_revision_id', 'INTEGER REFERENCES "material_packaging_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE');
  await addColumnIfMissing(report, 'production_boms', 'packaging_snapshot_json', 'TEXT');
}
