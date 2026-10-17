-- Existing shipments keep NULL/unknown reservation history. No stock or voucher is rewritten.
ALTER TABLE "shipments"
  ADD COLUMN IF NOT EXISTS "reservation_balance_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "reservation_quantity" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "reservation_state" TEXT,
  ADD COLUMN IF NOT EXISTS "reservation_audit_id" INTEGER;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipments_reservation_balance_id_fkey' AND conrelid = 'shipments'::regclass) THEN
    ALTER TABLE "shipments" ADD CONSTRAINT "shipments_reservation_balance_id_fkey"
      FOREIGN KEY ("reservation_balance_id") REFERENCES "stock_balances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "shipments_reservation_balance_id_reservation_state_idx"
  ON "shipments"("reservation_balance_id", "reservation_state");
