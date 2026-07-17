import fs from 'fs';
import path from 'path';
import type { PrismaClient } from '@prisma/client';
import { createRequire } from 'module';

const requireFromScript = createRequire(import.meta.url);
const prisma = requireFromScript('../backend/src/config/database.ts').default as PrismaClient;
const { getSqliteDbPath, runtime } = requireFromScript('../backend/src/config/runtime.ts') as {
  getSqliteDbPath: () => string | null;
  runtime: { nodeEnv: string };
};

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'test-data-retention-inventory-audit-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'test-data-retention-inventory-audit-v1.md');

type SqliteTableRow = { name: string };
type SqliteColumnRow = {
  cid: number;
  name: string;
  type: string | null;
  notnull: number;
  dflt_value: unknown;
  pk: number;
};
type CountRow = { count: bigint | number };
type SampleRow = Record<string, unknown>;

type Marker = {
  id: string;
  patterns: string[];
  classification: 'audit-evidence' | 'e2e-candidate' | 'legacy-test-candidate';
  cleanupRisk: 'P0-never-delete-directly' | 'P1-backup-and-whitelist-required' | 'P2-report-only-review';
  description: string;
};

type ColumnHit = {
  table: string;
  column: string;
  markerId: string;
  classification: Marker['classification'];
  cleanupRisk: Marker['cleanupRisk'];
  count: number;
  samples: SampleRow[];
};

type TableSummary = {
  table: string;
  totalRows: number;
  candidateColumnHits: number;
  markers: string[];
  risk: Marker['cleanupRisk'];
};

