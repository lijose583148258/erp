ALTER TABLE "production_bom_items" ADD COLUMN IF NOT EXISTS "density_revision_id" INTEGER REFERENCES "material_density_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_bom_items" ADD COLUMN IF NOT EXISTS "density_snapshot_json" TEXT;
ALTER TABLE "production_work_orders" ADD COLUMN IF NOT EXISTS "density_snapshot_json" TEXT;
CREATE INDEX IF NOT EXISTS "production_bom_items_density_revision_id_idx" ON "production_bom_items"("density_revision_id");
