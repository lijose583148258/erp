import prisma from '../config/database';
import {
  addColumnIfMissing,
  createIndexIfMissing,
  createTableIfMissing,
  SchemaRepairReport,
} from './runtime-schema-repair-utils';

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

const createReceiptDiscrepancyActionUniqueIndexIfSafe = async (report: SchemaRepairReport) => {
  const duplicates = await prisma.$queryRawUnsafe<Array<{ count: unknown }>>(
    `SELECT COUNT(*) AS count
     FROM (
       SELECT case_id, action_type, COUNT(*) AS duplicate_count
       FROM receipt_discrepancy_actions
       WHERE status <> 'cancelled'
       GROUP BY case_id, action_type
       HAVING COUNT(*) > 1
       LIMIT 1
     ) duplicate_actions`,
  );

  if (Number(duplicates[0]?.count || 0) > 0) {
    report.entries.push({ kind: 'index', target: 'receipt_discrepancy_actions_case_type_active_key', action: 'skipped' });
    return;
  }

  await createIndexIfMissing(
    report,
    'receipt_discrepancy_actions_case_type_active_key',
    `CREATE UNIQUE INDEX "receipt_discrepancy_actions_case_type_active_key"
     ON "receipt_discrepancy_actions"("case_id", "action_type")
     WHERE "status" <> 'cancelled'`,
  );
};

