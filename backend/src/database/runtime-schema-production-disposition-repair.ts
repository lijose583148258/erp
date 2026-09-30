import { createIndexIfMissing, createTableIfMissing, type SchemaRepairReport } from './runtime-schema-repair-utils';

// The SQLite runtime cannot retroactively infer losses from work-order yield
// fields.  This creates a new append-only disposition ledger only.
export const repairProductionDispositionSchema = async (report: SchemaRepairReport) => {
  await createTableIfMissing(report, 'production_dispositions', `
    CREATE TABLE "production_dispositions" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "disposition_no" TEXT NOT NULL UNIQUE,
      "idempotency_key" TEXT NOT NULL UNIQUE,
      "work_order_id" INTEGER NOT NULL REFERENCES "production_work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "batch_id" INTEGER NOT NULL REFERENCES "product_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "stock_balance_id" INTEGER NOT NULL REFERENCES "stock_balances"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "disposition_type" TEXT NOT NULL CHECK ("disposition_type" IN ('scrap', 'rework_return')),
      "source_disposition_id" INTEGER REFERENCES "production_dispositions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "quantity" REAL NOT NULL CHECK ("quantity" > 0),
      "unit" TEXT NOT NULL DEFAULT 'kg',
      "cost_amount" REAL NOT NULL DEFAULT 0,
      "reworked_quantity" REAL NOT NULL DEFAULT 0 CHECK ("reworked_quantity" >= 0 AND "reworked_quantity" <= "quantity"),
      "reworked_cost_amount" REAL NOT NULL DEFAULT 0 CHECK ("reworked_cost_amount" >= 0 AND "reworked_cost_amount" <= "cost_amount"),
      "reason" TEXT NOT NULL,
      "note" TEXT,
      "before_snapshot" TEXT,
      "after_snapshot" TEXT,
      "status" TEXT NOT NULL DEFAULT 'posted',
      "created_by" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await createIndexIfMissing(report, 'production_dispositions_work_order_id_idx', 'CREATE INDEX "production_dispositions_work_order_id_idx" ON "production_dispositions"("work_order_id")');
  await createIndexIfMissing(report, 'production_dispositions_batch_id_idx', 'CREATE INDEX "production_dispositions_batch_id_idx" ON "production_dispositions"("batch_id")');
  await createIndexIfMissing(report, 'production_dispositions_stock_balance_id_idx', 'CREATE INDEX "production_dispositions_stock_balance_id_idx" ON "production_dispositions"("stock_balance_id")');
  await createIndexIfMissing(report, 'production_dispositions_source_disposition_id_idx', 'CREATE INDEX "production_dispositions_source_disposition_id_idx" ON "production_dispositions"("source_disposition_id")');
  await createIndexIfMissing(report, 'production_dispositions_disposition_type_status_idx', 'CREATE INDEX "production_dispositions_disposition_type_status_idx" ON "production_dispositions"("disposition_type", "status")');
};
