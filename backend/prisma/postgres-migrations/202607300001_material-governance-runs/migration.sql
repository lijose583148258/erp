CREATE TABLE IF NOT EXISTS "material_governance_runs" (
  "id" SERIAL PRIMARY KEY,
  "run_no" TEXT NOT NULL,
  "run_type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'applied',
  "input_digest" TEXT NOT NULL,
  "summary_json" TEXT,
  "created_by" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "applied_at" TIMESTAMP(3),
  "rolled_back_at" TIMESTAMP(3),
  CONSTRAINT "material_governance_runs_run_type_check"
    CHECK ("run_type" IN ('bom_backfill', 'material_import')),
  CONSTRAINT "material_governance_runs_status_check"
    CHECK ("status" IN ('applied', 'rolled_back', 'rollback_blocked'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "material_governance_runs_run_no_key"
  ON "material_governance_runs" ("run_no");
CREATE INDEX IF NOT EXISTS "material_governance_runs_run_type_status_idx"
  ON "material_governance_runs" ("run_type", "status");
CREATE INDEX IF NOT EXISTS "material_governance_runs_created_by_created_at_idx"
  ON "material_governance_runs" ("created_by", "created_at");

CREATE TABLE IF NOT EXISTS "material_governance_changes" (
  "id" SERIAL PRIMARY KEY,
  "run_id" INTEGER NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" INTEGER NOT NULL,
  "field_name" TEXT NOT NULL,
  "before_value" TEXT,
  "after_value" TEXT,
  "before_snapshot_json" TEXT,
  "after_snapshot_json" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "material_governance_changes_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "material_governance_runs" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "material_governance_changes_run_id_entity_type_entity_id_field_name_key"
  ON "material_governance_changes" ("run_id", "entity_type", "entity_id", "field_name");
CREATE INDEX IF NOT EXISTS "material_governance_changes_entity_type_entity_id_idx"
  ON "material_governance_changes" ("entity_type", "entity_id");
