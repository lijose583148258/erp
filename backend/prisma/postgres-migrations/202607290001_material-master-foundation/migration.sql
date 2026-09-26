CREATE TABLE IF NOT EXISTS "materials" (
  "id" SERIAL PRIMARY KEY,
  "code" TEXT NOT NULL,
  "name_zh" TEXT NOT NULL,
  "name_en" TEXT,
  "name_vi" TEXT,
  "category" TEXT NOT NULL DEFAULT 'raw_material',
  "base_unit" TEXT NOT NULL,
  "specification" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "is_temporary" BOOLEAN NOT NULL DEFAULT TRUE,
  "cas_number" TEXT,
  "un_number" TEXT,
  "hs_code" TEXT,
  "shelf_life_days" INTEGER,
  "compliance_notes" TEXT,
  "created_by" INTEGER NOT NULL,
  "updated_by" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "materials_status_check" CHECK ("status" IN ('draft', 'active', 'blocked', 'retired')),
  CONSTRAINT "materials_category_check" CHECK ("category" IN ('raw_material', 'finished_good', 'semi_finished', 'packaging', 'consumable', 'service')),
  CONSTRAINT "materials_shelf_life_days_check" CHECK ("shelf_life_days" IS NULL OR "shelf_life_days" BETWEEN 1 AND 3650)
);

CREATE UNIQUE INDEX IF NOT EXISTS "materials_code_key" ON "materials" ("code");
CREATE INDEX IF NOT EXISTS "materials_name_zh_idx" ON "materials" ("name_zh");
CREATE INDEX IF NOT EXISTS "materials_name_en_idx" ON "materials" ("name_en");
CREATE INDEX IF NOT EXISTS "materials_name_vi_idx" ON "materials" ("name_vi");
CREATE INDEX IF NOT EXISTS "materials_category_status_idx" ON "materials" ("category", "status");
CREATE INDEX IF NOT EXISTS "materials_cas_number_idx" ON "materials" ("cas_number");
CREATE INDEX IF NOT EXISTS "materials_hs_code_idx" ON "materials" ("hs_code");

CREATE TABLE IF NOT EXISTS "material_aliases" (
  "id" SERIAL PRIMARY KEY,
  "material_id" INTEGER NOT NULL,
  "alias" TEXT NOT NULL,
  "normalized_alias" TEXT NOT NULL,
  "language" TEXT NOT NULL DEFAULT 'und',
  "alias_type" TEXT NOT NULL DEFAULT 'business',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "material_aliases_material_id_fkey"
    FOREIGN KEY ("material_id") REFERENCES "materials" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "material_aliases_language_check" CHECK ("language" IN ('zh', 'en', 'vi', 'und')),
  CONSTRAINT "material_aliases_alias_type_check" CHECK ("alias_type" IN ('business', 'supplier', 'customer', 'legacy', 'translation'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "material_aliases_material_id_normalized_alias_language_key"
  ON "material_aliases" ("material_id", "normalized_alias", "language");
CREATE INDEX IF NOT EXISTS "material_aliases_normalized_alias_language_idx"
  ON "material_aliases" ("normalized_alias", "language");
CREATE INDEX IF NOT EXISTS "material_aliases_material_id_idx" ON "material_aliases" ("material_id");
CREATE INDEX IF NOT EXISTS "material_aliases_alias_idx" ON "material_aliases" ("alias");

ALTER TABLE "production_bom_items" ADD COLUMN IF NOT EXISTS "material_id" INTEGER;
CREATE INDEX IF NOT EXISTS "production_bom_items_material_id_idx"
  ON "production_bom_items" ("material_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'production_bom_items_material_id_fkey'
  ) THEN
    ALTER TABLE "production_bom_items"
      ADD CONSTRAINT "production_bom_items_material_id_fkey"
      FOREIGN KEY ("material_id") REFERENCES "materials" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
