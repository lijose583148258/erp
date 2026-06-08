import prisma from '../config/database';
import {
  addColumnIfMissing,
  createIndexIfMissing,
  createTableIfMissing,
  dropIndexIfExists,
  indexExists,
  SchemaRepairReport,
} from './runtime-schema-repair-utils';

const STOCK_SOURCE_UNIQUE_INDEX_NAME = 'stock_entries_source_type_ref_status_key';
const IDEMPOTENT_STOCK_SOURCE_TYPES = [
  'production_consumption',
  'production_output',
  'procurement_receipt',
  'warehouse_manual_inbound',
  'shipping_issue',
  'barter_receipt',
  'barter_issue',
  'barter_receipt_reversal',
  'barter_issue_reversal',
];

const stockSourceTypeSqlList = () => IDEMPOTENT_STOCK_SOURCE_TYPES.map((sourceType) => `'${sourceType}'`).join(',\n         ');

const getIndexSql = async (indexName: string) => {
  const rows = await prisma.$queryRawUnsafe<Array<{ sql: string | null }>>(
    'SELECT sql FROM sqlite_master WHERE type = ? AND name = ? LIMIT 1',
    'index',
    indexName,
  );
  return rows[0]?.sql || null;
};

const existingStockSourceIndexIsCurrent = async () => {
  const sql = await getIndexSql(STOCK_SOURCE_UNIQUE_INDEX_NAME);
  if (!sql) return false;
  return IDEMPOTENT_STOCK_SOURCE_TYPES.every((sourceType) => sql.includes(`'${sourceType}'`));
};

const createStockSourceUniqueIndexIfSafe = async (report: SchemaRepairReport) => {
  const indexName = STOCK_SOURCE_UNIQUE_INDEX_NAME;
  if (await indexExists(indexName)) {
    if (await existingStockSourceIndexIsCurrent()) {
      report.entries.push({ kind: 'index', target: indexName, action: 'exists' });
      return;
    }
    await dropIndexIfExists(report, indexName);
  }

  const duplicates = await prisma.$queryRawUnsafe<Array<{ count: unknown }>>(
    `SELECT COUNT(*) AS count
     FROM (
       SELECT source_type, source_ref, status, COUNT(*) AS duplicate_count
       FROM stock_entries
       WHERE source_ref IS NOT NULL AND source_ref <> ''
         AND source_type IN (
           ${stockSourceTypeSqlList()}
         )
       GROUP BY source_type, source_ref, status
       HAVING COUNT(*) > 1
       LIMIT 1
     ) duplicate_sources`,
  );
  if (Number(duplicates[0]?.count || 0) > 0) {
    report.entries.push({ kind: 'index', target: indexName, action: 'skipped' });
    return;
  }

  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX "stock_entries_source_type_ref_status_key"
     ON "stock_entries"("source_type", "source_ref", "status")
     WHERE "source_ref" IS NOT NULL
       AND "source_ref" <> ''
       AND "source_type" IN (
         ${stockSourceTypeSqlList()}
       )`,
  );
  report.entries.push({ kind: 'index', target: indexName, action: 'created' });
};

const createWarehouseTransferUniqueIndexIfSafe = async (report: SchemaRepairReport) => {
  const indexName = 'stock_entries_warehouse_transfer_ref_status_key';
  if (await indexExists(indexName)) {
    report.entries.push({ kind: 'index', target: indexName, action: 'exists' });
    return;
  }

  const duplicates = await prisma.$queryRawUnsafe<Array<{ count: unknown }>>(
    `SELECT COUNT(*) AS count
     FROM (
       SELECT source_type, source_ref, status, COUNT(*) AS duplicate_count
       FROM stock_entries
       WHERE source_ref IS NOT NULL AND source_ref <> ''
         AND source_type = 'warehouse_transfer'
       GROUP BY source_type, source_ref, status
       HAVING COUNT(*) > 1
       LIMIT 1
     ) duplicate_sources`,
  );
  if (Number(duplicates[0]?.count || 0) > 0) {
    report.entries.push({ kind: 'index', target: indexName, action: 'skipped' });
    return;
  }

  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX "stock_entries_warehouse_transfer_ref_status_key"
     ON "stock_entries"("source_type", "source_ref", "status")
     WHERE "source_ref" IS NOT NULL
       AND "source_ref" <> ''
       AND "source_type" = 'warehouse_transfer'`,
  );
  report.entries.push({ kind: 'index', target: indexName, action: 'created' });
};

