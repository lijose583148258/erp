-- Existing orders start at revision 0; no business values are rewritten.
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 0;
