import {
  addColumnIfMissing,
  createIndexIfMissing,
  createTableIfMissing,
  dropIndexIfExists,
  SchemaRepairReport,
} from './runtime-schema-repair-utils';
import prisma from '../config/database';

export const repairProductionSchema = async (report: SchemaRepairReport) => {
  await addColumnIfMissing(report, 'production_boms', 'material_id', 'INTEGER');
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

  await addColumnIfMissing(report, 'production_work_orders', 'material_id', 'INTEGER');
  await addColumnIfMissing(report, 'order_items', 'material_id', 'INTEGER');
  await addColumnIfMissing(report, 'shipments', 'order_item_id', 'INTEGER');
  await addColumnIfMissing(report, 'shipments', 'material_id', 'INTEGER');
  await addColumnIfMissing(report, 'shipments', 'product_batch_id', 'INTEGER');
  await addColumnIfMissing(report, 'product_batches', 'quality_status', `TEXT NOT NULL DEFAULT 'not_required'`);

  await createTableIfMissing(report, 'production_quality_characteristics', `
    CREATE TABLE "production_quality_characteristics" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "bom_id" INTEGER NOT NULL,
      "code" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "value_type" TEXT NOT NULL DEFAULT 'numeric',
      "unit" TEXT,
      "lower_limit" DECIMAL,
      "upper_limit" DECIMAL,
      "target_text" TEXT,
      "test_method" TEXT,
      "required" BOOLEAN NOT NULL DEFAULT 1,
      "sort_order" INTEGER NOT NULL DEFAULT 0,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "production_quality_characteristics_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "production_boms" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  await addColumnIfMissing(report, 'production_quality_checks', 'revision', 'INTEGER');
  await addColumnIfMissing(report, 'production_quality_checks', 'status', `TEXT NOT NULL DEFAULT 'legacy_recorded'`);
  await addColumnIfMissing(report, 'production_quality_checks', 'disposition', `TEXT NOT NULL DEFAULT 'legacy'`);
  await addColumnIfMissing(report, 'production_quality_checks', 'sample_no', 'TEXT');
  await addColumnIfMissing(report, 'production_quality_checks', 'inspector_user_id', 'INTEGER');
  await addColumnIfMissing(report, 'production_quality_checks', 'reviewed_by_user_id', 'INTEGER');
  await addColumnIfMissing(report, 'production_quality_checks', 'reviewed_by', 'TEXT');
  await addColumnIfMissing(report, 'production_quality_checks', 'reviewed_at', 'DATETIME');
  await addColumnIfMissing(report, 'production_quality_checks', 'review_note', 'TEXT');
  await prisma.$executeRawUnsafe(`
    UPDATE "production_quality_checks" AS qc
    SET "revision" = (
      SELECT COUNT(*) FROM "production_quality_checks" AS earlier
      WHERE earlier."work_order_id" = qc."work_order_id"
        AND (earlier."created_at" < qc."created_at" OR (earlier."created_at" = qc."created_at" AND earlier."id" <= qc."id"))
    )
    WHERE qc."revision" IS NULL
  `);

  await createTableIfMissing(report, 'production_quality_measurements', `
    CREATE TABLE "production_quality_measurements" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "quality_check_id" INTEGER NOT NULL,
      "characteristic_id" INTEGER,
      "characteristic_code" TEXT NOT NULL,
      "characteristic_name" TEXT NOT NULL,
      "value_type" TEXT NOT NULL,
      "unit" TEXT,
      "lower_limit" DECIMAL,
      "upper_limit" DECIMAL,
      "target_text" TEXT,
      "measured_numeric" DECIMAL,
      "measured_text" TEXT,
      "result" TEXT NOT NULL,
      "test_method" TEXT,
      "instrument_no" TEXT,
      "note" TEXT,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "production_quality_measurements_quality_check_id_fkey" FOREIGN KEY ("quality_check_id") REFERENCES "production_quality_checks" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "production_quality_measurements_characteristic_id_fkey" FOREIGN KEY ("characteristic_id") REFERENCES "production_quality_characteristics" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )
  `);

  await createIndexIfMissing(report, 'production_boms_material_id_idx', 'CREATE INDEX "production_boms_material_id_idx" ON "production_boms"("material_id")');
  await createIndexIfMissing(report, 'production_work_orders_material_id_idx', 'CREATE INDEX "production_work_orders_material_id_idx" ON "production_work_orders"("material_id")');
  await createIndexIfMissing(report, 'order_items_material_id_idx', 'CREATE INDEX "order_items_material_id_idx" ON "order_items"("material_id")');
  await createIndexIfMissing(report, 'shipments_order_item_id_idx', 'CREATE INDEX "shipments_order_item_id_idx" ON "shipments"("order_item_id")');
  await createIndexIfMissing(report, 'shipments_material_id_idx', 'CREATE INDEX "shipments_material_id_idx" ON "shipments"("material_id")');
  await createIndexIfMissing(report, 'shipments_product_batch_id_idx', 'CREATE INDEX "shipments_product_batch_id_idx" ON "shipments"("product_batch_id")');
  await createIndexIfMissing(report, 'shipments_batch_no_idx', 'CREATE INDEX "shipments_batch_no_idx" ON "shipments"("batch_no")');
  await createIndexIfMissing(report, 'product_batches_quality_status_idx', 'CREATE INDEX "product_batches_quality_status_idx" ON "product_batches"("quality_status")');
  await createIndexIfMissing(report, 'production_quality_characteristics_bom_id_code_key', 'CREATE UNIQUE INDEX "production_quality_characteristics_bom_id_code_key" ON "production_quality_characteristics"("bom_id", "code")');
  await createIndexIfMissing(report, 'production_quality_characteristics_bom_id_sort_order_idx', 'CREATE INDEX "production_quality_characteristics_bom_id_sort_order_idx" ON "production_quality_characteristics"("bom_id", "sort_order")');
  await createIndexIfMissing(report, 'production_quality_checks_work_order_id_revision_key', 'CREATE UNIQUE INDEX "production_quality_checks_work_order_id_revision_key" ON "production_quality_checks"("work_order_id", "revision")');
  await createIndexIfMissing(report, 'production_quality_checks_status_idx', 'CREATE INDEX "production_quality_checks_status_idx" ON "production_quality_checks"("status")');
  await createIndexIfMissing(report, 'production_quality_measurements_quality_check_id_characteristic_code_key', 'CREATE UNIQUE INDEX "production_quality_measurements_quality_check_id_characteristic_code_key" ON "production_quality_measurements"("quality_check_id", "characteristic_code")');
  await createIndexIfMissing(report, 'production_quality_measurements_quality_check_id_idx', 'CREATE INDEX "production_quality_measurements_quality_check_id_idx" ON "production_quality_measurements"("quality_check_id")');
  await createIndexIfMissing(report, 'production_quality_measurements_characteristic_id_idx', 'CREATE INDEX "production_quality_measurements_characteristic_id_idx" ON "production_quality_measurements"("characteristic_id")');

  await createTableIfMissing(report, 'batch_genealogy_edges', `
    CREATE TABLE "batch_genealogy_edges" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "work_order_id" INTEGER NOT NULL,
      "input_stock_balance_id" INTEGER,
      "input_material_id" INTEGER,
      "input_batch_no" TEXT NOT NULL,
      "input_product_name" TEXT NOT NULL,
      "quantity_consumed" REAL NOT NULL,
      "input_unit" TEXT NOT NULL,
      "output_batch_id" INTEGER NOT NULL,
      "output_material_id" INTEGER,
      "output_batch_no" TEXT NOT NULL,
      "output_product_name" TEXT NOT NULL,
      "output_quantity" REAL NOT NULL,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "batch_genealogy_edges_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "production_work_orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "batch_genealogy_edges_input_stock_balance_id_fkey" FOREIGN KEY ("input_stock_balance_id") REFERENCES "stock_balances" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "batch_genealogy_edges_input_material_id_fkey" FOREIGN KEY ("input_material_id") REFERENCES "materials" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "batch_genealogy_edges_output_batch_id_fkey" FOREIGN KEY ("output_batch_id") REFERENCES "product_batches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT "batch_genealogy_edges_output_material_id_fkey" FOREIGN KEY ("output_material_id") REFERENCES "materials" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )
  `);
  await createIndexIfMissing(report, 'batch_genealogy_edges_work_order_id_input_stock_balance_id_output_batch_id_key', 'CREATE UNIQUE INDEX "batch_genealogy_edges_work_order_id_input_stock_balance_id_output_batch_id_key" ON "batch_genealogy_edges"("work_order_id", "input_stock_balance_id", "output_batch_id")');
  await createIndexIfMissing(report, 'batch_genealogy_edges_input_material_id_input_batch_no_idx', 'CREATE INDEX "batch_genealogy_edges_input_material_id_input_batch_no_idx" ON "batch_genealogy_edges"("input_material_id", "input_batch_no")');
  await createIndexIfMissing(report, 'batch_genealogy_edges_output_material_id_output_batch_id_idx', 'CREATE INDEX "batch_genealogy_edges_output_material_id_output_batch_id_idx" ON "batch_genealogy_edges"("output_material_id", "output_batch_id")');
  await createIndexIfMissing(report, 'batch_genealogy_edges_work_order_id_idx', 'CREATE INDEX "batch_genealogy_edges_work_order_id_idx" ON "batch_genealogy_edges"("work_order_id")');

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
      "quantity_delta" REAL NOT NULL DEFAULT 0,
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
  await addColumnIfMissing(report, 'inventory_cost_ledgers', 'quantity_delta', 'REAL NOT NULL DEFAULT 0');
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
