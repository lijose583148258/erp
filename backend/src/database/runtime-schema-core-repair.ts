import {
  addColumnIfMissing,
  createIndexIfMissing,
  createTableIfMissing,
  SchemaRepairReport,
} from './runtime-schema-repair-utils';

export const repairCoreSchema = async (report: SchemaRepairReport) => {
  await addColumnIfMissing(report, 'orders', 'locked_exchange_rate', 'REAL');
  await addColumnIfMissing(report, 'orders', 'base_amount', 'REAL');
  await addColumnIfMissing(report, 'orders', 'receivable_adjustment_amount', 'REAL NOT NULL DEFAULT 0');

  await addColumnIfMissing(report, 'customers', 'contacts_json', 'TEXT');
  await addColumnIfMissing(report, 'customers', 'addresses_json', 'TEXT');

  await createTableIfMissing(report, 'payment_records', `
    CREATE TABLE "payment_records" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "order_id" INTEGER NOT NULL,
      "amount" REAL NOT NULL,
      "currency" TEXT NOT NULL DEFAULT 'CNY',
      "exchange_rate" REAL NOT NULL DEFAULT 1.0,
      "base_amount" REAL NOT NULL DEFAULT 0,
      "method" TEXT NOT NULL,
      "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "payer_name" TEXT,
      "is_proxy" BOOLEAN NOT NULL DEFAULT false,
      "note" TEXT,
      "status" TEXT NOT NULL DEFAULT 'pending',
      "verified_by" INTEGER,
      "milestone_id" INTEGER,
      "barter_metadata" TEXT,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "payment_records_order_id_fkey"
        FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await createIndexIfMissing(report, 'payment_records_order_id_idx', 'CREATE INDEX "payment_records_order_id_idx" ON "payment_records"("order_id")');
  await createIndexIfMissing(report, 'payment_records_status_idx', 'CREATE INDEX "payment_records_status_idx" ON "payment_records"("status")');
  await createIndexIfMissing(report, 'payment_records_milestone_id_idx', 'CREATE INDEX "payment_records_milestone_id_idx" ON "payment_records"("milestone_id")');

  await addColumnIfMissing(report, 'payment_records', 'currency', `TEXT NOT NULL DEFAULT 'CNY'`);
  await addColumnIfMissing(report, 'payment_records', 'exchange_rate', 'REAL NOT NULL DEFAULT 1.0');
  await addColumnIfMissing(report, 'payment_records', 'base_amount', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissing(report, 'payment_records', 'barter_metadata', 'TEXT');

  await addColumnIfMissing(report, 'suppliers', 'name_aliases', 'TEXT');
  await addColumnIfMissing(report, 'suppliers', 'contacts_json', 'TEXT');
  await addColumnIfMissing(report, 'suppliers', 'addresses_json', 'TEXT');
  await addColumnIfMissing(report, 'shipments', 'signed_receipt_url', 'TEXT');

  await addColumnIfMissing(report, 'purchase_orders', 'currency', `TEXT NOT NULL DEFAULT 'CNY'`);
  await addColumnIfMissing(report, 'purchase_orders', 'exchange_rate', 'REAL NOT NULL DEFAULT 1.0');
  await addColumnIfMissing(report, 'purchase_orders', 'tax_rate', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissing(report, 'purchase_orders', 'tax_amount', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissing(report, 'purchase_orders', 'freight_cost', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissing(report, 'purchase_orders', 'duty_cost', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissing(report, 'purchase_orders', 'insurance_cost', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissing(report, 'purchase_orders', 'other_cost', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissing(report, 'purchase_orders', 'landed_cost_amount', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissing(report, 'purchase_orders', 'landed_unit_cost', 'REAL NOT NULL DEFAULT 0');
};
