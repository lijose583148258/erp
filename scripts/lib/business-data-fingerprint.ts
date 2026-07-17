import crypto from 'crypto';
import path from 'path';
import type { PrismaClient as PrismaClientType } from '@prisma/client';
import { createRequire } from 'module';

const ROOT = process.cwd();
const requireFromBackend = createRequire(path.join(ROOT, 'backend', 'src', 'config', 'database.ts'));
const { PrismaClient: PrismaClientCtor } = requireFromBackend('@prisma/client') as {
  PrismaClient: typeof import('@prisma/client').PrismaClient;
};

export type BusinessFingerprintMetricSpec = {
  table: string;
  sums?: string[];
};

export type BusinessFingerprintMetric = {
  table: string;
  count: number;
  sums: Record<string, number>;
};

export type BusinessDataFingerprint = {
  source: string;
  tableCount: number;
  metrics: BusinessFingerprintMetric[];
  hash: string;
};

export type BusinessFingerprintMismatch = {
  table: string;
  field: string;
  expected: number | string;
  actual: number | string;
};

export const BUSINESS_FINGERPRINT_TOLERANCE = 0.000001;

export const businessFingerprintMetricSpecs: BusinessFingerprintMetricSpec[] = [
  { table: 'users' },
  { table: 'auth_roles' },
  { table: 'auth_permissions' },
  { table: 'auth_role_permissions' },
  { table: 'customers', sums: ['credit_limit', 'overdue_amount'] },
  { table: 'suppliers', sums: ['rating', 'lead_time_days'] },
  { table: 'orders', sums: ['total_amount', 'discount_amount', 'final_amount', 'paid_amount', 'receivable_adjustment_amount'] },
  { table: 'order_items', sums: ['quantity', 'unit_price', 'total_price'] },
  { table: 'payment_records', sums: ['amount', 'exchange_rate', 'base_amount'] },
  { table: 'collection_promises', sums: ['promised_amount'] },
  { table: 'collection_disputes', sums: ['disputed_amount'] },
  { table: 'contracts', sums: ['total_amount'] },
  { table: 'contract_milestones', sums: ['percentage', 'amount'] },
  { table: 'purchase_orders', sums: ['quantity', 'price', 'tax_amount', 'freight_cost', 'duty_cost', 'insurance_cost', 'other_cost', 'landed_cost_amount', 'landed_unit_cost'] },
  { table: 'samples', sums: ['quantity'] },
  { table: 'shipments', sums: ['quantity', 'temperature'] },
  { table: 'rmas', sums: ['quantity', 'refund_amount'] },
  { table: 'receipt_discrepancy_cases', sums: ['quantity', 'tolerance_percent', 'tolerance_quantity', 'variance_rate'] },
  { table: 'receipt_discrepancy_actions', sums: ['quantity', 'amount'] },
  { table: 'receipt_tolerance_rules', sums: ['quantity_tolerance_percent', 'quantity_tolerance_abs', 'priority'] },
  { table: 'product_batches', sums: ['stock_quantity'] },
  { table: 'inventory_cost_ledgers', sums: ['quantity_before', 'quantity_delta', 'quantity_after', 'cost_before', 'cost_amount_delta', 'cost_after', 'unit_cost'] },
  { table: 'asset_balances', sums: ['balance'] },
  { table: 'asset_transactions', sums: ['quantity'] },
  { table: 'warehouses' },
  { table: 'locations' },
  { table: 'stock_balances', sums: ['quantity'] },
  { table: 'stock_entries' },
  { table: 'stock_movements', sums: ['quantity_before', 'quantity_delta', 'quantity_after'] },
  { table: 'production_boms', sums: ['standard_batch_size', 'density', 'solid_content'] },
  { table: 'production_bom_items', sums: ['percentage', 'quantity_per_unit', 'loss_rate', 'allowed_variance_rate', 'yield_contribution'] },
  { table: 'production_work_orders', sums: ['target_quantity', 'produced_quantity', 'loss_quantity'] },
  { table: 'production_process_steps' },
  { table: 'production_quality_checks', sums: ['defect_rate'] },
  { table: 'barter_agreements', sums: ['total_party_a_value', 'total_party_b_value', 'agreed_offset_amount', 'executed_offset_amount', 'remaining_offset_amount', 'completion_ratio'] },
  { table: 'barter_agreement_items', sums: ['quantity', 'unit_price', 'quality_factor', 'loss_factor', 'market_value'] },
  { table: 'barter_settlements', sums: ['total_party_a_value', 'total_party_b_value', 'cash_difference'] },
  { table: 'barter_items', sums: ['quantity', 'unit_price', 'quality_factor', 'loss_factor', 'market_value'] },
  { table: 'barter_valuation_snapshots', sums: ['reference_price'] },
  { table: 'barter_offset_postings', sums: ['offset_amount'] },
  { table: 'barter_reversal_logs' },
  { table: 'adjustment_records', sums: ['quantity_delta', 'amount_delta'] },
  { table: 'receivable_adjustments', sums: ['amount', 'exchange_rate', 'base_amount'] },
];

