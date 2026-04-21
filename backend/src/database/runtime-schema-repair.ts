import prisma from '../config/database';
import {
  addColumnIfMissing,
  createIndexIfMissing,
  createTableIfMissing,
  dropIndexIfExists,
  SchemaRepairReport,
} from './runtime-schema-repair-utils';
import { repairAuthSchema } from './runtime-schema-auth-repair';
import { repairStockSchema } from './runtime-schema-stock-repair';

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

  await repairStockSchema(report);

  await repairAuthSchema(report);

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