const MARKERS: Marker[] = [
  {
    id: 'e2e-prefix',
    patterns: ['E2E-'],
    classification: 'e2e-candidate',
    cleanupRisk: 'P1-backup-and-whitelist-required',
    description: 'Browser/API E2E data with explicit cleanup prefix.',
  },
  {
    id: 'runtime-write-probe',
    patterns: ['runtime-write-'],
    classification: 'audit-evidence',
    cleanupRisk: 'P0-never-delete-directly',
    description: 'Runtime write and restart read-back audit evidence.',
  },
  {
    id: 'runtime-backup-probe',
    patterns: ['runtime-backup-'],
    classification: 'audit-evidence',
    cleanupRisk: 'P0-never-delete-directly',
    description: 'Runtime write, backup, restore, and read-back audit evidence.',
  },
  {
    id: 'auth-lifecycle-probe',
    patterns: ['auth_lifecycle_'],
    classification: 'audit-evidence',
    cleanupRisk: 'P1-backup-and-whitelist-required',
    description: 'Auth account lifecycle audit users.',
  },
  {
    id: 'chemical-bom-probe',
    patterns: ['T9-CHEM-', 'T9-CHEM-BOM-', 'CHEM-'],
    classification: 'audit-evidence',
    cleanupRisk: 'P1-backup-and-whitelist-required',
    description: 'Chemical BOM and production chain audit data.',
  },
  {
    id: 'bom-workorder-probe',
    patterns: ['BOM-', 'WO-'],
    classification: 'legacy-test-candidate',
    cleanupRisk: 'P1-backup-and-whitelist-required',
    description: 'BOM and work order style probe identifiers. Must reconcile stock and cost links before cleanup.',
  },
  {
    id: 'ui-smoke-probe',
    patterns: ['UI-SMOKE-'],
    classification: 'audit-evidence',
    cleanupRisk: 'P1-backup-and-whitelist-required',
    description: 'UI smoke and browser proof data.',
  },
  {
    id: 'audit-prefix',
    patterns: ['audit-', 'AUDIT-'],
    classification: 'audit-evidence',
    cleanupRisk: 'P2-report-only-review',
    description: 'Generic audit-script generated rows.',
  },
  {
    id: 'concurrency-duplicate-payment-probe',
    patterns: ['CONC-ORDER-CUST', 'Concurrency Order Customer', 'duplicate-payment', 'concurrency-audit-'],
    classification: 'audit-evidence',
    cleanupRisk: 'P1-backup-and-whitelist-required',
    description: 'Order/payment concurrency probes. They may intentionally create duplicate verified payments and must be quarantined from long-soak business conclusions unless explicitly whitelisted.',
  },
  {
    id: 'dirty-data-repair-probe',
    patterns: ['AUDIT-DIRTY-DATA-REPAIR'],
    classification: 'audit-evidence',
    cleanupRisk: 'P1-backup-and-whitelist-required',
    description: 'Historical repair markers used to compensate audit-generated dirty data. Keep as evidence; do not mix with normal business reconciliation.',
  },
  {
    id: 'masterdata-search-readback-probe',
    patterns: [
      'AilaoDa Audit Customer',
      'AilaoDa Audit Supplier',
      'ALD-CUS-ALIAS-',
      'ALD-SUP-ALIAS-',
      'masterdata-search-readback-api-audit',
    ],
    classification: 'audit-evidence',
    cleanupRisk: 'P1-backup-and-whitelist-required',
    description: 'CRM/supplier master-data search and read-back audit rows. Keep as evidence unless a backup, whitelist, and dependency review approve cleanup.',
  },
  {
    id: 'crm-masterdata-browser-probe',
    patterns: [
      'ALD Master',
      'Ailaoda Test Customer',
      'ALD-Alias-',
      'crm-masterdata',
    ],
    classification: 'audit-evidence',
    cleanupRisk: 'P1-backup-and-whitelist-required',
    description: 'CRM browser master-data creation and refresh read-back audit rows. Keep as evidence unless a backup, whitelist, and dependency review approve cleanup.',
  },
  {
    id: 'procurement-browser-probe',
    patterns: [
      'PO-SUP-',
      'PO-CUS-',
      'PO-ITEM-',
      'PO-BATCH-',
      'Created for procurement audit',
      'Created for procurement browser audit',
    ],
    classification: 'audit-evidence',
    cleanupRisk: 'P1-backup-and-whitelist-required',
    description: 'Procurement browser audit rows covering supplier creation, linked purchase order, receipt, and stock read-back. Keep as evidence unless cleanup is explicitly whitelisted.',
  },
  {
    id: 'warehouse-transfer-ledger-probe',
    patterns: [
      'WH-XFER-',
      'WH-LEDGER-',
      'warehouse transfer audit',
      'warehouse ledger audit',
      'warehouse transfer browser audit',
    ],
    classification: 'audit-evidence',
    cleanupRisk: 'P1-backup-and-whitelist-required',
    description: 'Warehouse transfer, inventory balance, and stock-ledger audit rows. Keep as evidence unless cleanup is explicitly whitelisted and stock dependencies are reconciled.',
  },
  {
    id: 'barter-agreement-batch-probe',
    patterns: [
      'AGREEMENT-CUST-',
      'AGREEMENT-CP-',
      'WOOD-TOTAL-',
      'GLUE-TOTAL-',
      'WOOD-B1-',
      'GLUE-B1-',
      'WOOD-B2-',
      'GLUE-B2-',
      'BARTER-AUDIT-STOCK-',
      'QA Barter Counterparty',
      'barter concurrency',
      'QA barter stock closure verification',
    ],
    classification: 'audit-evidence',
    cleanupRisk: 'P1-backup-and-whitelist-required',
    description: 'Barter agreement, batch execution, concurrency, and stock-closure audit rows. Keep as evidence unless cleanup is explicitly whitelisted and stock/offset dependencies are reconciled.',
  },
];

const EXCLUDED_TABLES = new Set([
  '_prisma_migrations',
]);

const IMPORTANT_SAMPLE_COLUMNS = [
  'id',
  'uuid',
  'code',
  'orderNo',
  'orderNumber',
  'name',
  'nameZh',
  'nameEn',
  'nameVi',
  'username',
  'email',
  'customerName',
  'supplierName',
  'bomName',
  'workOrderNo',
  'batchNo',
  'sourceRef',
  'sourceType',
  'note',
  'notes',
  'createdAt',
  'updatedAt',
  'status',
];

function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function normalizeSqlitePath(filePath: string | null) {
  return filePath ? path.resolve(filePath).replace(/\\/g, '/') : null;
}

function isTextLikeColumn(column: SqliteColumnRow) {
  const type = String(column.type || '').toUpperCase();
  const name = column.name.toLowerCase();
  return (
    type.includes('TEXT') ||
    type.includes('CHAR') ||
    type.includes('CLOB') ||
    name.includes('name') ||
    name.includes('code') ||
    name.includes('no') ||
    name.includes('ref') ||
    name.includes('note') ||
    name.includes('email') ||
    name.includes('username')
  );
}

