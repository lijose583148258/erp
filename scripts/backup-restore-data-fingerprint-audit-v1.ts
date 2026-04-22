import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { PrismaClient as PrismaClientType } from '@prisma/client';
import { createRequire } from 'module';

const ROOT = process.cwd();
const requireFromScript = createRequire(import.meta.url);
const requireFromBackend = createRequire(path.join(ROOT, 'backend', 'src', 'config', 'database.ts'));
const { PrismaClient: PrismaClientCtor } = requireFromBackend('@prisma/client') as {
  PrismaClient: typeof import('@prisma/client').PrismaClient;
};
const { getBackupDir, getSqliteDbPath } = requireFromScript('../backend/src/config/runtime.ts') as {
  getBackupDir: () => string;
  getSqliteDbPath: () => string | null;
};

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/+$/, '/');
const REQUEST_TIMEOUT_MS = Number(process.env.AUDIT_REQUEST_TIMEOUT_MS || 10000);
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'backup-restore-data-fingerprint-audit-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'backup-restore-data-fingerprint-audit-v1.md');
const TOLERANCE = 0.000001;

type MetricSpec = {
  table: string;
  sums?: string[];
};

type FingerprintMetric = {
  table: string;
  count: number;
  sums: Record<string, number>;
};

type Fingerprint = {
  source: string;
  tableCount: number;
  metrics: FingerprintMetric[];
  hash: string;
};

type ApiResponse = {
  ok: boolean;
  status: number;
  json: any;
};