export const repairStockSchema = async (report: SchemaRepairReport) => {
  await createTableIfMissing(report, 'warehouses', `
    CREATE TABLE "warehouses" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "code" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "type" TEXT NOT NULL DEFAULT 'physical',
      "status" TEXT NOT NULL DEFAULT 'active',
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await createIndexIfMissing(report, 'warehouses_code_key', 'CREATE UNIQUE INDEX "warehouses_code_key" ON "warehouses"("code")');

  await createTableIfMissing(report, 'locations', `
    CREATE TABLE "locations" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "warehouse_id" INTEGER NOT NULL,
      "code" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "type" TEXT NOT NULL DEFAULT 'internal',
      "status" TEXT NOT NULL DEFAULT 'active',
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "locations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await createIndexIfMissing(report, 'locations_code_key', 'CREATE UNIQUE INDEX "locations_code_key" ON "locations"("code")');
  await createIndexIfMissing(report, 'locations_warehouse_id_idx', 'CREATE INDEX "locations_warehouse_id_idx" ON "locations"("warehouse_id")');

  await createTableIfMissing(report, 'stock_balances', `
    CREATE TABLE "stock_balances" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "location_id" INTEGER NOT NULL,
      "product_name" TEXT NOT NULL,
      "batch_no" TEXT NOT NULL,
      "quantity" REAL NOT NULL DEFAULT 0,
      "unit" TEXT NOT NULL DEFAULT 'kg',
      "last_move_at" DATETIME,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "stock_balances_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await createIndexIfMissing(report, 'stock_balances_loc_prod_batch_key', 'CREATE UNIQUE INDEX "stock_balances_loc_prod_batch_key" ON "stock_balances"("location_id", "product_name", "batch_no")');
  await createIndexIfMissing(report, 'stock_balances_product_name_idx', 'CREATE INDEX "stock_balances_product_name_idx" ON "stock_balances"("product_name")');
  await createIndexIfMissing(report, 'stock_balances_batch_no_idx', 'CREATE INDEX "stock_balances_batch_no_idx" ON "stock_balances"("batch_no")');

  await createTableIfMissing(report, 'stock_entries', `
    CREATE TABLE "stock_entries" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "entry_no" TEXT NOT NULL,
      "source_type" TEXT NOT NULL,
      "source_ref" TEXT,
      "direction" TEXT NOT NULL DEFAULT 'inbound',
      "status" TEXT NOT NULL DEFAULT 'posted',
      "warehouse_id" INTEGER,
      "location_id" INTEGER,
      "reason" TEXT,
      "note" TEXT,
      "created_by" INTEGER,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "posted_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "stock_entries_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "stock_entries_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "stock_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )
  `);
  await addColumnIfMissing(report, 'stock_entries', 'entry_no', 'TEXT');
  await addColumnIfMissing(report, 'stock_entries', 'source_type', 'TEXT');
  await addColumnIfMissing(report, 'stock_entries', 'source_ref', 'TEXT');
  await addColumnIfMissing(report, 'stock_entries', 'direction', `TEXT NOT NULL DEFAULT 'inbound'`);
  await addColumnIfMissing(report, 'stock_entries', 'status', `TEXT NOT NULL DEFAULT 'posted'`);
  await addColumnIfMissing(report, 'stock_entries', 'warehouse_id', 'INTEGER');
  await addColumnIfMissing(report, 'stock_entries', 'location_id', 'INTEGER');
  await addColumnIfMissing(report, 'stock_entries', 'reason', 'TEXT');
  await addColumnIfMissing(report, 'stock_entries', 'note', 'TEXT');
  await addColumnIfMissing(report, 'stock_entries', 'created_by', 'INTEGER');
  await addColumnIfMissing(report, 'stock_entries', 'created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
  await addColumnIfMissing(report, 'stock_entries', 'posted_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
  await createIndexIfMissing(report, 'stock_entries_entry_no_key', 'CREATE UNIQUE INDEX "stock_entries_entry_no_key" ON "stock_entries"("entry_no")');
  await createIndexIfMissing(report, 'stock_entries_source_type_idx', 'CREATE INDEX "stock_entries_source_type_idx" ON "stock_entries"("source_type")');
  await createIndexIfMissing(report, 'stock_entries_source_ref_idx', 'CREATE INDEX "stock_entries_source_ref_idx" ON "stock_entries"("source_ref")');
  await createStockSourceUniqueIndexIfSafe(report);
  await createWarehouseTransferUniqueIndexIfSafe(report);
  await createIndexIfMissing(report, 'stock_entries_warehouse_id_idx', 'CREATE INDEX "stock_entries_warehouse_id_idx" ON "stock_entries"("warehouse_id")');
  await createIndexIfMissing(report, 'stock_entries_location_id_idx', 'CREATE INDEX "stock_entries_location_id_idx" ON "stock_entries"("location_id")');
  await createIndexIfMissing(report, 'stock_entries_created_at_idx', 'CREATE INDEX "stock_entries_created_at_idx" ON "stock_entries"("created_at")');

  await createTableIfMissing(report, 'stock_movements', `
    CREATE TABLE "stock_movements" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "entry_id" INTEGER NOT NULL,
      "stock_balance_id" INTEGER,
      "location_id" INTEGER NOT NULL,
      "product_name" TEXT NOT NULL,
      "batch_no" TEXT NOT NULL,
      "unit" TEXT NOT NULL DEFAULT 'kg',
      "quantity_before" REAL NOT NULL DEFAULT 0,
      "quantity_delta" REAL NOT NULL DEFAULT 0,
      "quantity_after" REAL NOT NULL DEFAULT 0,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "stock_movements_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "stock_entries" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "stock_movements_stock_balance_id_fkey" FOREIGN KEY ("stock_balance_id") REFERENCES "stock_balances" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "stock_movements_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await addColumnIfMissing(report, 'stock_movements', 'entry_id', 'INTEGER');
  await addColumnIfMissing(report, 'stock_movements', 'stock_balance_id', 'INTEGER');
  await addColumnIfMissing(report, 'stock_movements', 'location_id', 'INTEGER');
  await addColumnIfMissing(report, 'stock_movements', 'product_name', 'TEXT');
  await addColumnIfMissing(report, 'stock_movements', 'batch_no', 'TEXT');
  await addColumnIfMissing(report, 'stock_movements', 'unit', `TEXT NOT NULL DEFAULT 'kg'`);
  await addColumnIfMissing(report, 'stock_movements', 'quantity_before', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissing(report, 'stock_movements', 'quantity_delta', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissing(report, 'stock_movements', 'quantity_after', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissing(report, 'stock_movements', 'created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
  await createIndexIfMissing(report, 'stock_movements_entry_id_idx', 'CREATE INDEX "stock_movements_entry_id_idx" ON "stock_movements"("entry_id")');
  await createIndexIfMissing(report, 'stock_movements_stock_balance_id_idx', 'CREATE INDEX "stock_movements_stock_balance_id_idx" ON "stock_movements"("stock_balance_id")');
  await createIndexIfMissing(report, 'stock_movements_location_id_idx', 'CREATE INDEX "stock_movements_location_id_idx" ON "stock_movements"("location_id")');
  await createIndexIfMissing(report, 'stock_movements_product_name_idx', 'CREATE INDEX "stock_movements_product_name_idx" ON "stock_movements"("product_name")');
  await createIndexIfMissing(report, 'stock_movements_batch_no_idx', 'CREATE INDEX "stock_movements_batch_no_idx" ON "stock_movements"("batch_no")');
};
