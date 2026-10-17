import {
  SchemaRepairReport,
  createIndexIfMissing,
  createTableIfMissing,
  addColumnIfMissing,
  ensureTriggerDefinition,
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

  await addColumnIfMissing(report, 'receivable_adjustments', 'order_item_id',
    'INTEGER REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE');
  await addColumnIfMissing(report, 'receivable_adjustments', 'cancelled_quantity',
    'REAL');
  await addColumnIfMissing(report, 'receivable_adjustments', 'request_key',
    'TEXT');
  await addColumnIfMissing(report, 'receivable_adjustments', 'request_fingerprint',
    'TEXT');
  await createIndexIfMissing(report, 'receivable_adjustments_request_key_key', 'CREATE UNIQUE INDEX "receivable_adjustments_request_key_key" ON "receivable_adjustments"("request_key")');
  await createIndexIfMissing(report, 'receivable_adjustments_order_item_id_idx', 'CREATE INDEX "receivable_adjustments_order_item_id_idx" ON "receivable_adjustments"("order_item_id")');
  // Prisma-created SQLite tables already contain the columns but not CHECK
  // clauses. Enforce the same invariant for fresh installs and old upgrades.
  for (const event of ['INSERT', 'UPDATE']) {
    const name = `receivable_adjustments_quantity_cancellation_${event.toLowerCase()}`;
    await ensureTriggerDefinition(report, name, `CREATE TRIGGER "${name}" BEFORE ${event} ON "receivable_adjustments"
      WHEN NOT (
        (NEW."adjustment_type" = 'order_quantity_cancellation' AND NEW."order_item_id" IS NOT NULL
          AND NEW."cancelled_quantity" IS NOT NULL AND NEW."cancelled_quantity" > 0 AND NEW."cancelled_quantity" < 1e999
          AND NEW."request_key" IS NOT NULL AND NEW."request_fingerprint" IS NOT NULL)
        OR (NEW."adjustment_type" <> 'order_quantity_cancellation' AND NEW."order_item_id" IS NULL
          AND NEW."cancelled_quantity" IS NULL AND NEW."request_key" IS NULL AND NEW."request_fingerprint" IS NULL)
      ) BEGIN SELECT RAISE(ABORT, 'RECEIVABLE_QUANTITY_CANCELLATION_INVALID'); END`);
  }

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