const METRICS: MetricSpec[] = [
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
  { table: 'suppliers', sums: ['rating', 'lead_time_days'] },
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

const uniqueMetrics = Array.from(new Map(METRICS.map(item => [item.table, item])).values());

const normalizeNumber = (value: unknown) => {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Number(numeric.toFixed(6));
};

const quoteIdent = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

const fileUrl = (filePath: string) => `file:${path.resolve(filePath).replace(/\\/g, '/')}`;

async function apiFetch(endpoint: string, options: { method?: string; data?: unknown } = {}, token = ''): Promise<ApiResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${APP_URL}api${endpoint}`, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.data ? JSON.stringify(options.data) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { ok: response.ok, status: response.status, json };
  } finally {
    clearTimeout(timer);
  }
}

async function login() {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    data: { username: 'admin', password: 'admin123' },
  });

  if (!response.ok) {
    throw new Error(`Login failed: HTTP ${response.status}`);
  }

  const token = response.json?.data?.token;
  if (!token) {
    throw new Error('Login response does not include a token');
  }
  return token as string;
}

async function listTables(client: PrismaClientType) {
  const rows = await client.$queryRawUnsafe<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  return new Set(rows.map(row => row.name));
}

async function collectFingerprint(client: PrismaClientType, source: string): Promise<Fingerprint> {
  const tableNames = await listTables(client);
  const metrics: FingerprintMetric[] = [];

  for (const spec of uniqueMetrics) {
    if (!tableNames.has(spec.table)) {
      throw new Error(`Fingerprint source ${source} is missing table: ${spec.table}`);
    }

    const sumExpressions = (spec.sums || [])
      .map(column => `COALESCE(SUM(${quoteIdent(column)}), 0) AS ${quoteIdent(`sum__${column}`)}`);
    const selectList = [
      'COUNT(*) AS "count"',
      ...sumExpressions,
    ];
    const query = `SELECT ${selectList.join(', ')} FROM ${quoteIdent(spec.table)}`;
    const [row] = await client.$queryRawUnsafe<Array<Record<string, unknown>>>(query);
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

function compareFingerprints(expected: Fingerprint, actual: Fingerprint) {
  const mismatches: Array<Record<string, unknown>> = [];
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
      if (Math.abs(expectedValue - actualValue) > TOLERANCE) {
        mismatches.push({ table: expectedMetric.table, field, expected: expectedValue, actual: actualValue });
      }
    }
  }

  return mismatches;
}

async function withPrisma<T>(databasePath: string, action: (client: PrismaClientType) => Promise<T>) {
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

async function createBackup(token: string) {
  const response = await apiFetch('/system/backups', { method: 'POST' }, token);
  if (!response.ok) {
    throw new Error(`Create backup failed: HTTP ${response.status}`);
  }
  const fileName = response.json?.data?.fileName;
  if (!fileName) {
    throw new Error('Create backup response does not include fileName');
  }
  return String(fileName);
}

async function restoreBackup(token: string, fileName: string) {
  const response = await apiFetch('/system/restore', {
    method: 'POST',
    data: { fileName },
  }, token);
  if (!response.ok) {
    throw new Error(`Restore backup failed: HTTP ${response.status} ${response.json?.message || ''}`);
  }
  const integrity = response.json?.data?.integrity;
  if (!integrity?.manifestExists || !integrity?.verified) {
    throw new Error(`Restore did not verify backup manifest: ${fileName}`);
  }
  return integrity;
}

function writeReports(report: Record<string, unknown>) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const summary = report.summary as Record<string, unknown>;
  const md = [
    '# Backup Restore Data Fingerprint Audit v1',
    '',
    `- status: ${report.status}`,
    `- generated: ${report.generatedAt}`,
    `- app url: ${APP_URL}`,
    `- runtime db: ${report.runtimeDbPath}`,
    `- backup: ${report.backupFileName}`,
    `- compared tables: ${summary.comparedTables}`,
    `- mismatches: ${summary.mismatches}`,
    `- backup hash: ${summary.backupHash}`,
    `- restored hash: ${summary.restoredHash}`,
    '',
    '## Mismatches',
  ];

  const mismatches = report.mismatches as Array<Record<string, unknown>>;
  if (mismatches.length === 0) md.push('- none');
  for (const mismatch of mismatches) {
    md.push(`- ${JSON.stringify(mismatch)}`);
  }

  fs.writeFileSync(MD_REPORT, `${md.join('\n')}\n`, 'utf8');
}

async function main() {
  const generatedAt = new Date().toISOString();
  const runtimeDbPath = getSqliteDbPath();
  if (!runtimeDbPath || !fs.existsSync(runtimeDbPath)) {
    throw new Error(`Runtime SQLite database is not available: ${runtimeDbPath || 'not configured'}`);
  }

  const token = await login();
  const backupFileName = await createBackup(token);
  const backupPath = path.join(getBackupDir(), backupFileName);
  if (!fs.existsSync(backupPath)) {
    throw new Error(`Created backup file was not found: ${backupPath}`);
  }

  const backupFingerprint = await withPrisma(backupPath, client => collectFingerprint(client, 'backup-file'));
  const restoreIntegrity = await restoreBackup(token, backupFileName);
  const restoredFingerprint = await withPrisma(runtimeDbPath, client => collectFingerprint(client, 'restored-runtime'));
  const mismatches = compareFingerprints(backupFingerprint, restoredFingerprint);

  const report = {
    name: 'Backup Restore Data Fingerprint Audit',
    version: '1.0',
    generatedAt,
    status: mismatches.length === 0 ? 'passed' : 'failed',
    appUrl: APP_URL,
    runtimeDbPath: path.resolve(runtimeDbPath).replace(/\\/g, '/'),
    backupFileName,
    backupPath: path.resolve(backupPath).replace(/\\/g, '/'),
    summary: {
      comparedTables: backupFingerprint.tableCount,
      mismatches: mismatches.length,
      backupHash: backupFingerprint.hash,
      restoredHash: restoredFingerprint.hash,
      manifestVerified: Boolean(restoreIntegrity?.verified),
    },
    mismatches,
    backupFingerprint,
    restoredFingerprint,
    reports: {
      json: JSON_REPORT,
      markdown: MD_REPORT,
    },
  };

  writeReports(report);
  console.log(JSON.stringify({
    status: report.status,
    backupFileName,
    summary: report.summary,
    jsonReport: JSON_REPORT,
    markdownReport: MD_REPORT,
  }, null, 2));

  if (mismatches.length > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
