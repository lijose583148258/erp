import prisma from '../config/database';

type RepairAction = 'created' | 'exists' | 'added' | 'skipped' | 'dropped' | 'updated';

export interface SchemaRepairEntry {
  kind: 'table' | 'column' | 'index' | 'seed';
  target: string;
  action: RepairAction;
}

export interface SchemaRepairReport {
  entries: SchemaRepairEntry[];
}

type TableInfoRow = {
  cid?: unknown;
  name?: unknown;
  type?: unknown;
  notnull?: unknown;
  dflt_value?: unknown;
  pk?: unknown;
};

const normalizeTableInfo = (rows: TableInfoRow[]) =>
  rows.map((row) => ({
    ...row,
    cid: typeof row.cid === 'bigint' ? Number(row.cid) : row.cid,
    pk: typeof row.pk === 'bigint' ? Number(row.pk) : row.pk,
    notnull: typeof row.notnull === 'bigint' ? Number(row.notnull) : row.notnull,
  }));

const tableExists = async (tableName: string) => {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    'SELECT name FROM sqlite_master WHERE type = ? AND name = ?',
    'table',
    tableName,
  );
  return rows.length > 0;
};

const indexExists = async (indexName: string) => {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    'SELECT name FROM sqlite_master WHERE type = ? AND name = ?',
    'index',
    indexName,
  );
  return rows.length > 0;
};

// PRAGMA 安全白名单：仅允许对已知表执行 table_info 查询
const KNOWN_TABLES = new Set([
  'orders', 'customers', 'suppliers', 'payment_records', 'shipments', 'purchase_orders',
  'purchase_receipts', 'shipment_receipts', 'receipt_discrepancy_cases',
  'receipt_discrepancy_actions', 'receipt_tolerance_rules',
  'barter_settlements', 'barter_items', 'barter_valuation_snapshots',
  'barter_offset_postings', 'barter_reversal_logs', 'contracts',
  'contract_milestones', 'product_batches', 'adjustment_records',
  'production_boms', 'production_bom_items', 'production_work_orders',
  'inventory_cost_ledgers',
  'warehouses', 'locations', 'stock_balances', 'stock_entries', 'stock_movements',
  'auth_roles', 'auth_permissions', 'auth_role_permissions',
]);

const columnExists = async (tableName: string, columnName: string) => {
  // PRAGMA 拼接防御：白名单校验 tableName，防止非硬编码参数导致注入
  if (!KNOWN_TABLES.has(tableName)) {
    throw new Error(`Schema repair rejected: unknown table '${tableName}'`);
  }
  const rows = await prisma.$queryRawUnsafe<TableInfoRow[]>(`PRAGMA table_info('${tableName}')`);
  return normalizeTableInfo(rows).some((row) => row.name === columnName);
};

const createTableIfMissing = async (
  report: SchemaRepairReport,
  tableName: string,
  createSql: string,
) => {
  if (await tableExists(tableName)) {
    report.entries.push({ kind: 'table', target: tableName, action: 'exists' });
    return;
  }

  await prisma.$executeRawUnsafe(createSql);
  report.entries.push({ kind: 'table', target: tableName, action: 'created' });
};

const addColumnIfMissing = async (
  report: SchemaRepairReport,
  tableName: string,
  columnName: string,
  definition: string,
) => {
  if (await columnExists(tableName, columnName)) {
    report.entries.push({ kind: 'column', target: `${tableName}.${columnName}`, action: 'exists' });
    return;
  }

  await prisma.$executeRawUnsafe(`ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${definition}`);
  report.entries.push({ kind: 'column', target: `${tableName}.${columnName}`, action: 'added' });
};

const createIndexIfMissing = async (
  report: SchemaRepairReport,
  indexName: string,
  createSql: string,
) => {
  if (await indexExists(indexName)) {
    report.entries.push({ kind: 'index', target: indexName, action: 'exists' });
    return;
  }

  await prisma.$executeRawUnsafe(createSql);
  report.entries.push({ kind: 'index', target: indexName, action: 'created' });
};

const dropIndexIfExists = async (
  report: SchemaRepairReport,
  indexName: string,
) => {
  if (!(await indexExists(indexName))) {
    report.entries.push({ kind: 'index', target: indexName, action: 'skipped' });
    return;
  }

  await prisma.$executeRawUnsafe(`DROP INDEX "${indexName}"`);
  report.entries.push({ kind: 'index', target: indexName, action: 'dropped' });
};

