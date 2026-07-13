const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'postgres-migration-rehearsal-audit-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'postgres-migration-rehearsal-audit-v1.md');

const findings = [];
const checks = [];
const CRITICAL_TABLE_NAMES = [
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

function normalize(relativePath) {
  return relativePath.replace(/\\/g, '/');
}

function readText(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, 'utf8').replace(/\r\n/g, '\n');
}

function readJson(relativePath) {
  const text = readText(relativePath);
  if (!text) return null;
  return JSON.parse(text);
}

function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function addFinding(severity, area, file, message, evidence = {}) {
  findings.push({ severity, area, file: normalize(file), message, evidence });
}

function pass(area, file, message, evidence = {}) {
  checks.push({ status: 'passed', area, file: normalize(file), message, evidence });
}

function requireFile(relativePath, area) {
  const text = readText(relativePath);
  if (text === null) {
    addFinding('P0', area, relativePath, 'required file is missing');
    return '';
  }
  pass(area, relativePath, 'required file exists');
  return text;
}

function requireTokens(relativePath, area, tokens) {
  const text = requireFile(relativePath, area);
  if (!text) return '';
  for (const token of tokens) {
    if (!text.includes(token)) {
      addFinding('P1', area, relativePath, `missing required rehearsal token: ${token}`);
    }
  }
  if (tokens.every((token) => text.includes(token))) {
    pass(area, relativePath, 'required rehearsal tokens are present', { tokens });
  }
  return text;
}

function checkPackageScripts() {
  const packageJson = readJson('package.json');
  if (!packageJson?.scripts) {
    addFinding('P0', 'package-scripts', 'package.json', 'package scripts are missing');
    return;
  }

  const requiredScripts = {
    'audit:db:postgres-artifact': 'node ./scripts/postgres-prisma-artifact-v1.cjs',
    'audit:db:postgres-raw-sql': 'node ./scripts/postgres-raw-sql-compat-audit-v1.cjs',
    'audit:db:postgres-server-artifact': 'node ./scripts/postgres-server-artifact-audit-v1.cjs',
    'audit:db:postgres-import-rehearsal': 'node ./scripts/postgres-import-rehearsal-audit-v1.cjs',
    'audit:db:postgres-portable-rehearsal': 'node ./scripts/postgres-portable-rehearsal-audit-v1.cjs',
    'audit:backup-restore:fingerprint': 'npx tsx ./scripts/backup-restore-data-fingerprint-audit-v1.ts',
    'audit:runtime:write-backup-restore': 'npx tsx ./scripts/runtime-write-backup-restore-readback-audit-v1.ts',
    'audit:stock:ledger': 'node ./scripts/stock-ledger-reconcile-audit-v1.cjs',
    'run:db:postgres-import-rehearsal': 'node ./scripts/run-postgres-import-rehearsal-v1.cjs',
    'db:pg': 'npm run build:backend && node backend/dist/database/postgres-migration.js',
  };

  for (const [scriptName, command] of Object.entries(requiredScripts)) {
    if (packageJson.scripts[scriptName] !== command) {
      addFinding('P1', 'package-scripts', 'package.json', `missing or changed script ${scriptName}`, {
        expected: command,
        actual: packageJson.scripts[scriptName] || null,
      });
    }
  }

  if (!packageJson.scripts['audit:db:postgres-migration-rehearsal']) {
    addFinding('P1', 'package-scripts', 'package.json', 'missing audit:db:postgres-migration-rehearsal script');
  }

  pass('package-scripts', 'package.json', 'migration rehearsal script prerequisites checked');
}

function checkPostgresReports() {
  const artifact = readJson('output/audit/postgres-prisma-artifact-v1.json');
  if (!artifact || artifact.status !== 'passed') {
    addFinding('P1', 'postgres-artifact-report', 'output/audit/postgres-prisma-artifact-v1.json', 'PostgreSQL Prisma artifact report is missing or not passed');
  } else {
    pass('postgres-artifact-report', 'output/audit/postgres-prisma-artifact-v1.json', 'PostgreSQL Prisma artifact report passed');
  }

  const serverArtifact = readJson('output/audit/postgres-server-artifact-v1.json');
  if (!serverArtifact || serverArtifact.status !== 'passed') {
    addFinding('P1', 'postgres-server-artifact-report', 'output/audit/postgres-server-artifact-v1.json', 'PostgreSQL server artifact report is missing or not passed');
  } else {
    pass('postgres-server-artifact-report', 'output/audit/postgres-server-artifact-v1.json', 'PostgreSQL server artifact report passed');
  }

  const rawSql = readJson('output/audit/postgres-raw-sql-compat-audit-v1.json');
  if (!rawSql || rawSql.status !== 'passed') {
    addFinding('P1', 'postgres-raw-sql-report', 'output/audit/postgres-raw-sql-compat-audit-v1.json', 'PostgreSQL raw SQL report is missing or not passed');
    return;
  }

  const summary = rawSql.summary || {};
  if (summary.unclassifiedSqliteOnlyFiles !== 0 || summary.knownMigrationBlockerFiles !== 0 || summary.reviewRawSqlFiles !== 0) {
    addFinding('P0', 'postgres-raw-sql-report', 'output/audit/postgres-raw-sql-compat-audit-v1.json', 'raw SQL compatibility gate still has blocker or P2 review files', summary);
  } else {
    pass('postgres-raw-sql-report', 'output/audit/postgres-raw-sql-compat-audit-v1.json', 'raw SQL compatibility gate has zero blockers and zero P2 review files', summary);
  }
}

