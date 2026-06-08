import fs from 'fs';
import type { PrismaClient } from '@prisma/client';
import { createRequire } from 'module';
import path from 'path';

const requireFromScript = createRequire(import.meta.url);
const prisma = requireFromScript('../backend/src/config/database.ts').default as PrismaClient;
const { getSqliteDbPath, runtime } = requireFromScript('../backend/src/config/runtime.ts') as {
  getSqliteDbPath: () => string | null;
  runtime: { nodeEnv: string };
};
const { auditRuntimeSchema } = requireFromScript('../backend/src/database/runtime-schema-audit.ts') as {
  auditRuntimeSchema: () => Promise<{
    sqlitePath: string | null;
    schemaFileCount: number;
    tableCount: number;
    issueCount: number;
    issues: Array<Record<string, unknown>>;
  }>;
};
const {
  classifyShadowDb,
  isGovernedShadowDb,
  shadowDbGovernanceNote,
} = requireFromScript('./lib/runtime-db-governance.cjs') as {
  classifyShadowDb: (relativePath: string) => string;
  isGovernedShadowDb: (relativePath: string) => boolean;
  shadowDbGovernanceNote: (classification: string) => string;
};

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'runtime-db-integrity-audit-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'runtime-db-integrity-audit-v1.md');

const REQUIRED_TABLES = [
  'users',
  'auth_roles',
  'auth_permissions',
  'auth_role_permissions',
  'customers',
  'orders',
  'order_items',
  'payment_records',
  'suppliers',
  'purchase_orders',
  'production_boms',
  'production_bom_items',
  'production_work_orders',
  'warehouses',
  'locations',
  'stock_balances',
  'stock_entries',
  'stock_movements',
  'receivable_adjustments',
];

type SqliteNameRow = { name: string };
type IntegrityRow = Record<string, unknown>;
type FindingLevel = 'P0' | 'P1' | 'P2' | 'P3';

type Finding = {
  level: FindingLevel;
  area: string;
  message: string;
};

type ShadowDbWarning = {
  path: string;
  relativePath: string;
  classification: string;
  governance: 'governed-quarantined' | 'unresolved';
  governanceNote: string;
};

const normalizeSqlitePath = (filePath: string | null) =>
  filePath ? path.resolve(filePath).replace(/\\/g, '/') : null;

const addFinding = (findings: Finding[], level: FindingLevel, area: string, message: string) => {
  findings.push({ level, area, message });
};

const getIntegrityMessages = (rows: IntegrityRow[]) =>
  rows
    .map(row => String(Object.values(row)[0] ?? ''))
    .filter(Boolean);

const toRepoRelativePath = (filePath: string) =>
  path.relative(ROOT, filePath).replace(/\\/g, '/');

const getShadowDbWarnings = (runtimeDbPath: string | null) => {
  const warnings: ShadowDbWarning[] = [];
  const normalizedRuntime = normalizeSqlitePath(runtimeDbPath);
  const candidates = [
    path.join(ROOT, 'backend', 'prisma', '%LOCALAPPDATA%', 'AilaoDaRuntime', 'stable.db'),
    path.join(ROOT, 'backend', 'prisma', 'dev.db'),
    path.join(ROOT, 'backend', 'prisma', 'fresh.db'),
    path.join(ROOT, 'backend', 'prisma', 'main.db'),
    path.join(ROOT, 'backend', 'prisma', 'recovered.db'),
  ];

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeSqlitePath(candidate);
    if (!normalizedCandidate || normalizedCandidate === normalizedRuntime) continue;
    if (fs.existsSync(candidate)) {
      const relativePath = toRepoRelativePath(candidate);
      const classification = classifyShadowDb(relativePath);
      const governed = isGovernedShadowDb(relativePath);
      warnings.push({
        path: normalizedCandidate,
        relativePath,
        classification,
        governance: governed ? 'governed-quarantined' : 'unresolved',
        governanceNote: shadowDbGovernanceNote(classification),
      });
    }
  }

  return warnings;
};

const writeReports = (report: Record<string, unknown>) => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const summary = report.summary as Record<string, unknown>;
  const findings = report.findings as Finding[];
  const md = [
    '# Runtime DB Integrity Audit v1',
    '',
    `- status: ${report.status}`,
    `- generated: ${report.generatedAt}`,
    `- sqlite path: ${report.sqlitePath || 'not configured'}`,
    `- database exists: ${summary.databaseExists}`,
    `- database size: ${summary.databaseSize}`,
    `- integrity check: ${summary.integrityStatus}`,
    `- foreign key violations: ${summary.foreignKeyViolationCount}`,
    `- schema issues: ${summary.schemaIssueCount}`,
    `- missing required tables: ${summary.missingRequiredTableCount}`,
    '',
    '## Findings',
  ];

  if (findings.length === 0) md.push('- none');
  for (const finding of findings) {
    md.push(`- ${finding.level} ${finding.area}: ${finding.message}`);
  }

  fs.writeFileSync(MD_REPORT, `${md.join('\n')}\n`, 'utf8');
};

