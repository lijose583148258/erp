CREATE TABLE IF NOT EXISTS "barter_cash_obligations" (
  "id" SERIAL PRIMARY KEY,
  "settlement_id" INTEGER NOT NULL REFERENCES "barter_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "amount" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL,
  "counterparty_name" TEXT NOT NULL,
  "owner_id" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "request_key" TEXT,
  "payment_reference" TEXT,
  "payment_date" TEXT,
  "resolution_note" TEXT,
  "resolved_by" INTEGER,
  "resolved_at" TIMESTAMP(3),
  "voided_by" INTEGER,
  "voided_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "barter_cash_obligations_settlement_id_key" ON "barter_cash_obligations"("settlement_id");
CREATE UNIQUE INDEX IF NOT EXISTS "barter_cash_obligations_request_key_key" ON "barter_cash_obligations"("request_key");
CREATE UNIQUE INDEX IF NOT EXISTS "barter_cash_obligations_currency_payment_reference_key" ON "barter_cash_obligations"("currency", "payment_reference");
CREATE INDEX IF NOT EXISTS "barter_cash_obligations_status_idx" ON "barter_cash_obligations"("status");
-- Retain history; unknown external settlement evidence requires manual reconciliation.
INSERT INTO "barter_cash_obligations"
  ("settlement_id", "amount", "currency", "counterparty_name", "owner_id", "status")
SELECT "id", ROUND((-"cash_difference")::numeric, 2)::double precision, UPPER(TRIM("currency")),
  "counterparty_name", COALESCE("posted_by", "created_by"), 'review'
FROM "barter_settlements" WHERE "status" = 'posted' AND "cash_difference" < 0
ON CONFLICT("settlement_id") DO NOTHING;
