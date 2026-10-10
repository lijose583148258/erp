import { createIndexIfMissing, createTableIfMissing, type SchemaRepairReport } from './runtime-schema-repair-utils';

// Plans document how a shortage will be fulfilled. They deliberately do not
// alter stock balances or shipment quantities; only the established inventory
// posting path may do that.
export const repairSalesFulfillmentPlanSchema = async (report: SchemaRepairReport) => {
  await createTableIfMissing(report, 'sales_fulfillment_plans', `
    CREATE TABLE "sales_fulfillment_plans" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "plan_no" TEXT NOT NULL UNIQUE,
      "idempotency_key" TEXT NOT NULL UNIQUE,
      "request_fingerprint" TEXT NOT NULL,
      "order_id" INTEGER NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "order_item_id" INTEGER NOT NULL REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "fulfillment_option" TEXT NOT NULL CHECK ("fulfillment_option" IN ('linked_purchase', 'linked_production', 'approved_substitute', 'partial_delivery', 'cancel_refund')),
      "planned_quantity" REAL NOT NULL CHECK ("planned_quantity" > 0),
      "unit" TEXT NOT NULL,
      "source_document_id" INTEGER,
      "source_document_no" TEXT,
      "source_reference" TEXT,
      "source_snapshot" TEXT,
      "expected_fulfillment_at" DATETIME NOT NULL,
      "note" TEXT,
      "status" TEXT NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft', 'approved', 'closed', 'cancelled')),
      "accepted_quantity_at_approval" REAL,
      "approved_by" INTEGER REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "approved_at" DATETIME,
      "closeout_idempotency_key" TEXT UNIQUE,
      "closeout_snapshot" TEXT,
      "closed_by" INTEGER REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "closed_at" DATETIME,
      "created_by" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await createIndexIfMissing(report, 'sales_fulfillment_plans_order_id_idx', 'CREATE INDEX "sales_fulfillment_plans_order_id_idx" ON "sales_fulfillment_plans"("order_id")');
  await createIndexIfMissing(report, 'sales_fulfillment_plans_order_item_id_idx', 'CREATE INDEX "sales_fulfillment_plans_order_item_id_idx" ON "sales_fulfillment_plans"("order_item_id")');
  await createIndexIfMissing(report, 'sales_fulfillment_plans_status_expected_idx', 'CREATE INDEX "sales_fulfillment_plans_status_expected_idx" ON "sales_fulfillment_plans"("status", "expected_fulfillment_at")');
  await createIndexIfMissing(report, 'sales_fulfillment_plans_option_source_idx', 'CREATE INDEX "sales_fulfillment_plans_option_source_idx" ON "sales_fulfillment_plans"("fulfillment_option", "source_document_id")');
};