function checkGeneratedMigrationEvidence() {
  const planReportPath = 'output/audit/postgres-migration-plan-v1.json';
  const planReport = readJson(planReportPath);
  if (!planReport) {
    addFinding('P1', 'migration-evidence', planReportPath, 'PostgreSQL migration plan report is missing; run npm run db:pg -- plan');
  } else {
    if (planReport.name !== 'PostgreSQL Migration Plan') {
      addFinding('P1', 'migration-evidence', planReportPath, 'plan report name is invalid', { actual: planReport.name || null });
    }
    if (planReport.targetEnvVar !== 'POSTGRES_URL') {
      addFinding('P1', 'migration-evidence', planReportPath, 'plan report targetEnvVar must be POSTGRES_URL', { actual: planReport.targetEnvVar || null });
    }
    if (!Number.isFinite(Number(planReport.currentTables)) || Number(planReport.currentTables) <= 0) {
      addFinding('P1', 'migration-evidence', planReportPath, 'plan report currentTables must be a positive number', { actual: planReport.currentTables ?? null });
    }
    pass('migration-evidence', planReportPath, 'PostgreSQL migration plan report is present and structurally valid');
  }

  const snapshotReportPath = 'output/audit/postgres-migration-snapshot-v1.json';
  const snapshotReport = readJson(snapshotReportPath);
  if (!snapshotReport) {
    addFinding('P1', 'migration-evidence', snapshotReportPath, 'PostgreSQL migration snapshot report is missing; run npm run db:pg -- snapshot');
    return;
  }

  const snapshotPath = snapshotReport.snapshotPath;
  if (!snapshotPath || !fs.existsSync(snapshotPath)) {
    addFinding('P1', 'migration-evidence', snapshotReportPath, 'snapshot report points to a missing snapshot file', { snapshotPath: snapshotPath || null });
    return;
  }

  const actualChecksum = hashFile(snapshotPath);
  if (snapshotReport.checksumSha256 !== actualChecksum) {
    addFinding('P0', 'migration-evidence', snapshotReportPath, 'snapshot report checksum does not match the snapshot file', {
      expected: snapshotReport.checksumSha256 || null,
      actual: actualChecksum,
    });
  }
  if (!Number.isFinite(Number(snapshotReport.tableCount)) || Number(snapshotReport.tableCount) <= 0) {
    addFinding('P1', 'migration-evidence', snapshotReportPath, 'snapshot report tableCount must be a positive number', { actual: snapshotReport.tableCount ?? null });
  }
  if (!Number.isFinite(Number(snapshotReport.totalRowCount)) || Number(snapshotReport.totalRowCount) < 0) {
    addFinding('P1', 'migration-evidence', snapshotReportPath, 'snapshot report totalRowCount must be zero or positive', { actual: snapshotReport.totalRowCount ?? null });
  }
  if (!Array.isArray(snapshotReport.tableSummary) || snapshotReport.tableSummary.length !== Number(snapshotReport.tableCount)) {
    addFinding('P1', 'migration-evidence', snapshotReportPath, 'snapshot report tableSummary must align with tableCount', {
      tableCount: snapshotReport.tableCount ?? null,
      tableSummaryLength: Array.isArray(snapshotReport.tableSummary) ? snapshotReport.tableSummary.length : null,
    });
  }

  if (!Array.isArray(snapshotReport.criticalTables)) {
    addFinding('P1', 'migration-evidence', snapshotReportPath, 'snapshot report criticalTables must be present');
  } else {
    const criticalTableMap = new Map(snapshotReport.criticalTables.map((table) => [table.name, table]));
    for (const tableName of CRITICAL_TABLE_NAMES) {
      const critical = criticalTableMap.get(tableName);
      if (!critical || critical.present !== true) {
        addFinding('P0', 'migration-evidence', snapshotReportPath, 'critical migration table is missing from snapshot evidence', { tableName });
        continue;
      }
      if (!Number.isFinite(Number(critical.rowCount)) || Number(critical.rowCount) < 0) {
        addFinding('P1', 'migration-evidence', snapshotReportPath, 'critical migration table rowCount must be zero or positive', {
          tableName,
          actual: critical.rowCount ?? null,
        });
      }
    }
  }
  pass('migration-evidence', snapshotReportPath, 'PostgreSQL migration snapshot report is present and checksum-verified');

  const manifestReportPath = 'output/audit/postgres-migration-import-manifest-v1.json';
  const manifestReport = readJson(manifestReportPath);
  if (!manifestReport) {
    addFinding('P1', 'migration-evidence', manifestReportPath, 'PostgreSQL import manifest report is missing; run npm run db:pg -- manifest');
    return;
  }

  if (!Array.isArray(manifestReport.phases) || manifestReport.phases.length === 0) {
    addFinding('P1', 'migration-evidence', manifestReportPath, 'import manifest must contain at least one import phase');
  }
  if (!manifestReport.snapshot || manifestReport.snapshot.checksumSha256 !== snapshotReport.checksumSha256) {
    addFinding('P1', 'migration-evidence', manifestReportPath, 'import manifest snapshot checksum must match the latest snapshot report', {
      manifestChecksum: manifestReport.snapshot?.checksumSha256 || null,
      snapshotChecksum: snapshotReport.checksumSha256 || null,
    });
  }
  const manifestCriticalTables = new Map((manifestReport.criticalTables || []).map((table) => [table.name, table]));
  for (const tableName of CRITICAL_TABLE_NAMES) {
    if (!manifestCriticalTables.has(tableName)) {
      addFinding('P1', 'migration-evidence', manifestReportPath, 'import manifest is missing a critical table mapping', { tableName });
    }
  }
  pass('migration-evidence', manifestReportPath, 'PostgreSQL import manifest is present and aligned with the snapshot report');

  const dryRunReportPath = 'output/audit/postgres-migration-dry-run-v1.json';
  const dryRunReport = readJson(dryRunReportPath);
  if (!dryRunReport) {
    addFinding('P1', 'migration-evidence', dryRunReportPath, 'PostgreSQL dry-run import report is missing; run npm run db:pg -- dry-run-import');
    return;
  }

  if (!dryRunReport.snapshot || dryRunReport.snapshot.checksumSha256 !== snapshotReport.checksumSha256) {
    addFinding('P1', 'migration-evidence', dryRunReportPath, 'dry-run import snapshot checksum must match the latest snapshot report', {
      dryRunChecksum: dryRunReport.snapshot?.checksumSha256 || null,
      snapshotChecksum: snapshotReport.checksumSha256 || null,
    });
  }
  if (!dryRunReport.snapshot || dryRunReport.snapshot.checksumVerified !== true) {
    addFinding('P1', 'migration-evidence', dryRunReportPath, 'dry-run import must report checksumVerified=true');
  }
  if (!Array.isArray(dryRunReport.phases) || dryRunReport.phases.length === 0) {
    addFinding('P1', 'migration-evidence', dryRunReportPath, 'dry-run import must contain phase execution evidence');
  }
  if (!dryRunReport.checks || dryRunReport.checks.allPhaseTablesPresentInSnapshot !== true) {
    addFinding('P1', 'migration-evidence', dryRunReportPath, 'dry-run import must confirm all phase tables are present in snapshot');
  }
  if (!dryRunReport.checks || dryRunReport.checks.allCriticalTablesPresent !== true) {
    addFinding('P1', 'migration-evidence', dryRunReportPath, 'dry-run import must confirm all critical tables are present');
  }
  if (!dryRunReport.checks || dryRunReport.checks.totalRowsAccountedFor !== true) {
    addFinding('P1', 'migration-evidence', dryRunReportPath, 'dry-run import must confirm manifest row totals match the snapshot');
  }
  if (!Array.isArray(dryRunReport.checks?.duplicatePhaseTables) || dryRunReport.checks.duplicatePhaseTables.length !== 0) {
    addFinding('P1', 'migration-evidence', dryRunReportPath, 'dry-run import must not contain duplicate phase table assignments', {
      duplicatePhaseTables: dryRunReport.checks?.duplicatePhaseTables || null,
    });
  }
  pass('migration-evidence', dryRunReportPath, 'PostgreSQL dry-run import report is present and aligned with the snapshot + manifest evidence');
}