function toNumber(value: unknown) {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sampleColumns(columns: SqliteColumnRow[]) {
  const names = new Set(columns.map(column => column.name));
  const selected = IMPORTANT_SAMPLE_COLUMNS.filter(name => names.has(name));
  if (!selected.includes('id') && names.has('id')) selected.unshift('id');
  return selected.slice(0, 12);
}

function riskRank(risk: Marker['cleanupRisk']) {
  if (risk === 'P0-never-delete-directly') return 0;
  if (risk === 'P1-backup-and-whitelist-required') return 1;
  return 2;
}

function worstRisk(risks: Marker['cleanupRisk'][]) {
  return risks.sort((a, b) => riskRank(a) - riskRank(b))[0] || 'P2-report-only-review';
}

async function getTables() {
  const tables = (await prisma.$queryRawUnsafe(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )) as SqliteTableRow[];
  return tables.map(row => row.name).filter(name => !EXCLUDED_TABLES.has(name));
}

async function getColumns(table: string) {
  return (await prisma.$queryRawUnsafe(`PRAGMA table_info(${quoteIdentifier(table)})`)) as SqliteColumnRow[];
}

async function countRows(table: string) {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`,
  )) as CountRow[];
  return toNumber(rows[0]?.count);
}

async function countPattern(table: string, column: string, pattern: string) {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)} WHERE CAST(${quoteIdentifier(column)} AS TEXT) LIKE ?`,
    `%${pattern}%`,
  )) as CountRow[];
  return toNumber(rows[0]?.count);
}

async function getSamples(table: string, column: string, patterns: string[], columns: string[]) {
  const selectedColumns = columns.length > 0 ? columns : [column];
  const selectSql = selectedColumns.map(name => quoteIdentifier(name)).join(', ');
  const whereSql = patterns.map(() => `CAST(${quoteIdentifier(column)} AS TEXT) LIKE ?`).join(' OR ');
  const params = patterns.map(pattern => `%${pattern}%`);
  return (await prisma.$queryRawUnsafe(
    `SELECT ${selectSql} FROM ${quoteIdentifier(table)} WHERE ${whereSql} LIMIT 5`,
    ...params,
  )) as SampleRow[];
}

