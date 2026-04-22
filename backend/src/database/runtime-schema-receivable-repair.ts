import {
  SchemaRepairReport,
  createIndexIfMissing,
  createTableIfMissing,
} from './runtime-schema-repair-utils';

export const repairReceivableSchema = async (report: SchemaRepairReport) => {
  await createTableIfMissing(report, 'receivable_adjustments', `
    CREATE TABLE "receivable_adjustments" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "adjustment_no" TEXT NOT NULL,
      "adjustment_type" TEXT NOT NULL,
      "customer_id" INTEGER NOT NULL,
      "order_id" INTEGER NOT NULL,
      "amount" REAL NOT NULL,
      "currency" TEXT NOT NULL DEFAULT 'CNY',
      "exchange_rate" REAL NOT NULL DEFAULT 1.0,
      "base_amount" REAL NOT NULL DEFAULT 0,
      "reason" TEXT NOT NULL,
      "evidence_json" TEXT,
      "before_snapshot" TEXT,
      "after_snapshot" TEXT,
      "note" TEXT,
      "status" TEXT NOT NULL DEFAULT 'pending',
      "created_by" INTEGER NOT NULL,
      "posted_by" INTEGER,
      "reversed_by" INTEGER,
      "posted_at" DATETIME,
      "reversed_at" DATETIME,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "receivable_adjustments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "receivable_adjustments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "receivable_adjustments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT "receivable_adjustments_posted_by_fkey" FOREIGN KEY ("posted_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "receivable_adjustments_reversed_by_fkey" FOREIGN KEY ("reversed_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )
  `);

  await createIndexIfMissing(
    report,
    'receivable_adjustments_adjustment_no_key',
    'CREATE UNIQUE INDEX "receivable_adjustments_adjustment_no_key" ON "receivable_adjustments"("adjustment_no")',
  );
  await createIndexIfMissing(
    report,
    'receivable_adjustments_customer_id_idx',
    'CREATE INDEX "receivable_adjustments_customer_id_idx" ON "receivable_adjustments"("customer_id")',
  );
  await createIndexIfMissing(
    report,
    'receivable_adjustments_order_id_idx',
    'CREATE INDEX "receivable_adjustments_order_id_idx" ON "receivable_adjustments"("order_id")',
  );
  await createIndexIfMissing(
    report,
    'receivable_adjustments_status_idx',
    'CREATE INDEX "receivable_adjustments_status_idx" ON "receivable_adjustments"("status")',
  );
  await createIndexIfMissing(
    report,
    'receivable_adjustments_adjustment_type_idx',
    'CREATE INDEX "receivable_adjustments_adjustment_type_idx" ON "receivable_adjustments"("adjustment_type")',
  );
  await createIndexIfMissing(
    report,
    'receivable_adjustments_created_at_idx',
    'CREATE INDEX "receivable_adjustments_created_at_idx" ON "receivable_adjustments"("created_at")',
  );
};
