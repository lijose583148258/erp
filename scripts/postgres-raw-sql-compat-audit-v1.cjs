const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const REPORT_PATH = path.join(ROOT, 'output', 'audit', 'postgres-raw-sql-compat-audit-v1.json');

const scanRoots = [
  'backend/src',
];

const sourceExtensions = new Set(['.ts', '.js', '.cjs']);

const sqliteMaintenancePrefixes = [
  'backend/src/config/database.ts',
  'backend/src/database/',
  'backend/src/services/backup.service.ts',
];

const knownPortableRawSqlFiles = new Set([
  'backend/src/utils/raw-sql-compat.ts',
  'backend/src/controllers/shipping-receipt-event.controller.ts',
  'backend/src/services/procurement-receipt.service.ts',
  'backend/src/services/production-mutation.service.ts',
  'backend/src/services/receipt-discrepancy.service.ts',
]);

const knownPostgresMigrationBlockers = new Set([]);

const sqliteOnlyPatterns = [
  /\bPRAGMA\b/i,
  /\bsqlite_master\b/i,
  /\bAUTOINCREMENT\b/i,
  /\blast_insert_rowid\s*\(/i,
  /\bINSERT\s+OR\s+IGNORE\b/i,
  /\browid\b/i,
];

const rawCallPatterns = [
  /\.\$queryRawUnsafe(?:<[^()]*?>)?\s*\(/,
  /\.\$executeRawUnsafe(?:<[^()]*?>)?\s*\(/,
  /\.\$queryRaw\s*</,
  /\.\$executeRaw\s*</,
];

const sqliteRawPlaceholderPattern = /\.\$(?:query|execute)RawUnsafe\s*(?:<[^>]+>)?\s*\(\s*(?:`[^`]*\?[^`]*`|'[^']*\?[^']*'|"[^"]*\?[^"]*")/;

const report = {
  name: 'PostgreSQL Raw SQL Compatibility Audit',
  version: 1,
  status: 'running',
  startedAt: new Date().toISOString(),
  findings: [],
  summary: {
    filesScanned: 0,
    rawSqlFiles: 0,
    sqliteMaintenanceFiles: 0,
    portableRawSqlFiles: 0,
    reviewRawSqlFiles: 0,
    knownMigrationBlockerFiles: 0,
    unclassifiedSqliteOnlyFiles: 0,
  },
};

function normalize(relativePath) {
  return relativePath.replace(/\\/g, '/');
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(fullPath, files);
      continue;
    }
    if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) files.push(fullPath);
  }
  return files;
}

function isSqliteMaintenanceFile(relativePath) {
  return sqliteMaintenancePrefixes.some((prefix) => relativePath === prefix || relativePath.startsWith(prefix));
}

function addFinding(severity, file, message, evidence = {}) {
  report.findings.push({ severity, file, message, evidence });
}

function writeReport() {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function main() {
  const files = scanRoots.flatMap((root) => walk(path.join(ROOT, root)));
  report.summary.filesScanned = files.length;

  for (const filePath of files) {
    const relativePath = normalize(path.relative(ROOT, filePath));
    const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    const hasRawSql = rawCallPatterns.some((pattern) => pattern.test(content));
    const hasSqliteRawPlaceholders = sqliteRawPlaceholderPattern.test(content);
    const sqliteOnlyHits = sqliteOnlyPatterns
      .filter((pattern) => pattern.test(content))
      .map((pattern) => String(pattern));

    if (!hasRawSql && sqliteOnlyHits.length === 0) continue;
    if (hasRawSql) report.summary.rawSqlFiles += 1;

    if (isSqliteMaintenanceFile(relativePath)) {
      report.summary.sqliteMaintenanceFiles += 1;
      continue;
    }

    if (hasSqliteRawPlaceholders) {
      addFinding(
        'P0',
        relativePath,
        'Raw SQL uses SQLite ? placeholders. Replace it with Prisma APIs or PostgreSQL $n placeholders before cutover.',
      );
      continue;
    }

    if (knownPostgresMigrationBlockers.has(relativePath)) {
      report.summary.knownMigrationBlockerFiles += 1;
      addFinding(
        'P1',
        relativePath,
        'Known PostgreSQL migration blocker: replace SQLite-specific raw SQL with Prisma APIs or provider-specific adapters before cutover.',
        { sqliteOnlyHits },
      );
      continue;
    }

    if (sqliteOnlyHits.length > 0) {
      report.summary.unclassifiedSqliteOnlyFiles += 1;
      addFinding(
        'P0',
        relativePath,
        'Unclassified SQLite-only SQL is present outside the runtime maintenance allowlist.',
        { sqliteOnlyHits },
      );
      continue;
    }

    if (hasRawSql && knownPortableRawSqlFiles.has(relativePath)) {
      report.summary.portableRawSqlFiles += 1;
      continue;
    }

    if (hasRawSql) {
      report.summary.reviewRawSqlFiles += 1;
      addFinding(
        'P2',
        relativePath,
        'Raw SQL should be reviewed for PostgreSQL placeholder, identifier, and transaction compatibility.',
      );
    }
  }

  const blockerCount = report.findings.filter((finding) => finding.severity === 'P0').length;
  report.status = blockerCount > 0 ? 'failed' : 'passed';
  report.finishedAt = new Date().toISOString();
  writeReport();

  if (report.status === 'failed') {
    console.error('PostgreSQL Raw SQL Compatibility Audit: FAIL');
    for (const finding of report.findings) {
      console.error(`[${finding.severity}] ${finding.file}: ${finding.message}`);
    }
    console.error(`Report: ${REPORT_PATH}`);
    process.exit(1);
  }

  console.log('PostgreSQL Raw SQL Compatibility Audit: PASS');
  console.log(`- Scanned ${report.summary.filesScanned} backend source files.`);
  console.log(`- Classified ${report.summary.sqliteMaintenanceFiles} SQLite maintenance files.`);
  console.log(`- Known migration blocker files: ${report.summary.knownMigrationBlockerFiles}.`);
  console.log(`- Portable reviewed raw SQL files: ${report.summary.portableRawSqlFiles}.`);
  console.log(`- P2 raw SQL review files: ${report.summary.reviewRawSqlFiles}.`);
  console.log(`- Report: ${REPORT_PATH}`);
}

main();
