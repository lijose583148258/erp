import {
  addColumnIfMissing,
  createIndexIfMissing,
  createTableIfMissing,
  type SchemaRepairReport,
} from './runtime-schema-repair-utils';

export const repairMaterialSchema = async (report: SchemaRepairReport) => {
  await createTableIfMissing(report, 'materials', `
    CREATE TABLE "materials" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "code" TEXT NOT NULL,
      "name_zh" TEXT NOT NULL,
      "name_en" TEXT,
      "name_vi" TEXT,
      "category" TEXT NOT NULL DEFAULT 'raw_material',
      "base_unit" TEXT NOT NULL,
      "specification" TEXT,
      "status" TEXT NOT NULL DEFAULT 'draft',
      "is_temporary" INTEGER NOT NULL DEFAULT 1,
      "cas_number" TEXT,
      "un_number" TEXT,
      "hs_code" TEXT,
      "shelf_life_days" INTEGER,
      "compliance_notes" TEXT,
      "created_by" INTEGER NOT NULL,
      "updated_by" INTEGER NOT NULL,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await createTableIfMissing(report, 'material_aliases', `
    CREATE TABLE "material_aliases" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "material_id" INTEGER NOT NULL,
      "alias" TEXT NOT NULL,
      "normalized_alias" TEXT NOT NULL,
      "language" TEXT NOT NULL DEFAULT 'und',
      "alias_type" TEXT NOT NULL DEFAULT 'business',
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "material_aliases_material_id_fkey"
        FOREIGN KEY ("material_id") REFERENCES "materials" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  await createTableIfMissing(report, 'material_governance_runs', `
    CREATE TABLE "material_governance_runs" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "run_no" TEXT NOT NULL,
      "run_type" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'applied',
      "input_digest" TEXT NOT NULL,
      "summary_json" TEXT,
      "created_by" INTEGER NOT NULL,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "applied_at" DATETIME,
      "rolled_back_at" DATETIME
    )
  `);

  await createTableIfMissing(report, 'material_governance_changes', `
    CREATE TABLE "material_governance_changes" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "run_id" INTEGER NOT NULL,
      "entity_type" TEXT NOT NULL,
      "entity_id" INTEGER NOT NULL,
      "field_name" TEXT NOT NULL,
      "before_value" TEXT,
      "after_value" TEXT,
      "before_snapshot_json" TEXT,
      "after_snapshot_json" TEXT,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "material_governance_changes_run_id_fkey"
        FOREIGN KEY ("run_id") REFERENCES "material_governance_runs" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  await createIndexIfMissing(report, 'materials_code_key', 'CREATE UNIQUE INDEX "materials_code_key" ON "materials"("code")');
  await createIndexIfMissing(report, 'materials_name_zh_idx', 'CREATE INDEX "materials_name_zh_idx" ON "materials"("name_zh")');
  await createIndexIfMissing(report, 'materials_name_en_idx', 'CREATE INDEX "materials_name_en_idx" ON "materials"("name_en")');
  await createIndexIfMissing(report, 'materials_name_vi_idx', 'CREATE INDEX "materials_name_vi_idx" ON "materials"("name_vi")');
  await createIndexIfMissing(report, 'materials_category_status_idx', 'CREATE INDEX "materials_category_status_idx" ON "materials"("category", "status")');
  await createIndexIfMissing(report, 'materials_cas_number_idx', 'CREATE INDEX "materials_cas_number_idx" ON "materials"("cas_number")');
  await createIndexIfMissing(report, 'materials_hs_code_idx', 'CREATE INDEX "materials_hs_code_idx" ON "materials"("hs_code")');
  await createIndexIfMissing(report, 'material_aliases_material_id_normalized_alias_language_key', 'CREATE UNIQUE INDEX "material_aliases_material_id_normalized_alias_language_key" ON "material_aliases"("material_id", "normalized_alias", "language")');
  await createIndexIfMissing(report, 'material_aliases_normalized_alias_language_idx', 'CREATE INDEX "material_aliases_normalized_alias_language_idx" ON "material_aliases"("normalized_alias", "language")');
  await createIndexIfMissing(report, 'material_aliases_material_id_idx', 'CREATE INDEX "material_aliases_material_id_idx" ON "material_aliases"("material_id")');
  await createIndexIfMissing(report, 'material_aliases_alias_idx', 'CREATE INDEX "material_aliases_alias_idx" ON "material_aliases"("alias")');
  await createIndexIfMissing(report, 'material_governance_runs_run_no_key', 'CREATE UNIQUE INDEX "material_governance_runs_run_no_key" ON "material_governance_runs"("run_no")');
  await createIndexIfMissing(report, 'material_governance_runs_run_type_status_idx', 'CREATE INDEX "material_governance_runs_run_type_status_idx" ON "material_governance_runs"("run_type", "status")');
  await createIndexIfMissing(report, 'material_governance_runs_created_by_created_at_idx', 'CREATE INDEX "material_governance_runs_created_by_created_at_idx" ON "material_governance_runs"("created_by", "created_at")');
  await createIndexIfMissing(report, 'material_governance_changes_run_id_entity_type_entity_id_field_name_key', 'CREATE UNIQUE INDEX "material_governance_changes_run_id_entity_type_entity_id_field_name_key" ON "material_governance_changes"("run_id", "entity_type", "entity_id", "field_name")');
  await createIndexIfMissing(report, 'material_governance_changes_entity_type_entity_id_idx', 'CREATE INDEX "material_governance_changes_entity_type_entity_id_idx" ON "material_governance_changes"("entity_type", "entity_id")');

  await addColumnIfMissing(report, 'production_bom_items', 'material_id', 'INTEGER');
  await createIndexIfMissing(report, 'production_bom_items_material_id_idx', 'CREATE INDEX "production_bom_items_material_id_idx" ON "production_bom_items"("material_id")');
};