export const repairReceiptSchema = async (report: SchemaRepairReport) => {
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
      "supplier_batch_no" TEXT,
      "batch_id" INTEGER,
      "stock_entry_ref" TEXT,
      "discrepancy_reason" TEXT,
      "note" TEXT,
      "received_by" INTEGER,
      "submission_key" TEXT,
      "submission_fingerprint" TEXT,
      "submission_json" TEXT,
      "payable_amount_native" DECIMAL,
      "payable_amount_base" DECIMAL,
      "payable_snapshot_json" TEXT,
      "incoming_quality_plan_json" TEXT,
      "received_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "purchase_receipts_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "purchase_receipts_received_by_fkey" FOREIGN KEY ("received_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "purchase_receipts_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "product_batches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);
  await addColumnIfMissing(report, 'purchase_receipts', 'submission_key', 'TEXT');
  await addColumnIfMissing(report, 'purchase_receipts', 'submission_fingerprint', 'TEXT');
  await addColumnIfMissing(report, 'purchase_receipts', 'submission_json', 'TEXT');
  await addColumnIfMissing(report, 'purchase_receipts', 'supplier_batch_no', 'TEXT');
  await addColumnIfMissing(report, 'purchase_receipts', 'batch_id', 'INTEGER REFERENCES "product_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE');
  const batchForeignKeys = await prisma.$queryRawUnsafe<Array<{ table: string; from: string; to: string; on_delete: string; on_update: string }>>(
    'PRAGMA foreign_key_list("purchase_receipts")',
  );
  if (!batchForeignKeys.some(key => key.from === 'batch_id' && key.table === 'product_batches'
    && key.to === 'id' && key.on_delete === 'RESTRICT' && key.on_update === 'CASCADE')) {
    // Do not rebuild a populated table or silently accept an incomplete manual upgrade.
    throw new Error('PURCHASE_RECEIPT_BATCH_FOREIGN_KEY_REQUIRED');
  }
  await addColumnIfMissing(report, 'purchase_receipts', 'payable_amount_native', 'DECIMAL');
  await addColumnIfMissing(report, 'purchase_receipts', 'payable_amount_base', 'DECIMAL');
  await addColumnIfMissing(report, 'purchase_receipts', 'payable_snapshot_json', 'TEXT');
  await addColumnIfMissing(report, 'purchase_receipts', 'incoming_quality_plan_json', 'TEXT');
  await createIndexIfMissing(report, 'purchase_receipts_receipt_no_key', 'CREATE UNIQUE INDEX "purchase_receipts_receipt_no_key" ON "purchase_receipts"("receipt_no")');
  await createIndexIfMissing(report, 'purchase_receipts_purchase_order_id_idx', 'CREATE INDEX "purchase_receipts_purchase_order_id_idx" ON "purchase_receipts"("purchase_order_id")');
  await createIndexIfMissing(report, 'purchase_receipts_stock_entry_ref_idx', 'CREATE INDEX "purchase_receipts_stock_entry_ref_idx" ON "purchase_receipts"("stock_entry_ref")');
  await createIndexIfMissing(report, 'purchase_receipts_purchase_order_id_submission_key_key', 'CREATE UNIQUE INDEX "purchase_receipts_purchase_order_id_submission_key_key" ON "purchase_receipts"("purchase_order_id", "submission_key")');
  await createIndexIfMissing(report, 'purchase_receipts_batch_id_key', 'CREATE UNIQUE INDEX "purchase_receipts_batch_id_key" ON "purchase_receipts"("batch_id")');

  await createTableIfMissing(report, 'incoming_quality_checks', `
    CREATE TABLE "incoming_quality_checks" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "check_no" TEXT NOT NULL,
      "purchase_receipt_id" INTEGER NOT NULL,
      "revision" INTEGER NOT NULL DEFAULT 1,
      "request_key" TEXT NOT NULL,
      "fingerprint" TEXT NOT NULL,
      "submission_json" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'submitted',
      "result" TEXT NOT NULL,
      "sample_no" TEXT,
      "measurements_json" TEXT NOT NULL,
      "note" TEXT,
      "inspector_user_id" INTEGER NOT NULL,
      "checked_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "reviewed_by_user_id" INTEGER,
      "reviewed_at" DATETIME,
      "review_note" TEXT,
      "decision" TEXT,
      "review_json" TEXT,
      CONSTRAINT "incoming_quality_checks_purchase_receipt_id_fkey" FOREIGN KEY ("purchase_receipt_id") REFERENCES "purchase_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT "incoming_quality_checks_inspector_user_id_fkey" FOREIGN KEY ("inspector_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT "incoming_quality_checks_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);
  await createIndexIfMissing(report, 'incoming_quality_checks_check_no_key', 'CREATE UNIQUE INDEX "incoming_quality_checks_check_no_key" ON "incoming_quality_checks"("check_no")');
  await createIndexIfMissing(report, 'incoming_quality_checks_purchase_receipt_id_revision_key', 'CREATE UNIQUE INDEX "incoming_quality_checks_purchase_receipt_id_revision_key" ON "incoming_quality_checks"("purchase_receipt_id", "revision")');
  await createIndexIfMissing(report, 'incoming_quality_checks_purchase_receipt_id_request_key_key', 'CREATE UNIQUE INDEX "incoming_quality_checks_purchase_receipt_id_request_key_key" ON "incoming_quality_checks"("purchase_receipt_id", "request_key")');
  await createIndexIfMissing(report, 'incoming_quality_checks_status_idx', 'CREATE INDEX "incoming_quality_checks_status_idx" ON "incoming_quality_checks"("status")');

  await createTableIfMissing(report, 'supplier_payments', `
    CREATE TABLE "supplier_payments" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "payment_no" TEXT NOT NULL,
      "purchase_receipt_id" INTEGER NOT NULL,
      "amount_native" DECIMAL NOT NULL,
      "currency" TEXT NOT NULL,
      "base_amount" DECIMAL NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'draft',
      "request_key" TEXT NOT NULL,
      "fingerprint" TEXT NOT NULL,
      "submission_json" TEXT NOT NULL,
      "method" TEXT NOT NULL,
      "date" DATETIME NOT NULL,
      "payment_account_ref" TEXT NOT NULL,
      "external_transaction_ref" TEXT NOT NULL,
      "evidence_ref" TEXT NOT NULL,
      "note" TEXT,
      "submitted_by_user_id" INTEGER NOT NULL,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "verified_by_user_id" INTEGER,
      "verified_at" DATETIME,
      "verification_json" TEXT,
      CONSTRAINT "supplier_payments_purchase_receipt_id_fkey" FOREIGN KEY ("purchase_receipt_id") REFERENCES "purchase_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT "supplier_payments_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT "supplier_payments_verified_by_user_id_fkey" FOREIGN KEY ("verified_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `);
  await createIndexIfMissing(report, 'supplier_payments_payment_no_key', 'CREATE UNIQUE INDEX "supplier_payments_payment_no_key" ON "supplier_payments"("payment_no")');
  await createIndexIfMissing(report, 'supplier_payments_purchase_receipt_id_request_key_key', 'CREATE UNIQUE INDEX "supplier_payments_purchase_receipt_id_request_key_key" ON "supplier_payments"("purchase_receipt_id", "request_key")');
  await createIndexIfMissing(report, 'supplier_payments_account_transaction_idx', 'CREATE INDEX "supplier_payments_account_transaction_idx" ON "supplier_payments"("payment_account_ref", "external_transaction_ref")');
  await createIndexIfMissing(report, 'supplier_payments_account_transaction_key', 'CREATE UNIQUE INDEX "supplier_payments_account_transaction_key" ON "supplier_payments"("payment_account_ref", "external_transaction_ref") WHERE "status" <> \'cancelled\'');
  await createIndexIfMissing(report, 'supplier_payments_status_idx', 'CREATE INDEX "supplier_payments_status_idx" ON "supplier_payments"("status")');
  const activeReferenceIndex = await prisma.$queryRawUnsafe<Array<{ sql: string }>>(
    'SELECT sql FROM sqlite_master WHERE type = ? AND name = ?', 'index', 'supplier_payments_account_transaction_key',
  );
  const expectedReferenceIndex = 'CREATE UNIQUE INDEX "supplier_payments_account_transaction_key" ON "supplier_payments"("payment_account_ref", "external_transaction_ref") WHERE "status" <> \'cancelled\'';
  if (activeReferenceIndex[0]?.sql?.trim().replace(/\s+/g, ' ').toLowerCase() !== expectedReferenceIndex.toLowerCase()) {
    throw new Error('SUPPLIER_PAYMENT_ACTIVE_REFERENCE_INDEX_REQUIRED');
  }
  for (const [table, actorColumns] of [
    ['incoming_quality_checks', ['inspector_user_id', 'reviewed_by_user_id']],
    ['supplier_payments', ['submitted_by_user_id', 'verified_by_user_id']],
  ] as const) {
    const keys = await prisma.$queryRawUnsafe<Array<{ table: string; from: string; to: string; on_delete: string; on_update: string }>>(`PRAGMA foreign_key_list("${table}")`);
    for (const [column, parent] of [['purchase_receipt_id', 'purchase_receipts'], ...actorColumns.map(column => [column, 'users'])]) {
      if (!keys.some(key => key.from === column && key.table === parent && key.to === 'id'
        && key.on_delete === 'RESTRICT' && key.on_update === 'CASCADE')) {
        throw new Error(`PURCHASE_QUALITY_PAYABLE_FOREIGN_KEY_REQUIRED:${table}.${column}`);
      }
    }
  }

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
  await createReceiptDiscrepancyActionUniqueIndexIfSafe(report);

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
};