const normalizeNumber = (value: unknown) => {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Number(numeric.toFixed(6));
};

const quoteIdent = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

export const normalizeDatabasePath = (filePath: string) => path.resolve(filePath).replace(/\\/g, '/');

const fileUrl = (filePath: string) => `file:${normalizeDatabasePath(filePath)}`;

async function listTables(client: PrismaClientType) {
  const rows = (await client.$queryRawUnsafe(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )) as Array<{ name: string }>;
  return new Set(rows.map(row => row.name));
}

export async function collectBusinessDataFingerprint(
  client: PrismaClientType,
  source: string,
): Promise<BusinessDataFingerprint> {
  const tableNames = await listTables(client);
  const metrics: BusinessFingerprintMetric[] = [];

  for (const spec of businessFingerprintMetricSpecs) {
    if (!tableNames.has(spec.table)) {
      throw new Error(`Fingerprint source ${source} is missing table: ${spec.table}`);
    }

    const sumExpressions = (spec.sums || [])
      .map(column => `COALESCE(SUM(${quoteIdent(column)}), 0) AS ${quoteIdent(`sum__${column}`)}`);
    const query = `SELECT ${['COUNT(*) AS "count"', ...sumExpressions].join(', ')} FROM ${quoteIdent(spec.table)}`;
    const [row] = (await client.$queryRawUnsafe(query)) as Array<Record<string, unknown>>;
    const sums: Record<string, number> = {};

    for (const column of spec.sums || []) {
      sums[column] = normalizeNumber(row?.[`sum__${column}`]);
    }

    metrics.push({
      table: spec.table,
      count: Number(row?.count || 0),
      sums,
    });
  }

  const canonical = JSON.stringify(metrics);
  return {
    source,
    tableCount: metrics.length,
    metrics,
    hash: crypto.createHash('sha256').update(canonical).digest('hex'),
  };
}

export function compareBusinessDataFingerprints(
  expected: BusinessDataFingerprint,
  actual: BusinessDataFingerprint,
) {
  const mismatches: BusinessFingerprintMismatch[] = [];
  const actualByTable = new Map(actual.metrics.map(item => [item.table, item]));

  for (const expectedMetric of expected.metrics) {
    const actualMetric = actualByTable.get(expectedMetric.table);
    if (!actualMetric) {
      mismatches.push({ table: expectedMetric.table, field: 'table', expected: 'present', actual: 'missing' });
      continue;
    }

    if (expectedMetric.count !== actualMetric.count) {
      mismatches.push({ table: expectedMetric.table, field: 'count', expected: expectedMetric.count, actual: actualMetric.count });
    }

    for (const [field, expectedValue] of Object.entries(expectedMetric.sums)) {
      const actualValue = actualMetric.sums[field] ?? 0;
      if (Math.abs(expectedValue - actualValue) > BUSINESS_FINGERPRINT_TOLERANCE) {
        mismatches.push({ table: expectedMetric.table, field, expected: expectedValue, actual: actualValue });
      }
    }
  }

  return mismatches;
}

export async function withFingerprintPrisma<T>(
  databasePath: string,
  action: (client: PrismaClientType) => Promise<T>,
) {
  const client = new PrismaClientCtor({
    datasources: {
      db: {
        url: fileUrl(databasePath),
      },
    },
  });

  try {
    return await action(client);
  } finally {
    await client.$disconnect();
  }
}