const run = async () => {
  const generatedAt = new Date().toISOString();
  const findings: Finding[] = [];
  const sqlitePath = getSqliteDbPath();
  const normalizedSqlitePath = normalizeSqlitePath(sqlitePath);
  const databaseExists = Boolean(sqlitePath && fs.existsSync(sqlitePath));
  const databaseSize = databaseExists && sqlitePath ? fs.statSync(sqlitePath).size : 0;

  if (!sqlitePath) {
    addFinding(findings, 'P0', 'runtime-path', 'Current runtime is not configured as a SQLite file database');
  } else if (!databaseExists) {
    addFinding(findings, 'P0', 'runtime-path', `Runtime SQLite database does not exist: ${normalizedSqlitePath}`);
  } else if (databaseSize <= 0) {
    addFinding(findings, 'P0', 'runtime-path', `Runtime SQLite database is empty: ${normalizedSqlitePath}`);
  }

  if (normalizedSqlitePath?.includes('/backend/prisma/')) {
    addFinding(findings, 'P0', 'runtime-path', `Runtime database must not live under backend/prisma: ${normalizedSqlitePath}`);
  }

  const shadowDbWarnings = getShadowDbWarnings(sqlitePath);
  for (const shadowDb of shadowDbWarnings) {
    if (shadowDb.governance === 'governed-quarantined') {
      addFinding(
        findings,
        'P3',
        'governed-shadow-db',
        `Historical SQLite file is governed and quarantined from the active runtime path: ${shadowDb.path} (${shadowDb.governanceNote})`,
      );
      continue;
    }
    addFinding(findings, 'P2', 'shadow-db', `Historical SQLite file exists outside the active runtime path and is not governed: ${shadowDb.path}`);
  }

  let tables: SqliteNameRow[] = [];
  let integrityMessages: string[] = [];
  let foreignKeyViolations: Array<Record<string, unknown>> = [];
  let schemaAudit = {
    sqlitePath,
    schemaFileCount: 0,
    tableCount: 0,
    issueCount: 0,
    issues: [] as Array<Record<string, unknown>>,
  };

  if (databaseExists) {
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');

    tables = await prisma.$queryRawUnsafe<SqliteNameRow[]>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );

    const integrityRows = await prisma.$queryRawUnsafe<IntegrityRow[]>('PRAGMA integrity_check');
    integrityMessages = getIntegrityMessages(integrityRows);
    if (integrityMessages.length !== 1 || integrityMessages[0] !== 'ok') {
      addFinding(findings, 'P0', 'sqlite-integrity', `PRAGMA integrity_check returned: ${integrityMessages.join('; ')}`);
    }

    foreignKeyViolations = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>('PRAGMA foreign_key_check');
    if (foreignKeyViolations.length > 0) {
      addFinding(findings, 'P0', 'sqlite-foreign-key', `PRAGMA foreign_key_check returned ${foreignKeyViolations.length} violations`);
    }

    schemaAudit = await auditRuntimeSchema();
    if (schemaAudit.issueCount > 0) {
      addFinding(findings, 'P0', 'schema-drift', `Runtime schema has ${schemaAudit.issueCount} missing table/column issues`);
    }
  }

  const tableNames = new Set(tables.map(row => row.name));
  const missingRequiredTables = REQUIRED_TABLES.filter(tableName => !tableNames.has(tableName));
  if (databaseExists && missingRequiredTables.length > 0) {
    addFinding(findings, 'P0', 'required-tables', `Missing required runtime tables: ${missingRequiredTables.join(', ')}`);
  }

  const failed = findings.some(finding => finding.level === 'P0');
  const report = {
    name: 'Runtime DB Integrity Audit',
    version: '1.0',
    generatedAt,
    status: failed ? 'failed' : 'passed',
    nodeEnv: runtime.nodeEnv,
    sqlitePath: normalizedSqlitePath,
    summary: {
      databaseExists,
      databaseSize,
      schemaFileCount: schemaAudit.schemaFileCount,
      tableCount: tables.length,
      integrityStatus: integrityMessages.join('; ') || 'not-run',
      foreignKeyViolationCount: foreignKeyViolations.length,
      schemaIssueCount: schemaAudit.issueCount,
      missingRequiredTableCount: missingRequiredTables.length,
      shadowDbWarningCount: shadowDbWarnings.length,
      governedShadowDbWarningCount: shadowDbWarnings.filter(item => item.governance === 'governed-quarantined').length,
      unresolvedShadowDbWarningCount: shadowDbWarnings.filter(item => item.governance === 'unresolved').length,
    },
    findings,
    missingRequiredTables,
    integrityMessages,
    foreignKeyViolations,
    schemaIssues: schemaAudit.issues,
    shadowDbWarnings: shadowDbWarnings.map(item => item.path),
    shadowDbWarningDetails: shadowDbWarnings,
    reports: {
      json: JSON_REPORT,
      markdown: MD_REPORT,
    },
  };

  writeReports(report);
  console.log(JSON.stringify({
    status: report.status,
    sqlitePath: report.sqlitePath,
    summary: report.summary,
    findings: findings.length,
    jsonReport: JSON_REPORT,
    markdownReport: MD_REPORT,
  }, null, 2));

  if (failed) process.exitCode = 1;
};

run()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