async function run() {
  const generatedAt = new Date().toISOString();
  const sqlitePath = normalizeSqlitePath(getSqliteDbPath());
  const findings: Array<{ level: 'P0' | 'P1' | 'P2'; area: string; message: string }> = [];
  const hits: ColumnHit[] = [];
  const tableTotals = new Map<string, number>();

  if (!sqlitePath || !fs.existsSync(sqlitePath)) {
    findings.push({
      level: 'P0',
      area: 'runtime-db',
      message: `Runtime SQLite database is not available: ${sqlitePath || 'not configured'}`,
    });
  }

  if (sqlitePath?.includes('/backend/prisma/')) {
    findings.push({
      level: 'P0',
      area: 'runtime-db',
      message: `Runtime database must not be backend/prisma shadow DB: ${sqlitePath}`,
    });
  }

  const tables = findings.some(finding => finding.level === 'P0') ? [] : await getTables();

  for (const table of tables) {
    const totalRows = await countRows(table);
    tableTotals.set(table, totalRows);
    if (totalRows === 0) continue;

    const columns = await getColumns(table);
    const textColumns = columns.filter(isTextLikeColumn);
    const selectedSampleColumns = sampleColumns(columns);

    for (const column of textColumns) {
      for (const marker of MARKERS) {
        let count = 0;
        for (const pattern of marker.patterns) {
          count += await countPattern(table, column.name, pattern);
        }
        if (count === 0) continue;
        const samples = await getSamples(table, column.name, marker.patterns, selectedSampleColumns);
        hits.push({
          table,
          column: column.name,
          markerId: marker.id,
          classification: marker.classification,
          cleanupRisk: marker.cleanupRisk,
          count,
          samples,
        });
      }
    }
  }

  const tableSummaryMap = new Map<string, {
    markers: Set<string>;
    risks: Marker['cleanupRisk'][];
    candidateRows: number;
  }>();
  for (const hit of hits) {
    const current = tableSummaryMap.get(hit.table) || { markers: new Set<string>(), risks: [], candidateRows: 0 };
    current.markers.add(hit.markerId);
    current.risks.push(hit.cleanupRisk);
    current.candidateRows += hit.count;
    tableSummaryMap.set(hit.table, current);
  }

  const tableSummaries: TableSummary[] = Array.from(tableSummaryMap.entries())
    .map(([table, summary]) => ({
      table,
      totalRows: tableTotals.get(table) || 0,
      candidateColumnHits: summary.candidateRows,
      markers: Array.from(summary.markers).sort(),
      risk: worstRisk(summary.risks),
    }))
    .sort((a, b) => riskRank(a.risk) - riskRank(b.risk) || b.candidateColumnHits - a.candidateColumnHits || a.table.localeCompare(b.table));

  const p0Tables = tableSummaries.filter(table => table.risk === 'P0-never-delete-directly');
  const p1Tables = tableSummaries.filter(table => table.risk === 'P1-backup-and-whitelist-required');
  const p2Tables = tableSummaries.filter(table => table.risk === 'P2-report-only-review');

  if (hits.length > 0) {
    findings.push({
      level: 'P2',
      area: 'test-data-retention',
      message: `${hits.length} column-level marker groups found. This is report-only; no cleanup was performed.`,
    });
  }

  const report = {
    name: 'Test Data Retention Inventory Audit',
    version: '1.0',
    generatedAt,
    status: findings.some(finding => finding.level === 'P0') ? 'failed' : 'passed',
    mode: 'report-only',
    nodeEnv: runtime.nodeEnv,
    sqlitePath,
    summary: {
      scannedTables: tables.length,
      markerDefinitions: MARKERS.length,
      columnHitGroups: hits.length,
      tablesWithCandidates: tableSummaries.length,
      p0NeverDeleteTableCount: p0Tables.length,
      p1WhitelistRequiredTableCount: p1Tables.length,
      p2ReviewTableCount: p2Tables.length,
      destructiveActionsPerformed: 0,
    },
    findings,
    markers: MARKERS,
    tableSummaries,
    hits,
    cleanupPolicy: {
      allowedNow: 'report-only inventory',
      forbiddenNow: [
        'delete rows from stable.db',
        'delete by fuzzy Chinese, English, or Vietnamese company name',
        'delete parent rows without child dependency reconciliation',
        'delete audit evidence rows before backup and whitelist approval',
      ],
      requiredBeforeCleanup: [
        'create stable.db backup',
        'create business table fingerprint',
        'export candidate whitelist',
        'manually confirm real business data is excluded',
        'rerun db integrity and Phase 3 targeted gates after cleanup',
      ],
    },
    reports: {
      json: JSON_REPORT,
      markdown: MD_REPORT,
    },
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const md = [
    '# Test Data Retention Inventory Audit v1',
    '',
    `- status: ${report.status}`,
    `- mode: ${report.mode}`,
    `- generated: ${generatedAt}`,
    `- sqlite path: ${sqlitePath || 'not configured'}`,
    `- scanned tables: ${report.summary.scannedTables}`,
    `- tables with candidates: ${report.summary.tablesWithCandidates}`,
    `- column hit groups: ${report.summary.columnHitGroups}`,
    `- destructive actions performed: ${report.summary.destructiveActionsPerformed}`,
    '',
    '## Findings',
  ];
  if (findings.length === 0) md.push('- none');
  for (const finding of findings) {
    md.push(`- ${finding.level} ${finding.area}: ${finding.message}`);
  }
  md.push('', '## Table Summary');
  if (tableSummaries.length === 0) {
    md.push('- no marker candidates found');
  } else {
    md.push('| table | total rows | candidate row hits | markers | risk |');
    md.push('| --- | ---: | ---: | --- | --- |');
    for (const item of tableSummaries.slice(0, 60)) {
      md.push(`| ${item.table} | ${item.totalRows} | ${item.candidateColumnHits} | ${item.markers.join(', ')} | ${item.risk} |`);
    }
  }
  md.push('', '## Cleanup Decision');
  md.push('- 本脚本只读扫描，不执行删除。');
  md.push('- P0 表示绝不能直接删除，需要保留为验收证据或先做业务链核对。');
  md.push('- P1 表示必须先备份、建白名单、核对父子表和库存/财务影响。');
  md.push('- P2 表示可以后续人工复核，但仍不能在本轮直接清理。');
  fs.writeFileSync(MD_REPORT, `${md.join('\n')}\n`, 'utf8');

  await prisma.$disconnect();

  console.log(JSON.stringify({
    status: report.status,
    mode: report.mode,
    summary: report.summary,
    jsonReport: JSON_REPORT,
    markdownReport: MD_REPORT,
  }, null, 2));

  if (report.status !== 'passed') process.exitCode = 1;
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
