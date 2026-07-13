import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import type { PrismaClient } from '@prisma/client';

const requireFromScript = createRequire(import.meta.url);
const prisma = requireFromScript('../backend/src/config/database.ts').default as PrismaClient;
const { getSqliteDbPath } = requireFromScript('../backend/src/config/runtime.ts') as {
  getSqliteDbPath: () => string | null;
};

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const INVENTORY_JSON = path.join(OUTPUT_DIR, 'test-data-retention-inventory-audit-v1.json');
const JSON_REPORT = path.join(OUTPUT_DIR, 'test-data-retention-dependency-graph-audit-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'test-data-retention-dependency-graph-audit-v1.md');

type InventoryTableSummary = {
  table: string;
  totalRows: number;
  candidateColumnHits: number;
  markers: string[];
  risk: 'P0-never-delete-directly' | 'P1-backup-and-whitelist-required' | 'P2-report-only-review';
};

type ForeignKeyRow = {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
  match: string;
};

type TableRow = { name: string };

type DependencyEdge = {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  onUpdate: string;
  onDelete: string;
  candidateSide: 'parent' | 'child' | 'both';
};

type InventoryReport = {
  status: string;
  mode?: string;
  generatedAt?: string;
  sqlitePath: string | null;
  tableSummaries: InventoryTableSummary[];
};

const CRITICAL_LEDGER_TABLES = new Set([
  'audit_logs',
  'stock_movements',
  'inventory_cost_ledgers',
  'stock_balances',
  'stock_entries',
  'product_batches',
  'production_work_orders',
  'production_boms',
  'production_bom_items',
  'orders',
  'payment_records',
  'customers',
]);

const CRITICAL_GOVERNANCE_TABLES = new Set([
  'auth_roles',
  'auth_role_permissions',
  'auth_user_roles',
  'auth_permissions',
  'users',
]);

const ABSOLUTE_NO_DIRECT_DELETE = new Set([
  'audit_logs',
  'stock_movements',
  'inventory_cost_ledgers',
  'stock_balances',
  'stock_entries',
]);

function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function normalizePath(filePath: string | null) {
  return filePath ? path.resolve(filePath).replace(/\\/g, '/') : null;
}

async function getTables() {
  const rows = (await prisma.$queryRawUnsafe(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )) as TableRow[];
  return rows.map(row => row.name).filter(name => name !== '_prisma_migrations');
}

async function getForeignKeys(table: string) {
  return (await prisma.$queryRawUnsafe(`PRAGMA foreign_key_list(${quoteIdentifier(table)})`)) as ForeignKeyRow[];
}

function loadInventory() {
  if (!fs.existsSync(INVENTORY_JSON)) {
    throw new Error(`Missing inventory report. Run npm run audit:test-data:inventory first: ${INVENTORY_JSON}`);
  }
  return JSON.parse(fs.readFileSync(INVENTORY_JSON, 'utf8')) as InventoryReport;
}

function assertInventoryMatchesRuntime(inventory: InventoryReport, sqlitePath: string | null) {
  if (inventory.status !== 'passed') {
    throw new Error(`Inventory report is not passed. Run npm run audit:test-data:inventory first: ${INVENTORY_JSON}`);
  }

  if (!Array.isArray(inventory.tableSummaries)) {
    throw new Error(`Inventory report is invalid. tableSummaries is missing: ${INVENTORY_JSON}`);
  }

  const inventorySqlitePath = normalizePath(inventory.sqlitePath);
  if (!sqlitePath || inventorySqlitePath !== sqlitePath) {
    throw new Error(`Inventory report DB mismatch. inventory=${inventorySqlitePath || 'not configured'} runtime=${sqlitePath || 'not configured'}`);
  }

  const generatedAtMs = Date.parse(inventory.generatedAt || '');
  const maxAgeMs = 10 * 60 * 1000;
  if (!Number.isFinite(generatedAtMs) || Date.now() - generatedAtMs > maxAgeMs) {
    throw new Error('Inventory report is stale. Run npm run audit:test-data:inventory immediately before dependency graph audit.');
  }
}

function classifyTable(summary: InventoryTableSummary, inbound: DependencyEdge[], outbound: DependencyEdge[]) {
  if (ABSOLUTE_NO_DIRECT_DELETE.has(summary.table) || summary.risk === 'P0-never-delete-directly') {
    return {
      action: 'retain-only',
      reason: 'Audit, stock, cost, or restart evidence table. Keep evidence; do not delete directly.',
    };
  }

  const touchesCritical = CRITICAL_LEDGER_TABLES.has(summary.table)
    || CRITICAL_GOVERNANCE_TABLES.has(summary.table)
    || inbound.some(edge => CRITICAL_LEDGER_TABLES.has(edge.fromTable))
    || outbound.some(edge => CRITICAL_LEDGER_TABLES.has(edge.toTable))
    || inbound.some(edge => CRITICAL_GOVERNANCE_TABLES.has(edge.fromTable))
    || outbound.some(edge => CRITICAL_GOVERNANCE_TABLES.has(edge.toTable));

  if (touchesCritical) {
    return {
      action: 'manual-whitelist-plus-reconcile',
      reason: 'Touches business ledger, stock, cost, order, payment, production, customer, user, or authorization dependencies.',
    };
  }

  if (summary.risk === 'P1-backup-and-whitelist-required') {
    return {
      action: 'manual-whitelist-required',
      reason: 'Candidate test data must be exported to whitelist and reviewed before any cleanup.',
    };
  }

  return {
    action: 'report-only-review',
    reason: 'Low-priority candidate; keep report-only until a reviewed whitelist exists.',
  };
}

function buildMarkdown(report: any) {
  const lines = [
    '# Test Data Retention Dependency Graph Audit v1',
    '',
    `- status: ${report.status}`,
    `- mode: ${report.mode}`,
    `- sqlite path: ${report.sqlitePath || 'not configured'}`,
    `- candidate tables: ${report.summary.candidateTables}`,
    `- dependency edges touching candidates: ${report.summary.candidateDependencyEdges}`,
    `- destructive actions performed: ${report.summary.destructiveActionsPerformed}`,
    '',
    '## Cleanup Plan',
    '',
    '| table | risk | candidate hits | inbound | outbound | action |',
    '| --- | --- | ---: | ---: | ---: | --- |',
  ];

  for (const table of report.tablePlans) {
    lines.push(`| ${table.table} | ${table.risk} | ${table.candidateColumnHits} | ${table.inboundEdges} | ${table.outboundEdges} | ${table.action} |`);
  }

  lines.push('', '## High-Risk Dependency Edges', '');
  const highRiskEdges = report.dependencyEdges.filter((edge: DependencyEdge) => (
    CRITICAL_LEDGER_TABLES.has(edge.fromTable) || CRITICAL_LEDGER_TABLES.has(edge.toTable)
  ));
  if (highRiskEdges.length === 0) {
    lines.push('- none');
  } else {
    for (const edge of highRiskEdges.slice(0, 80)) {
      lines.push(`- ${edge.fromTable}.${edge.fromColumn} -> ${edge.toTable}.${edge.toColumn} (${edge.candidateSide}, onDelete=${edge.onDelete})`);
    }
  }

  lines.push('', '## Decision', '');
  lines.push('- This audit only generates a dependency graph. It does not approve cleanup.');
  lines.push('- cleanupApproved is false. No destructive database action was performed.');
  lines.push('- P0, ledger, stock, cost, audit, user, and authorization tables must be retained or manually archived.');
  lines.push('- Before real cleanup: export candidate-row whitelist, back up stable.db, capture business fingerprints, clean only approved rows, and rerun Phase3.');
  return `${lines.join('\n')}\n`;
}

async function run() {
  const inventory = loadInventory();
  const sqlitePath = normalizePath(getSqliteDbPath());
  assertInventoryMatchesRuntime(inventory, sqlitePath);
  const tables = await getTables();
  const candidateSummaries = inventory.tableSummaries || [];
  const candidateTables = new Set(candidateSummaries.map(item => item.table));

  const dependencyEdges: DependencyEdge[] = [];
  for (const table of tables) {
    const foreignKeys = await getForeignKeys(table);
    for (const fk of foreignKeys) {
      if (!candidateTables.has(table) && !candidateTables.has(fk.table)) continue;
      dependencyEdges.push({
        fromTable: table,
        fromColumn: fk.from,
        toTable: fk.table,
        toColumn: fk.to,
        onUpdate: fk.on_update,
        onDelete: fk.on_delete,
        candidateSide: candidateTables.has(table) && candidateTables.has(fk.table)
          ? 'both'
          : candidateTables.has(table)
            ? 'child'
            : 'parent',
      });
    }
  }

  const tablePlans = candidateSummaries.map(summary => {
    const inbound = dependencyEdges.filter(edge => edge.toTable === summary.table);
    const outbound = dependencyEdges.filter(edge => edge.fromTable === summary.table);
    const classification = classifyTable(summary, inbound, outbound);
    return {
      table: summary.table,
      totalRows: summary.totalRows,
      candidateColumnHits: summary.candidateColumnHits,
      markers: summary.markers,
      risk: summary.risk,
      inboundEdges: inbound.length,
      outboundEdges: outbound.length,
      inboundFrom: Array.from(new Set(inbound.map(edge => edge.fromTable))).sort(),
      outboundTo: Array.from(new Set(outbound.map(edge => edge.toTable))).sort(),
      ...classification,
    };
  }).sort((a, b) => {
    const rank = (action: string) => (
      action === 'retain-only' ? 0
        : action === 'manual-whitelist-plus-reconcile' ? 1
          : action === 'manual-whitelist-required' ? 2
            : 3
    );
    return rank(a.action) - rank(b.action) || b.candidateColumnHits - a.candidateColumnHits || a.table.localeCompare(b.table);
  });

  const report = {
    name: 'test-data-retention-dependency-graph-audit-v1',
    status: 'passed',
    mode: 'report-only',
    auditVerdict: 'dependency-graph-generated-cleanup-not-approved',
    cleanupApproved: false,
    generatedAt: new Date().toISOString(),
    sqlitePath,
    inventory: {
      source: INVENTORY_JSON,
      status: inventory.status,
      generatedAt: inventory.generatedAt || null,
      sqlitePath: normalizePath(inventory.sqlitePath),
    },
    summary: {
      candidateTables: candidateSummaries.length,
      candidateDependencyEdges: dependencyEdges.length,
      retainOnlyTables: tablePlans.filter(table => table.action === 'retain-only').length,
      manualWhitelistPlusReconcileTables: tablePlans.filter(table => table.action === 'manual-whitelist-plus-reconcile').length,
      manualWhitelistRequiredTables: tablePlans.filter(table => table.action === 'manual-whitelist-required').length,
      reportOnlyReviewTables: tablePlans.filter(table => table.action === 'report-only-review').length,
      destructiveActionsPerformed: 0,
    },
    dependencyEdges,
    tablePlans,
    cleanupRules: {
      forbidden: [
        'delete by marker prefix only',
        'delete audit_logs, stock_movements, inventory_cost_ledgers, stock_balances, stock_entries directly',
        'delete parent records before child dependency reconciliation',
      ],
      requiredBeforeCleanup: [
        'stable.db backup',
        'candidate row whitelist export',
        'business fingerprint before cleanup',
        'manual approval of whitelist',
        'business fingerprint after cleanup',
        'runtime db integrity audit',
        'Phase3 targeted rerun',
      ],
    },
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(MD_REPORT, buildMarkdown(report), 'utf8');

  await prisma.$disconnect();

  console.log(JSON.stringify({
    status: report.status,
    mode: report.mode,
    summary: report.summary,
    jsonReport: JSON_REPORT,
    markdownReport: MD_REPORT,
  }, null, 2));
}

run().catch(async (error) => {
  try {
    await prisma.$disconnect();
  } catch {
    // ignore disconnect failure on fatal audit error
  }
  console.error(error);
  process.exit(1);
});