const seedReceiptToleranceRuleIfMissing = async (
  report: SchemaRepairReport,
  params: {
    ruleNo: string;
    name: string;
    sourceType: string;
    discrepancyType: string;
    counterpartyType: string;
    quantityTolerancePercent?: number;
    quantityToleranceAbs?: number;
    actionWithinTolerance?: string;
    actionOutsideTolerance?: string;
    severityWithinTolerance?: string;
    severityOutsideTolerance?: string;
    requiresQualityCheck?: boolean;
    priority?: number;
    note?: string;
  },
) => {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
    'SELECT id FROM receipt_tolerance_rules WHERE rule_no = ? LIMIT 1',
    params.ruleNo,
  );
  if (rows.length > 0) {
    report.entries.push({ kind: 'seed', target: params.ruleNo, action: 'exists' });
    return;
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO receipt_tolerance_rules
      (rule_no, name, source_type, discrepancy_type, counterparty_type,
       quantity_tolerance_percent, quantity_tolerance_abs, action_within_tolerance, action_outside_tolerance,
       severity_within_tolerance, severity_outside_tolerance, requires_quality_check, status, priority, note,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    params.ruleNo,
    params.name,
    params.sourceType,
    params.discrepancyType,
    params.counterpartyType,
    params.quantityTolerancePercent ?? 0,
    params.quantityToleranceAbs ?? 0,
    params.actionWithinTolerance || 'warn',
    params.actionOutsideTolerance || 'manual_review',
    params.severityWithinTolerance || 'low',
    params.severityOutsideTolerance || 'normal',
    params.requiresQualityCheck ? 1 : 0,
    params.priority || 900,
    params.note || null,
  );
  report.entries.push({ kind: 'seed', target: params.ruleNo, action: 'created' });
};

