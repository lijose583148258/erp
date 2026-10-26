import prisma from '../config/database';
import { createTableIfMissing, createIndexIfMissing, type SchemaRepairReport } from './runtime-schema-repair-utils';

export async function repairBarterCashSchema(report: SchemaRepairReport) {
  await createTableIfMissing(report, 'barter_cash_obligations', `CREATE TABLE "barter_cash_obligations" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "settlement_id" INTEGER NOT NULL,
    "amount" REAL NOT NULL,
    "currency" TEXT NOT NULL,
    "counterparty_name" TEXT NOT NULL,
    "owner_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "request_key" TEXT,
    "payment_reference" TEXT,
    "payment_date" TEXT,
    "resolution_note" TEXT,
    "resolved_by" INTEGER,
    "resolved_at" DATETIME,
    "voided_by" INTEGER,
    "voided_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("settlement_id") REFERENCES "barter_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE
  )`);
  for (const [name, sql] of [
    ['barter_cash_obligations_settlement_id_key', 'UNIQUE INDEX "barter_cash_obligations_settlement_id_key" ON "barter_cash_obligations"("settlement_id")'],
    ['barter_cash_obligations_request_key_key', 'UNIQUE INDEX "barter_cash_obligations_request_key_key" ON "barter_cash_obligations"("request_key")'],
    ['barter_cash_obligations_currency_payment_reference_key', 'UNIQUE INDEX "barter_cash_obligations_currency_payment_reference_key" ON "barter_cash_obligations"("currency", "payment_reference")'],
    ['barter_cash_obligations_status_idx', 'INDEX "barter_cash_obligations_status_idx" ON "barter_cash_obligations"("status")'],
  ]) await createIndexIfMissing(report, name, `CREATE ${sql}`);
  // Historic records may already have an out-of-system refund: do not invent payment evidence.
  await prisma.$executeRawUnsafe(`INSERT INTO "barter_cash_obligations"
    ("settlement_id", "amount", "currency", "counterparty_name", "owner_id", "status", "created_at", "updated_at")
    SELECT "id", ROUND(-"cash_difference", 2), UPPER(TRIM("currency")), "counterparty_name",
      COALESCE("posted_by", "created_by"), 'review', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM "barter_settlements" WHERE "status" = 'posted' AND "cash_difference" < 0
    ON CONFLICT("settlement_id") DO NOTHING`);
}
