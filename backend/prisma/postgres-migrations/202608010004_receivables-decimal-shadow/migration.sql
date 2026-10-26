ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "final_amount_decimal" NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS "paid_amount_decimal" NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS "receivable_adjustment_amount_decimal" NUMERIC(18,2);

ALTER TABLE "payment_records"
  ADD COLUMN IF NOT EXISTS "amount_decimal" NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS "exchange_rate_decimal" NUMERIC(18,8),
  ADD COLUMN IF NOT EXISTS "base_amount_decimal" NUMERIC(18,2);

ALTER TABLE "receivable_adjustments"
  ADD COLUMN IF NOT EXISTS "amount_decimal" NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS "exchange_rate_decimal" NUMERIC(18,8),
  ADD COLUMN IF NOT EXISTS "base_amount_decimal" NUMERIC(18,2);

UPDATE "orders"
   SET "final_amount_decimal" = ROUND("final_amount"::numeric, 2),
       "paid_amount_decimal" = ROUND("paid_amount"::numeric, 2),
       "receivable_adjustment_amount_decimal" = ROUND("receivable_adjustment_amount"::numeric, 2)
 WHERE "final_amount_decimal" IS DISTINCT FROM ROUND("final_amount"::numeric, 2)
    OR "paid_amount_decimal" IS DISTINCT FROM ROUND("paid_amount"::numeric, 2)
    OR "receivable_adjustment_amount_decimal" IS DISTINCT FROM ROUND("receivable_adjustment_amount"::numeric, 2);

UPDATE "payment_records"
   SET "amount_decimal" = ROUND("amount"::numeric, 2),
       "exchange_rate_decimal" = ROUND("exchange_rate"::numeric, 8),
       "base_amount_decimal" = ROUND("base_amount"::numeric, 2)
 WHERE "amount_decimal" IS DISTINCT FROM ROUND("amount"::numeric, 2)
    OR "exchange_rate_decimal" IS DISTINCT FROM ROUND("exchange_rate"::numeric, 8)
    OR "base_amount_decimal" IS DISTINCT FROM ROUND("base_amount"::numeric, 2);

UPDATE "receivable_adjustments"
   SET "amount_decimal" = ROUND("amount"::numeric, 2),
       "exchange_rate_decimal" = ROUND("exchange_rate"::numeric, 8),
       "base_amount_decimal" = ROUND("base_amount"::numeric, 2)
 WHERE "amount_decimal" IS DISTINCT FROM ROUND("amount"::numeric, 2)
    OR "exchange_rate_decimal" IS DISTINCT FROM ROUND("exchange_rate"::numeric, 8)
    OR "base_amount_decimal" IS DISTINCT FROM ROUND("base_amount"::numeric, 2);

CREATE OR REPLACE FUNCTION "ailaoda_sync_orders_decimal_shadow_v1"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."final_amount_decimal" := ROUND(NEW."final_amount"::numeric, 2);
  NEW."paid_amount_decimal" := ROUND(NEW."paid_amount"::numeric, 2);
  NEW."receivable_adjustment_amount_decimal" := ROUND(NEW."receivable_adjustment_amount"::numeric, 2);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "ailaoda_sync_payment_records_decimal_shadow_v1"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."amount_decimal" := ROUND(NEW."amount"::numeric, 2);
  NEW."exchange_rate_decimal" := ROUND(NEW."exchange_rate"::numeric, 8);
  NEW."base_amount_decimal" := ROUND(NEW."base_amount"::numeric, 2);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "ailaoda_sync_receivable_adjustments_decimal_shadow_v1"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."amount_decimal" := ROUND(NEW."amount"::numeric, 2);
  NEW."exchange_rate_decimal" := ROUND(NEW."exchange_rate"::numeric, 8);
  NEW."base_amount_decimal" := ROUND(NEW."base_amount"::numeric, 2);
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  CREATE TRIGGER "orders_decimal_shadow_write_v1"
  BEFORE INSERT OR UPDATE OF "final_amount", "paid_amount", "receivable_adjustment_amount"
  ON "orders"
  FOR EACH ROW
  EXECUTE FUNCTION "ailaoda_sync_orders_decimal_shadow_v1"();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER "payment_records_decimal_shadow_write_v1"
  BEFORE INSERT OR UPDATE OF "amount", "exchange_rate", "base_amount"
  ON "payment_records"
  FOR EACH ROW
  EXECUTE FUNCTION "ailaoda_sync_payment_records_decimal_shadow_v1"();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER "receivable_adjustments_decimal_shadow_write_v1"
  BEFORE INSERT OR UPDATE OF "amount", "exchange_rate", "base_amount"
  ON "receivable_adjustments"
  FOR EACH ROW
  EXECUTE FUNCTION "ailaoda_sync_receivable_adjustments_decimal_shadow_v1"();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "orders"
  ALTER COLUMN "final_amount_decimal" SET NOT NULL,
  ALTER COLUMN "paid_amount_decimal" SET NOT NULL,
  ALTER COLUMN "receivable_adjustment_amount_decimal" SET NOT NULL;

ALTER TABLE "payment_records"
  ALTER COLUMN "amount_decimal" SET NOT NULL,
  ALTER COLUMN "exchange_rate_decimal" SET NOT NULL,
  ALTER COLUMN "base_amount_decimal" SET NOT NULL;

ALTER TABLE "receivable_adjustments"
  ALTER COLUMN "amount_decimal" SET NOT NULL,
  ALTER COLUMN "exchange_rate_decimal" SET NOT NULL,
  ALTER COLUMN "base_amount_decimal" SET NOT NULL;