function checkMigrationCli() {
  requireTokens('backend/src/database/postgres-migration.ts', 'migration-cli', [
    'Create one final SQLite backup',
    'Export a migration snapshot JSON',
    'Provision PostgreSQL and set POSTGRES_URL',
    'Run schema diff and data verification',
    'If cutover fails, restore the SQLite backup and revert env vars',
    'postgres-migration-plan-v1',
    'postgres-migration-snapshot-v1',
    'postgres-migration-import-manifest-v1',
    'postgres-migration-dry-run-v1',
    'postgres-migration-import-v1',
    'postgres-migration-rollback-v1',
    'checksumSha256',
    'CRITICAL_TABLE_NAMES',
    "case 'manifest'",
    "case 'dry-run-import'",
    "case 'import'",
    "case 'snapshot'",
    "case 'rollback'",
  ]);
}

function checkBackupRestoreBoundary() {
  requireTokens('backend/src/services/backup.service.ts', 'backup-restore-boundary', [
    'verifyBackupIntegrity',
    'restore-pre-',
    '.manifest.json',
    'sha256',
    'BACKUP_OPERATION_IN_PROGRESS',
  ]);

  requireTokens('scripts/backup-restore-data-fingerprint-audit-v1.ts', 'backup-restore-boundary', [
    'collectBusinessDataFingerprint',
    'compareBusinessDataFingerprints',
    'restoreSystemBackup',
    'manifestVerified',
  ]);

  requireTokens('scripts/runtime-write-backup-restore-readback-audit-v1.ts', 'backup-restore-boundary', [
    'verify runtime write survives backup and restore',
    'backupFileReadBack',
    'restoreReadBack',
    'manifestVerified',
  ]);
}

