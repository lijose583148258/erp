import {
  addColumnIfMissing,
  createIndexIfMissing,
  createTableIfMissing,
  SchemaRepairReport,
} from './runtime-schema-repair-utils';

export const repairBarterSchema = async (report: SchemaRepairReport) => {
  await createTableIfMissing(report, 'barter_settlements', `
    CREATE TABLE "barter_settlements" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "settlement_no" TEXT NOT NULL,
      "counterparty_type" TEXT NOT NULL DEFAULT 'other',
      "counterparty_name" TEXT NOT NULL,
      "customer_id" INTEGER,
      "supplier_id" INTEGER,
      "order_id" INTEGER,
      "settlement_mode" TEXT NOT NULL DEFAULT 'mixed',
      "total_party_a_value" REAL NOT NULL DEFAULT 0,
      "total_party_b_value" REAL NOT NULL DEFAULT 0,
      "cash_difference" REAL NOT NULL DEFAULT 0,
      "currency" TEXT NOT NULL DEFAULT 'CNY',
      "status" TEXT NOT NULL DEFAULT 'quoted',
      "valuation_date" DATETIME,
      "approved_by" INTEGER,
      "approved_at" DATETIME,
      "posted_by" INTEGER,
      "posted_at" DATETIME,
      "reversed_at" DATETIME,
      "payment_record_id" INTEGER,
      "note" TEXT,
      "created_by" INTEGER NOT NULL,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME NOT NULL,
      CONSTRAINT "barter_settlements_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "barter_settlements_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "barter_settlements_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "barter_settlements_payment_record_id_fkey" FOREIGN KEY ("payment_record_id") REFERENCES "payment_records" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "barter_settlements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);

  await addColumnIfMissing(report, 'barter_settlements', 'settlement_no', 'TEXT');
  await addColumnIfMissing(report, 'barter_settlements', 'counterparty_type', `TEXT NOT NULL DEFAULT 'other'`);
  await addColumnIfMissing(report, 'barter_settlements', 'counterparty_name', 'TEXT');
  await addColumnIfMissing(report, 'barter_settlements', 'customer_id', 'INTEGER');
  await addColumnIfMissing(report, 'barter_settlements', 'supplier_id', 'INTEGER');
  await addColumnIfMissing(report, 'barter_settlements', 'order_id', 'INTEGER');
  await addColumnIfMissing(report, 'barter_settlements', 'settlement_mode', `TEXT NOT NULL DEFAULT 'mixed'`);
  await addColumnIfMissing(report, 'barter_settlements', 'total_party_a_value', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissing(report, 'barter_settlements', 'total_party_b_value', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissing(report, 'barter_settlements', 'cash_difference', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissing(report, 'barter_settlements', 'currency', `TEXT NOT NULL DEFAULT 'CNY'`);
  await addColumnIfMissing(report, 'barter_settlements', 'status', `TEXT NOT NULL DEFAULT 'quoted'`);
  await addColumnIfMissing(report, 'barter_settlements', 'valuation_date', 'DATETIME');
  await addColumnIfMissing(report, 'barter_settlements', 'approved_by', 'INTEGER');
  await addColumnIfMissing(report, 'barter_settlements', 'approved_at', 'DATETIME');
  await addColumnIfMissing(report, 'barter_settlements', 'posted_by', 'INTEGER');
  await addColumnIfMissing(report, 'barter_settlements', 'posted_at', 'DATETIME');
  await addColumnIfMissing(report, 'barter_settlements', 'reversed_at', 'DATETIME');
  await addColumnIfMissing(report, 'barter_settlements', 'payment_record_id', 'INTEGER');
  await addColumnIfMissing(report, 'barter_settlements', 'note', 'TEXT');
  await addColumnIfMissing(report, 'barter_settlements', 'created_by', 'INTEGER');
  await addColumnIfMissing(report, 'barter_settlements', 'created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
  await addColumnIfMissing(report, 'barter_settlements', 'updated_at', 'DATETIME');

  await createTableIfMissing(report, 'barter_items', `
    CREATE TABLE "barter_items" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "settlement_id" INTEGER NOT NULL,
      "side" TEXT NOT NULL,
      "item_name" TEXT NOT NULL,
      "specification" TEXT,
      "unit" TEXT NOT NULL,
      "quantity" REAL NOT NULL,
      "unit_price" REAL NOT NULL,
      "quality_factor" REAL NOT NULL DEFAULT 1,
      "loss_factor" REAL NOT NULL DEFAULT 1,
      "market_value" REAL NOT NULL,
      "valuation_method" TEXT NOT NULL DEFAULT 'market',
      "source_document" TEXT,
      "note" TEXT,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "barter_items_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "barter_settlements" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  await createTableIfMissing(report, 'barter_valuation_snapshots', `
    CREATE TABLE "barter_valuation_snapshots" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "settlement_id" INTEGER NOT NULL,
      "item_name" TEXT NOT NULL,
      "reference_price" REAL NOT NULL,
      "reference_source" TEXT,
      "market_area" TEXT,
      "valid_until" DATETIME,
      "appraised_by" INTEGER,
      "appraised_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "note" TEXT,
      CONSTRAINT "barter_valuation_snapshots_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "barter_settlements" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  await createTableIfMissing(report, 'barter_offset_postings', `
    CREATE TABLE "barter_offset_postings" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "settlement_id" INTEGER NOT NULL,
      "payment_record_id" INTEGER,
      "offset_amount" REAL NOT NULL,
      "offset_type" TEXT NOT NULL,
      "note" TEXT,
      "posted_by" INTEGER NOT NULL,
      "posted_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "barter_offset_postings_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "barter_settlements" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "barter_offset_postings_payment_record_id_fkey" FOREIGN KEY ("payment_record_id") REFERENCES "payment_records" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )
  `);

  await createTableIfMissing(report, 'barter_reversal_logs', `
    CREATE TABLE "barter_reversal_logs" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "settlement_id" INTEGER NOT NULL,
      "original_status" TEXT NOT NULL,
      "reason" TEXT NOT NULL,
      "reversed_by" INTEGER NOT NULL,
      "reversed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "barter_reversal_logs_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "barter_settlements" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  await createIndexIfMissing(report, 'barter_settlements_settlement_no_key', 'CREATE UNIQUE INDEX "barter_settlements_settlement_no_key" ON "barter_settlements"("settlement_no")');
  await createIndexIfMissing(report, 'barter_settlements_payment_record_id_key', 'CREATE UNIQUE INDEX "barter_settlements_payment_record_id_key" ON "barter_settlements"("payment_record_id")');
  await createIndexIfMissing(report, 'barter_settlements_customer_id_idx', 'CREATE INDEX "barter_settlements_customer_id_idx" ON "barter_settlements"("customer_id")');
  await createIndexIfMissing(report, 'barter_settlements_supplier_id_idx', 'CREATE INDEX "barter_settlements_supplier_id_idx" ON "barter_settlements"("supplier_id")');
  await createIndexIfMissing(report, 'barter_settlements_order_id_idx', 'CREATE INDEX "barter_settlements_order_id_idx" ON "barter_settlements"("order_id")');
  await createIndexIfMissing(report, 'barter_settlements_status_idx', 'CREATE INDEX "barter_settlements_status_idx" ON "barter_settlements"("status")');
  await createIndexIfMissing(report, 'barter_settlements_counterparty_type_idx', 'CREATE INDEX "barter_settlements_counterparty_type_idx" ON "barter_settlements"("counterparty_type")');
  await createIndexIfMissing(report, 'barter_items_settlement_id_idx', 'CREATE INDEX "barter_items_settlement_id_idx" ON "barter_items"("settlement_id")');
  await createIndexIfMissing(report, 'barter_items_side_idx', 'CREATE INDEX "barter_items_side_idx" ON "barter_items"("side")');
  await createIndexIfMissing(report, 'barter_valuation_snapshots_settlement_id_idx', 'CREATE INDEX "barter_valuation_snapshots_settlement_id_idx" ON "barter_valuation_snapshots"("settlement_id")');
  await createIndexIfMissing(report, 'barter_offset_postings_settlement_id_idx', 'CREATE INDEX "barter_offset_postings_settlement_id_idx" ON "barter_offset_postings"("settlement_id")');
  await createIndexIfMissing(report, 'barter_offset_postings_payment_record_id_idx', 'CREATE INDEX "barter_offset_postings_payment_record_id_idx" ON "barter_offset_postings"("payment_record_id")');
  await createIndexIfMissing(report, 'barter_reversal_logs_settlement_id_idx', 'CREATE INDEX "barter_reversal_logs_settlement_id_idx" ON "barter_reversal_logs"("settlement_id")');
};
