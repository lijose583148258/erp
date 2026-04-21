import {
  addColumnIfMissing,
  createIndexIfMissing,
  createTableIfMissing,
  dropIndexIfExists,
  SchemaRepairReport,
} from './runtime-schema-repair-utils';

export const repairProductionSchema = async (report: SchemaRepairReport) => {
  await addColumnIfMissing(report, 'production_boms', 'bom_type', `TEXT NOT NULL DEFAULT 'standard'`);
  await addColumnIfMissing(report, 'production_boms', 'status', `TEXT NOT NULL DEFAULT 'draft'`);
  await addColumnIfMissing(report, 'production_boms', 'formulation_mode', 'TEXT');
  await addColumnIfMissing(report, 'production_boms', 'standard_batch_size', 'REAL');
  await addColumnIfMissing(report, 'production_boms', 'batch_size_unit', 'TEXT');
  await addColumnIfMissing(report, 'production_boms', 'density', 'REAL');
  await addColumnIfMissing(report, 'production_boms', 'solid_content', 'REAL');
  await addColumnIfMissing(report, 'production_boms', 'effective_from', 'DATETIME');
  await addColumnIfMissing(report, 'production_boms', 'effective_to', 'DATETIME');
  await addColumnIfMissing(report, 'production_boms', 'process_json', 'TEXT');
  await addColumnIfMissing(report, 'production_boms', 'quality_spec_json', 'TEXT');

  await addColumnIfMissing(report, 'production_bom_items', 'material_code', 'TEXT');
  await addColumnIfMissing(report, 'production_bom_items', 'ingredient_role', 'TEXT');
  await addColumnIfMissing(report, 'production_bom_items', 'dosage_mode', 'TEXT');
  await addColumnIfMissing(report, 'production_bom_items', 'percentage', 'REAL');
  await addColumnIfMissing(report, 'production_bom_items', 'allowed_variance_rate', 'REAL');
  await addColumnIfMissing(report, 'production_bom_items', 'process_stage', 'TEXT');
  await addColumnIfMissing(report, 'production_bom_items', 'substitute_group', 'TEXT');
  await addColumnIfMissing(report, 'production_bom_items', 'yield_contribution', 'REAL');

  await createTableIfMissing(report, 'inventory_cost_ledgers', `
    CREATE TABLE "inventory_cost_ledgers" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "ledger_no" TEXT NOT NULL,
      "batch_id" INTEGER NOT NULL,
      "source_type" TEXT NOT NULL,
      "source_ref" TEXT,
      "work_order_id" INTEGER,
      "adjustment_id" INTEGER,
      "quantity_before" REAL NOT NULL DEFAULT 0,
      "quantity_delta" REAL NOT NULL,
      "quantity_after" REAL NOT NULL DEFAULT 0,
      "cost_before" REAL NOT NULL DEFAULT 0,
      "cost_amount_delta" REAL NOT NULL DEFAULT 0,
      "cost_after" REAL NOT NULL DEFAULT 0,
      "unit_cost" REAL,
      "note" TEXT,
      "created_by" INTEGER NOT NULL,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "inventory_cost_ledgers_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "product_batches" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "inventory_cost_ledgers_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "production_work_orders" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "inventory_cost_ledgers_adjustment_id_fkey" FOREIGN KEY ("adjustment_id") REFERENCES "adjustment_records" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "inventory_cost_ledgers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);

  await addColumnIfMissing(report, 'inventory_cost_ledgers', 'ledger_no', 'TEXT');
  await addColumnIfMissing(report, 'inventory_cost_ledgers', 'batch_id', 'INTEGER');
  await addColumnIfMissing(report, 'inventory_cost_ledgers', 'source_type', 'TEXT');
  await addColumnIfMissing(report, 'inventory_cost_ledgers', 'source_ref', 'TEXT');
  await addColumnIfMissing(report, 'inventory_cost_ledgers', 'work_order_id', 'INTEGER');
  await addColumnIfMissing(report, 'inventory_cost_ledgers', 'adjustment_id', 'INTEGER');
  await addColumnIfMissing(report, 'inventory_cost_ledgers', 'quantity_before', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissing(report, 'inventory_cost_ledgers', 'quantity_delta', 'REAL NOT NULL');
  await addColumnIfMissing(report, 'inventory_cost_ledgers', 'quantity_after', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissing(report, 'inventory_cost_ledgers', 'cost_before', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissing(report, 'inventory_cost_ledgers', 'cost_amount_delta', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissing(report, 'inventory_cost_ledgers', 'cost_after', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissing(report, 'inventory_cost_ledgers', 'unit_cost', 'REAL');
  await addColumnIfMissing(report, 'inventory_cost_ledgers', 'note', 'TEXT');
  await addColumnIfMissing(report, 'inventory_cost_ledgers', 'created_by', 'INTEGER');
  await addColumnIfMissing(report, 'inventory_cost_ledgers', 'created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');

  await createIndexIfMissing(report, 'inventory_cost_ledgers_ledger_no_key', 'CREATE UNIQUE INDEX "inventory_cost_ledgers_ledger_no_key" ON "inventory_cost_ledgers"("ledger_no")');
  await createIndexIfMissing(report, 'inventory_cost_ledgers_batch_id_idx', 'CREATE INDEX "inventory_cost_ledgers_batch_id_idx" ON "inventory_cost_ledgers"("batch_id")');
  await createIndexIfMissing(report, 'inventory_cost_ledgers_source_type_idx', 'CREATE INDEX "inventory_cost_ledgers_source_type_idx" ON "inventory_cost_ledgers"("source_type")');
  await dropIndexIfExists(report, 'inventory_cost_ledgers_work_order_id_key');
  await createIndexIfMissing(report, 'inventory_cost_ledgers_work_order_id_idx', 'CREATE INDEX "inventory_cost_ledgers_work_order_id_idx" ON "inventory_cost_ledgers"("work_order_id")');
  await createIndexIfMissing(report, 'inventory_cost_ledgers_adjustment_id_key', 'CREATE UNIQUE INDEX "inventory_cost_ledgers_adjustment_id_key" ON "inventory_cost_ledgers"("adjustment_id")');
  await createIndexIfMissing(report, 'inventory_cost_ledgers_created_by_idx', 'CREATE INDEX "inventory_cost_ledgers_created_by_idx" ON "inventory_cost_ledgers"("created_by")');
};