function checkRunbook() {
  requireTokens('docs/runbooks/POSTGRESQL_MIGRATION_REHEARSAL.md', 'migration-runbook', [
    'Preflight',
    'Final SQLite backup',
    'Snapshot export',
    'PostgreSQL rehearsal',
    'Cutover smoke tests',
    'Rollback',
    'Do not claim production cutover',
    'npm run audit:db:postgres-migration-rehearsal',
    'npm run audit:backup-restore:fingerprint',
    'npm run audit:runtime:write-backup-restore',
    'npm run audit:db:postgres-portable-rehearsal',
    'npm run db:pg -- plan',
    'npm run db:pg -- snapshot',
    'npm run db:pg -- manifest',
    'npm run db:pg -- dry-run-import',
    'npm run db:pg:start-rehearsal',
    'npm run db:pg:stop-rehearsal',
    'npm run db:pg -- import',
    'npm run audit:db:postgres-import-rehearsal',
    'npm run run:db:postgres-import-rehearsal',
    'npm run db:pg -- rollback',
    'output/audit/postgres-migration-plan-v1.json',
    'output/audit/postgres-migration-snapshot-v1.json',
    'output/audit/postgres-migration-import-manifest-v1.json',
    'output/audit/postgres-migration-dry-run-v1.json',
    'output/audit/postgres-migration-import-v1.json',
    'output/audit/postgres-import-rehearsal-audit-v1.json',
    'output/audit/postgres-import-rehearsal-run-v1.json',
    'output/audit/postgres-migration-rollback-v1.json',
  ]);
}

function writeReports(report) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const md = [
    '# PostgreSQL Migration Rehearsal Audit v1',
    '',
    `- status: ${report.status}`,
    `- generated: ${report.generatedAt}`,
    `- findings: ${report.findings.length}`,
    `- checks: ${report.checks.length}`,
    '',
    '## Findings',
  ];
  if (report.findings.length === 0) md.push('- none');
  for (const finding of report.findings) {
    md.push(`- ${finding.severity} ${finding.area} ${finding.file}: ${finding.message}`);
  }
  md.push('', '## Boundary');
  md.push('- This audit proves migration rehearsal prerequisites and rollback controls are present.');
  md.push('- It does not prove live PostgreSQL data migration or production cutover.');
  fs.writeFileSync(MD_REPORT, `${md.join('\n')}\n`, 'utf8');
}

function main() {
  checkPackageScripts();
  checkPostgresReports();
  checkGeneratedMigrationEvidence();
  checkMigrationCli();
  checkBackupRestoreBoundary();
  checkRunbook();

  const hasP0 = findings.some((finding) => finding.severity === 'P0');
  const report = {
    name: 'PostgreSQL Migration Rehearsal Audit',
    version: 1,
    generatedAt: new Date().toISOString(),
    status: hasP0 ? 'failed' : findings.length ? 'warning' : 'passed',
    scope: 'pre-cutover-postgresql-rehearsal-prerequisites',
    findings,
    checks,
    reports: {
      json: JSON_REPORT,
      markdown: MD_REPORT,
    },
    nonClaims: [
      'live PostgreSQL service migration was not executed by this audit',
      'production DATABASE_URL cutover is not approved by this audit',
      'route-level smoke tests must still run against the deployed PostgreSQL server artifact',
    ],
  };

  writeReports(report);
  console.log(JSON.stringify({
    status: report.status,
    findings: report.findings.length,
    jsonReport: JSON_REPORT,
    markdownReport: MD_REPORT,
  }, null, 2));
  if (report.status === 'failed') process.exitCode = 1;
}

main();
