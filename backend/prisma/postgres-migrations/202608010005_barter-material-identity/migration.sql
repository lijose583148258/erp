ALTER TABLE "barter_agreement_items" ADD COLUMN IF NOT EXISTS "material_id" INTEGER;
ALTER TABLE "barter_items" ADD COLUMN IF NOT EXISTS "material_id" INTEGER;

CREATE INDEX IF NOT EXISTS "barter_agreement_items_material_id_idx"
  ON "barter_agreement_items" ("material_id");
CREATE INDEX IF NOT EXISTS "barter_items_material_id_idx"
  ON "barter_items" ("material_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barter_agreement_items_material_id_fkey') THEN
    ALTER TABLE "barter_agreement_items" ADD CONSTRAINT "barter_agreement_items_material_id_fkey"
      FOREIGN KEY ("material_id") REFERENCES "materials" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barter_items_material_id_fkey') THEN
    ALTER TABLE "barter_items" ADD CONSTRAINT "barter_items_material_id_fkey"
      FOREIGN KEY ("material_id") REFERENCES "materials" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
