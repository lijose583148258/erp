ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "material_id" INTEGER;
ALTER TABLE "product_batches" ADD COLUMN IF NOT EXISTS "material_id" INTEGER;
ALTER TABLE "stock_balances" ADD COLUMN IF NOT EXISTS "material_id" INTEGER;
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "material_id" INTEGER;

CREATE INDEX IF NOT EXISTS "purchase_orders_material_id_idx" ON "purchase_orders" ("material_id");
CREATE INDEX IF NOT EXISTS "product_batches_material_id_idx" ON "product_batches" ("material_id");
CREATE INDEX IF NOT EXISTS "stock_balances_material_id_idx" ON "stock_balances" ("material_id");
CREATE INDEX IF NOT EXISTS "stock_movements_material_id_idx" ON "stock_movements" ("material_id");
CREATE UNIQUE INDEX IF NOT EXISTS "stock_balances_location_id_material_id_batch_no_key"
  ON "stock_balances" ("location_id", "material_id", "batch_no");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_material_id_fkey') THEN
    ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_material_id_fkey"
      FOREIGN KEY ("material_id") REFERENCES "materials" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_batches_material_id_fkey') THEN
    ALTER TABLE "product_batches" ADD CONSTRAINT "product_batches_material_id_fkey"
      FOREIGN KEY ("material_id") REFERENCES "materials" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_balances_material_id_fkey') THEN
    ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_material_id_fkey"
      FOREIGN KEY ("material_id") REFERENCES "materials" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_material_id_fkey') THEN
    ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_material_id_fkey"
      FOREIGN KEY ("material_id") REFERENCES "materials" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