const createStockSourceUniqueIndexIfSafe = async (report: SchemaRepairReport) => {
  const indexName = 'stock_entries_source_type_ref_status_key';
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
         AND source_type IN (
           'production_consumption',
           'production_output',
           'procurement_receipt',
           'shipping_issue',
           'barter_receipt',
           'barter_issue',
           'barter_receipt_reversal',
           'barter_issue_reversal'
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
         'production_consumption',
         'production_output',
         'procurement_receipt',
         'shipping_issue',
         'barter_receipt',
         'barter_issue',
         'barter_receipt_reversal',
         'barter_issue_reversal'
       )`,
  );
  report.entries.push({ kind: 'index', target: indexName, action: 'created' });
};

export const repairRuntimeSchema = async (): Promise<SchemaRepairReport> => {
  const report: SchemaRepairReport = { entries: [] };

  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');

  await addColumnIfMissing(report, 'orders', 'locked_exchange_rate', 'REAL');
  await addColumnIfMissing(report, 'orders', 'base_amount', 'REAL');

  await addColumnIfMissing(report, 'customers', 'contacts_json', 'TEXT');
  await addColumnIfMissing(report, 'customers', 'addresses_json', 'TEXT');

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

  await createTableIfMissing(report, 'purchase_receipts', `
    CREATE TABLE "purchase_receipts" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "receipt_no" TEXT NOT NULL,
      "purchase_order_id" INTEGER NOT NULL,
      "quantity" REAL NOT NULL,
      "accepted_quantity" REAL NOT NULL DEFAULT 0,
      "rejected_quantity" REAL NOT NULL DEFAULT 0,
      "unit" TEXT NOT NULL DEFAULT 'kg',
      "batch_no" TEXT,
      "stock_entry_ref" TEXT,
      "discrepancy_reason" TEXT,
      "note" TEXT,
      "received_by" INTEGER,
      "received_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "purchase_receipts_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "purchase_receipts_received_by_fkey" FOREIGN KEY ("received_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )
  `);
  await createIndexIfMissing(report, 'purchase_receipts_receipt_no_key', 'CREATE UNIQUE INDEX "purchase_receipts_receipt_no_key" ON "purchase_receipts"("receipt_no")');
  await createIndexIfMissing(report, 'purchase_receipts_purchase_order_id_idx', 'CREATE INDEX "purchase_receipts_purchase_order_id_idx" ON "purchase_receipts"("purchase_order_id")');
  await createIndexIfMissing(report, 'purchase_receipts_stock_entry_ref_idx', 'CREATE INDEX "purchase_receipts_stock_entry_ref_idx" ON "purchase_receipts"("stock_entry_ref")');

  await createTableIfMissing(report, 'shipment_receipts', `
    CREATE TABLE "shipment_receipts" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "receipt_no" TEXT NOT NULL,
      "shipment_id" INTEGER NOT NULL,
      "quantity" REAL NOT NULL,
      "accepted_quantity" REAL NOT NULL DEFAULT 0,
      "rejected_quantity" REAL NOT NULL DEFAULT 0,
      "unit" TEXT NOT NULL DEFAULT 'kg',
      "signed_receipt_url" TEXT,
      "discrepancy_reason" TEXT,
      "note" TEXT,
      "received_by" INTEGER,
      "received_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "shipment_receipts_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "shipment_receipts_received_by_fkey" FOREIGN KEY ("received_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )
  `);
  await createIndexIfMissing(report, 'shipment_receipts_receipt_no_key', 'CREATE UNIQUE INDEX "shipment_receipts_receipt_no_key" ON "shipment_receipts"("receipt_no")');
  await createIndexIfMissing(report, 'shipment_receipts_shipment_id_idx', 'CREATE INDEX "shipment_receipts_shipment_id_idx" ON "shipment_receipts"("shipment_id")');

  await createTableIfMissing(report, 'receipt_discrepancy_cases', `
    CREATE TABLE "receipt_discrepancy_cases" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "case_no" TEXT NOT NULL,
      "source_type" TEXT NOT NULL,
      "source_ref" TEXT NOT NULL,
      "source_id" INTEGER,
      "related_module" TEXT NOT NULL,
      "related_id" INTEGER NOT NULL,
      "business_ref" TEXT,
      "counterparty_type" TEXT NOT NULL,
      "counterparty_id" INTEGER,
      "counterparty_name" TEXT,
      "product_name" TEXT NOT NULL,
      "quantity" REAL NOT NULL,
      "unit" TEXT NOT NULL DEFAULT 'kg',
      "discrepancy_type" TEXT NOT NULL DEFAULT 'other',
      "reason" TEXT NOT NULL,
      "severity" TEXT NOT NULL DEFAULT 'normal',
      "status" TEXT NOT NULL DEFAULT 'pending',
      "tolerance_rule_id" INTEGER,
      "tolerance_action" TEXT NOT NULL DEFAULT 'manual_review',
      "tolerance_percent" REAL,
      "tolerance_quantity" REAL,
      "variance_rate" REAL,
      "within_tolerance" INTEGER NOT NULL DEFAULT 0,
      "requires_quality_check" INTEGER NOT NULL DEFAULT 0,
      "suggested_action" TEXT,
      "resolution" TEXT,
      "action_ref" TEXT,
      "note" TEXT,
      "created_by" INTEGER,
      "resolved_by" INTEGER,
      "resolved_at" DATETIME,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "receipt_discrepancy_cases_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "receipt_discrepancy_cases_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )
  `);
  await addColumnIfMissing(report, 'receipt_discrepancy_cases', 'discrepancy_type', `TEXT NOT NULL DEFAULT 'other'`);
  await addColumnIfMissing(report, 'receipt_discrepancy_cases', 'tolerance_rule_id', 'INTEGER');
  await addColumnIfMissing(report, 'receipt_discrepancy_cases', 'tolerance_action', `TEXT NOT NULL DEFAULT 'manual_review'`);
  await addColumnIfMissing(report, 'receipt_discrepancy_cases', 'tolerance_percent', 'REAL');
  await addColumnIfMissing(report, 'receipt_discrepancy_cases', 'tolerance_quantity', 'REAL');
  await addColumnIfMissing(report, 'receipt_discrepancy_cases', 'variance_rate', 'REAL');
  await addColumnIfMissing(report, 'receipt_discrepancy_cases', 'within_tolerance', 'INTEGER NOT NULL DEFAULT 0');
  await addColumnIfMissing(report, 'receipt_discrepancy_cases', 'requires_quality_check', 'INTEGER NOT NULL DEFAULT 0');
  await createIndexIfMissing(report, 'receipt_discrepancy_cases_case_no_key', 'CREATE UNIQUE INDEX "receipt_discrepancy_cases_case_no_key" ON "receipt_discrepancy_cases"("case_no")');
  await createIndexIfMissing(report, 'receipt_discrepancy_cases_source_key', 'CREATE UNIQUE INDEX "receipt_discrepancy_cases_source_key" ON "receipt_discrepancy_cases"("source_type", "source_ref")');
  await createIndexIfMissing(report, 'receipt_discrepancy_cases_related_idx', 'CREATE INDEX "receipt_discrepancy_cases_related_idx" ON "receipt_discrepancy_cases"("related_module", "related_id")');
  await createIndexIfMissing(report, 'receipt_discrepancy_cases_status_idx', 'CREATE INDEX "receipt_discrepancy_cases_status_idx" ON "receipt_discrepancy_cases"("status")');
  await createIndexIfMissing(report, 'receipt_discrepancy_cases_counterparty_idx', 'CREATE INDEX "receipt_discrepancy_cases_counterparty_idx" ON "receipt_discrepancy_cases"("counterparty_type", "counterparty_id")');
  await createIndexIfMissing(report, 'receipt_discrepancy_cases_type_idx', 'CREATE INDEX "receipt_discrepancy_cases_type_idx" ON "receipt_discrepancy_cases"("discrepancy_type")');

  await createTableIfMissing(report, 'receipt_discrepancy_actions', `
    CREATE TABLE "receipt_discrepancy_actions" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "action_no" TEXT NOT NULL,
      "case_id" INTEGER NOT NULL,
      "action_type" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'pending',
      "source_module" TEXT,
      "source_ref" TEXT,
      "target_module" TEXT,
      "target_id" INTEGER,
      "target_ref" TEXT,
      "quantity" REAL,
      "unit" TEXT,
      "amount" REAL,
      "currency" TEXT NOT NULL DEFAULT 'CNY',
      "reason_code" TEXT,
      "disposition_code" TEXT,
      "note" TEXT,
      "created_by" INTEGER,
      "approved_by" INTEGER,
      "posted_at" DATETIME,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "receipt_discrepancy_actions_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "receipt_discrepancy_cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "receipt_discrepancy_actions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "receipt_discrepancy_actions_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )
  `);
  await createIndexIfMissing(report, 'receipt_discrepancy_actions_action_no_key', 'CREATE UNIQUE INDEX "receipt_discrepancy_actions_action_no_key" ON "receipt_discrepancy_actions"("action_no")');
  await createIndexIfMissing(report, 'receipt_discrepancy_actions_case_id_idx', 'CREATE INDEX "receipt_discrepancy_actions_case_id_idx" ON "receipt_discrepancy_actions"("case_id")');
  await createIndexIfMissing(report, 'receipt_discrepancy_actions_type_idx', 'CREATE INDEX "receipt_discrepancy_actions_type_idx" ON "receipt_discrepancy_actions"("action_type")');
  await createIndexIfMissing(report, 'receipt_discrepancy_actions_status_idx', 'CREATE INDEX "receipt_discrepancy_actions_status_idx" ON "receipt_discrepancy_actions"("status")');
  await createIndexIfMissing(report, 'receipt_discrepancy_actions_target_idx', 'CREATE INDEX "receipt_discrepancy_actions_target_idx" ON "receipt_discrepancy_actions"("target_module", "target_id")');

  await createTableIfMissing(report, 'receipt_tolerance_rules', `
    CREATE TABLE "receipt_tolerance_rules" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "rule_no" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "source_type" TEXT NOT NULL DEFAULT 'all',
      "discrepancy_type" TEXT NOT NULL DEFAULT 'all',
      "counterparty_type" TEXT NOT NULL DEFAULT 'all',
      "counterparty_id" INTEGER,
      "product_name" TEXT,
      "quantity_tolerance_percent" REAL NOT NULL DEFAULT 0,
      "quantity_tolerance_abs" REAL NOT NULL DEFAULT 0,
      "action_within_tolerance" TEXT NOT NULL DEFAULT 'warn',
      "action_outside_tolerance" TEXT NOT NULL DEFAULT 'manual_review',
      "severity_within_tolerance" TEXT NOT NULL DEFAULT 'low',
      "severity_outside_tolerance" TEXT NOT NULL DEFAULT 'normal',
      "requires_quality_check" INTEGER NOT NULL DEFAULT 0,
      "status" TEXT NOT NULL DEFAULT 'active',
      "priority" INTEGER NOT NULL DEFAULT 100,
      "note" TEXT,
      "created_by" INTEGER,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "receipt_tolerance_rules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )
  `);
  await createIndexIfMissing(report, 'receipt_tolerance_rules_rule_no_key', 'CREATE UNIQUE INDEX "receipt_tolerance_rules_rule_no_key" ON "receipt_tolerance_rules"("rule_no")');
  await createIndexIfMissing(report, 'receipt_tolerance_rules_match_idx', 'CREATE INDEX "receipt_tolerance_rules_match_idx" ON "receipt_tolerance_rules"("source_type", "discrepancy_type", "counterparty_type", "counterparty_id", "product_name")');
  await createIndexIfMissing(report, 'receipt_tolerance_rules_status_idx', 'CREATE INDEX "receipt_tolerance_rules_status_idx" ON "receipt_tolerance_rules"("status")');
  await seedReceiptToleranceRuleIfMissing(report, {
    ruleNo: 'DTR-PURCHASE-DEFAULT',
    name: '采购收货默认差异规则',
    sourceType: 'purchase_receipt',
    discrepancyType: 'all',
    counterpartyType: 'supplier',
    actionWithinTolerance: 'warn',
    actionOutsideTolerance: 'manual_review',
    priority: 900,
    note: '默认不自动过账，采购差异进入人工评审。',
  });
  await seedReceiptToleranceRuleIfMissing(report, {
    ruleNo: 'DTR-PURCHASE-QUALITY',
    name: '采购质量拒收规则',
    sourceType: 'purchase_receipt',
    discrepancyType: 'quality_rejected',
    counterpartyType: 'supplier',
    actionWithinTolerance: 'manual_review',
    actionOutsideTolerance: 'manual_review',
    requiresQualityCheck: true,
    priority: 100,
    note: '质量拒收必须保留质检/隔离处理入口。',
  });
  await seedReceiptToleranceRuleIfMissing(report, {
    ruleNo: 'DTR-SHIPPING-DEFAULT',
    name: '发货签收默认差异规则',
    sourceType: 'shipment_receipt',
    discrepancyType: 'all',
    counterpartyType: 'customer',
    actionWithinTolerance: 'warn',
    actionOutsideTolerance: 'manual_review',
    priority: 900,
    note: '客户签收差异默认进入售后/补发评审。',
  });
  await seedReceiptToleranceRuleIfMissing(report, {
    ruleNo: 'DTR-SHIPPING-DAMAGED',
    name: '发货破损签收规则',
    sourceType: 'shipment_receipt',
    discrepancyType: 'customer_damaged',
    counterpartyType: 'customer',
    actionWithinTolerance: 'manual_review',
    actionOutsideTolerance: 'manual_review',
    requiresQualityCheck: true,
    priority: 100,
    note: '破损签收需要保留承运商索赔/RMA/补发判断。',
  });

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

  // ── 仓储扩展三表 ──────────────────────────────────────────────
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
      "quantity_delta" REAL NOT NULL,
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
  await addColumnIfMissing(report, 'stock_movements', 'quantity_delta', 'REAL NOT NULL');
  await addColumnIfMissing(report, 'stock_movements', 'quantity_after', 'REAL NOT NULL DEFAULT 0');
  await addColumnIfMissing(report, 'stock_movements', 'created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
  await createIndexIfMissing(report, 'stock_movements_entry_id_idx', 'CREATE INDEX "stock_movements_entry_id_idx" ON "stock_movements"("entry_id")');
  await createIndexIfMissing(report, 'stock_movements_stock_balance_id_idx', 'CREATE INDEX "stock_movements_stock_balance_id_idx" ON "stock_movements"("stock_balance_id")');
  await createIndexIfMissing(report, 'stock_movements_location_id_idx', 'CREATE INDEX "stock_movements_location_id_idx" ON "stock_movements"("location_id")');
  await createIndexIfMissing(report, 'stock_movements_product_name_idx', 'CREATE INDEX "stock_movements_product_name_idx" ON "stock_movements"("product_name")');
  await createIndexIfMissing(report, 'stock_movements_batch_no_idx', 'CREATE INDEX "stock_movements_batch_no_idx" ON "stock_movements"("batch_no")');

  await createTableIfMissing(report, 'auth_roles', `
    CREATE TABLE "auth_roles" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "code" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "description" TEXT,
      "is_system" INTEGER NOT NULL DEFAULT 0,
      "is_active" INTEGER NOT NULL DEFAULT 1,
      "data_scopes_json" TEXT,
      "created_by" INTEGER,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "auth_roles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )
  `);
  await addColumnIfMissing(report, 'auth_roles', 'code', 'TEXT');
  await addColumnIfMissing(report, 'auth_roles', 'name', 'TEXT');
  await addColumnIfMissing(report, 'auth_roles', 'description', 'TEXT');
  await addColumnIfMissing(report, 'auth_roles', 'is_system', 'INTEGER NOT NULL DEFAULT 0');
  await addColumnIfMissing(report, 'auth_roles', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
  await addColumnIfMissing(report, 'auth_roles', 'data_scopes_json', 'TEXT');
  await addColumnIfMissing(report, 'auth_roles', 'created_by', 'INTEGER');
  await addColumnIfMissing(report, 'auth_roles', 'created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
  await addColumnIfMissing(report, 'auth_roles', 'updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
  await createIndexIfMissing(report, 'auth_roles_code_key', 'CREATE UNIQUE INDEX "auth_roles_code_key" ON "auth_roles"("code")');
  await createIndexIfMissing(report, 'auth_roles_is_active_idx', 'CREATE INDEX "auth_roles_is_active_idx" ON "auth_roles"("is_active")');

  await createTableIfMissing(report, 'auth_permissions', `
    CREATE TABLE "auth_permissions" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "code" TEXT NOT NULL,
      "resource" TEXT NOT NULL,
      "action" TEXT NOT NULL,
      "label" TEXT NOT NULL,
      "description" TEXT,
      "group" TEXT,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await addColumnIfMissing(report, 'auth_permissions', 'code', 'TEXT');
  await addColumnIfMissing(report, 'auth_permissions', 'resource', 'TEXT');
  await addColumnIfMissing(report, 'auth_permissions', 'action', 'TEXT');
  await addColumnIfMissing(report, 'auth_permissions', 'label', 'TEXT');
  await addColumnIfMissing(report, 'auth_permissions', 'description', 'TEXT');
  await addColumnIfMissing(report, 'auth_permissions', 'group', 'TEXT');
  await addColumnIfMissing(report, 'auth_permissions', 'created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
  await createIndexIfMissing(report, 'auth_permissions_code_key', 'CREATE UNIQUE INDEX "auth_permissions_code_key" ON "auth_permissions"("code")');
  await createIndexIfMissing(report, 'auth_permissions_resource_idx', 'CREATE INDEX "auth_permissions_resource_idx" ON "auth_permissions"("resource")');
  await createIndexIfMissing(report, 'auth_permissions_group_idx', 'CREATE INDEX "auth_permissions_group_idx" ON "auth_permissions"("group")');

  await createTableIfMissing(report, 'auth_role_permissions', `
    CREATE TABLE "auth_role_permissions" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "role_code" TEXT NOT NULL,
      "permission_code" TEXT NOT NULL,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "auth_role_permissions_role_code_fkey" FOREIGN KEY ("role_code") REFERENCES "auth_roles" ("code") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "auth_role_permissions_permission_code_fkey" FOREIGN KEY ("permission_code") REFERENCES "auth_permissions" ("code") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await addColumnIfMissing(report, 'auth_role_permissions', 'role_code', 'TEXT');
  await addColumnIfMissing(report, 'auth_role_permissions', 'permission_code', 'TEXT');
  await addColumnIfMissing(report, 'auth_role_permissions', 'created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
  await createIndexIfMissing(report, 'auth_role_permissions_role_permission_key', 'CREATE UNIQUE INDEX "auth_role_permissions_role_permission_key" ON "auth_role_permissions"("role_code", "permission_code")');
  await createIndexIfMissing(report, 'auth_role_permissions_permission_code_idx', 'CREATE INDEX "auth_role_permissions_permission_code_idx" ON "auth_role_permissions"("permission_code")');

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

  return report;
};
