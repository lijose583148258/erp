import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getBackupDir } from '../config/runtime';

export type SnapshotTable = {
  name: string;
  rowCount: number;
  rows: Record<string, unknown>[];
};

export type SnapshotReport = {
  snapshotFileName: string;
  snapshotPath: string;
  checksumSha256: string;
  tableCount: number;
  totalRowCount: number;
  tableSummary: Array<{ name: string; rowCount: number }>;
  criticalTables?: Array<{ name: string; present: boolean; rowCount: number | null }>;
};

export type ManifestPhase = {
  phase: string;
  rationale: string;
  tableCount: number;
  rowCount: number;
  tables: Array<{ name: string; rowCount: number }>;
};

export type ManifestReport = {
  snapshot: {
    fileName: string;
    path: string;
    checksumSha256: string;
    tableCount: number;
    totalRowCount: number;
  };
  criticalTables?: Array<{ name: string; present: boolean; rowCount: number | null }>;
  phases: ManifestPhase[];
  deferredTables?: Array<{ name: string; rowCount: number }>;
};

export const CRITICAL_TABLE_NAMES = [
  'users',
  'customers',
  'orders',
  'order_items',
  'payment_records',
  'product_batches',
  'inventory_cost_ledgers',
  'stock_balances',
  'stock_entries',
  'stock_movements',
  'purchase_orders',
  'shipments',
];

export const IMPORT_PHASES: Array<{ phase: string; tables: string[]; rationale: string }> = [
  {
    phase: 'foundation',
    tables: ['users', 'auth_permissions', 'auth_roles', 'auth_role_permissions', 'auth_policy_migrations'],
    rationale: 'Identity, permissions, and role graph should load first because many business tables reference users or permission-owned flows.',
  },
  {
    phase: 'master-data',
    tables: ['customers', 'suppliers', 'warehouses', 'locations', 'product_batches', 'contracts'],
    rationale: 'Customer, supplier, warehouse, location, batch, and contract records anchor downstream order, stock, and logistics data.',
  },
  {
    phase: 'commercial-transactions',
    tables: ['orders', 'order_items', 'payment_records', 'purchase_orders', 'purchase_receipts'],
    rationale: 'Sales and procurement transactions depend on master data and feed inventory, finance, and logistics timelines.',
  },
  {
    phase: 'inventory-ledger',
    tables: ['stock_balances', 'stock_entries', 'stock_movements', 'inventory_cost_ledgers'],
    rationale: 'Inventory and cost ledgers must load in a stable order so quantity and cost audit trails can be reconciled after import.',
  },
  {
    phase: 'operations',
    tables: ['shipments', 'shipment_receipts', 'receivable_adjustments', 'adjustment_records', 'production_work_orders'],
    rationale: 'Operational workflow records sit on top of commercial and inventory state and are smoked after foundational import completes.',
  },
];

const snapshotDir = () => path.join(getBackupDir(), 'postgres-migration');
const auditDir = () => path.join(process.cwd(), 'output', 'audit');

export const ensureSnapshotDir = () => {
  const dir = snapshotDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

const ensureAuditDir = () => {
  const dir = auditDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

export const timestampStamp = () => new Date().toISOString().replace(/[:.]/g, '-');

export const escapeIdentifier = (value: string) => value.replace(/"/g, '""');

export const hashFile = (filePath: string) => {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
};

export const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;

export const writeAuditReport = (baseName: string, report: Record<string, unknown>, mdLines: string[]) => {
  const outputDir = ensureAuditDir();
  const jsonPath = path.join(outputDir, `${baseName}.json`);
  const markdownPath = path.join(outputDir, `${baseName}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(markdownPath, `${mdLines.join('\n')}\n`, 'utf8');
  return { jsonPath, markdownPath };
};

export const buildTableRowCountMap = (tableSummary: Array<{ name: string; rowCount: number }>) => new Map(
  tableSummary.map((table) => [table.name, table.rowCount]),
);

export const readSnapshotReport = () => {
  const snapshotReportPath = path.join(auditDir(), 'postgres-migration-snapshot-v1.json');
  if (!fs.existsSync(snapshotReportPath)) {
    throw new Error('Snapshot report not found. Run "npm run db:pg -- snapshot" before continuing.');
  }
  return JSON.parse(fs.readFileSync(snapshotReportPath, 'utf8')) as SnapshotReport;
};

export const readManifestReport = () => {
  const manifestReportPath = path.join(auditDir(), 'postgres-migration-import-manifest-v1.json');
  if (!fs.existsSync(manifestReportPath)) {
    throw new Error('Import manifest report not found. Run "npm run db:pg -- manifest" before continuing.');
  }
  return JSON.parse(fs.readFileSync(manifestReportPath, 'utf8')) as ManifestReport;
};

export const readSnapshotPayload = (snapshotPath: string) => {
  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`Snapshot file does not exist: ${snapshotPath}`);
  }
  return JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) as {
    createdAt?: string;
    tables?: SnapshotTable[];
  };
};
