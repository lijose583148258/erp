ALTER TABLE "production_boms" ADD COLUMN IF NOT EXISTS "material_id" INTEGER;
ALTER TABLE "production_work_orders" ADD COLUMN IF NOT EXISTS "material_id" INTEGER;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "material_id" INTEGER;
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "order_item_id" INTEGER;
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "material_id" INTEGER;
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "product_batch_id" INTEGER;

CREATE INDEX IF NOT EXISTS "production_boms_material_id_idx" ON "production_boms"("material_id");
CREATE INDEX IF NOT EXISTS "production_work_orders_material_id_idx" ON "production_work_orders"("material_id");
CREATE INDEX IF NOT EXISTS "order_items_material_id_idx" ON "order_items"("material_id");
CREATE INDEX IF NOT EXISTS "shipments_order_item_id_idx" ON "shipments"("order_item_id");
CREATE INDEX IF NOT EXISTS "shipments_material_id_idx" ON "shipments"("material_id");
CREATE INDEX IF NOT EXISTS "shipments_product_batch_id_idx" ON "shipments"("product_batch_id");
CREATE INDEX IF NOT EXISTS "shipments_batch_no_idx" ON "shipments"("batch_no");

DO $$ BEGIN
  ALTER TABLE "production_boms" ADD CONSTRAINT "production_boms_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "production_work_orders" ADD CONSTRAINT "production_work_orders_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "order_items" ADD CONSTRAINT "order_items_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "shipments" ADD CONSTRAINT "shipments_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "shipments" ADD CONSTRAINT "shipments_product_batch_id_fkey" FOREIGN KEY ("product_batch_id") REFERENCES "product_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "batch_genealogy_edges" (
  "id" SERIAL PRIMARY KEY,
  "work_order_id" INTEGER NOT NULL REFERENCES "production_work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "input_stock_balance_id" INTEGER REFERENCES "stock_balances"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "input_material_id" INTEGER REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "input_batch_no" TEXT NOT NULL,
  "input_product_name" TEXT NOT NULL,
  "quantity_consumed" DOUBLE PRECISION NOT NULL,
  "input_unit" TEXT NOT NULL,
  "output_batch_id" INTEGER NOT NULL REFERENCES "product_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "output_material_id" INTEGER REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "output_batch_no" TEXT NOT NULL,
  "output_product_name" TEXT NOT NULL,
  "output_quantity" DOUBLE PRECISION NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "batch_genealogy_edges_work_order_id_input_stock_balance_id_output_batch_id_key" ON "batch_genealogy_edges"("work_order_id", "input_stock_balance_id", "output_batch_id");
CREATE INDEX IF NOT EXISTS "batch_genealogy_edges_input_material_id_input_batch_no_idx" ON "batch_genealogy_edges"("input_material_id", "input_batch_no");
CREATE INDEX IF NOT EXISTS "batch_genealogy_edges_output_material_id_output_batch_id_idx" ON "batch_genealogy_edges"("output_material_id", "output_batch_id");
CREATE INDEX IF NOT EXISTS "batch_genealogy_edges_work_order_id_idx" ON "batch_genealogy_edges"("work_order_id");
