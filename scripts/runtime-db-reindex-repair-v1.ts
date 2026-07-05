import fs from 'fs';
import type { PrismaClient } from '@prisma/client';
import { createRequire } from 'module';
import path from 'path';

const requireFromScript = createRequire(import.meta.url);
const prisma = requireFromScript('../backend/src/config/database.ts').default as PrismaClient;
const { getSqliteDbPath } = requireFromScript('../backend/src/config/runtime.ts') as {
  getSqliteDbPath: () => string | null;
};
const { BackupService } = requireFromScript('../backend/src/services/backup.service.ts') as {
  BackupService: {
    init: () => void;
    performBackup: () => Promise<string>;
  };
};

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'runtime-db-reindex-repair-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'runtime-db-reindex-repair-v1.md');

type IntegrityRow = Record<string, unknown>;

const getIntegrityMessages = (rows: IntegrityRow[]) =>
  rows
    .map(row => String(Object.values(row)[0] ?? ''))
    .filter(Boolean);

const runIntegrityCheck = async () =>
  getIntegrityMessages((await prisma.$queryRawUnsafe('PRAGMA integrity_check')) as IntegrityRow[]);

const isIndexOnlyIntegrityMessage = (message: string) =>
  /^row \d+ missing from index [A-Za-z0-9_]+$/.test(message)
  || /^wrong # of entries in index [A-Za-z0-9_]+$/.test(message);

const writeReports = (report: Record<string, unknown>) => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const md = [
    '# Runtime DB Reindex Repair v1',
    '',
    `- status: ${report.status}`,
    `- generated: ${report.generatedAt}`,
    `- sqlite path: ${report.sqlitePath || 'not configured'}`,
    `- backup: ${report.backupFileName || 'not-created'}`,
    `- repaired: ${report.repaired}`,
    `- before: ${JSON.stringify(report.beforeIntegrity)}`,
    `- after: ${JSON.stringify(report.afterIntegrity)}`,
    '',
    `Report JSON: ${JSON_REPORT}`,
  ];

  fs.writeFileSync(MD_REPORT, `${md.join('\n')}\n`, 'utf8');
};

const run = async () => {
  const generatedAt = new Date().toISOString();
  const sqlitePath = getSqliteDbPath();
  const databaseExists = Boolean(sqlitePath && fs.existsSync(sqlitePath));

  if (!sqlitePath || !databaseExists) {
    const report = {
      status: 'failed',
      generatedAt,
      sqlitePath,
      repaired: false,
      error: sqlitePath ? `Runtime SQLite database does not exist: ${sqlitePath}` : 'Runtime SQLite path is not configured',
    };
    writeReports(report);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
    return;
  }

  const beforeIntegrity = await runIntegrityCheck();
  if (beforeIntegrity.length === 1 && beforeIntegrity[0] === 'ok') {
    const report = {
      status: 'passed',
      generatedAt,
      sqlitePath,
      repaired: false,
      beforeIntegrity,
      afterIntegrity: beforeIntegrity,
      message: 'Runtime database integrity is already ok; REINDEX was not needed.',
    };
    writeReports(report);
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const unsafeMessages = beforeIntegrity.filter(message => !isIndexOnlyIntegrityMessage(message));
  if (unsafeMessages.length > 0) {
    const report = {
      status: 'failed',
      generatedAt,
      sqlitePath,
      repaired: false,
      beforeIntegrity,
      unsafeMessages,
      error: 'Integrity issues are not index-only; refusing automatic REINDEX repair.',
    };
    writeReports(report);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
    return;
  }

  BackupService.init();
  const backupFileName = await BackupService.performBackup();

  await prisma.$executeRawUnsafe('REINDEX');
  const afterIntegrity = await runIntegrityCheck();
  const repaired = afterIntegrity.length === 1 && afterIntegrity[0] === 'ok';
  const report = {
    status: repaired ? 'passed' : 'failed',
    generatedAt,
    sqlitePath,
    backupFileName,
    repaired,
    beforeIntegrity,
    afterIntegrity,
    reports: {
      json: JSON_REPORT,
      markdown: MD_REPORT,
    },
  };

  writeReports(report);
  console.log(JSON.stringify({
    status: report.status,
    sqlitePath,
    backupFileName,
    repaired,
    beforeCount: beforeIntegrity.length,
    afterIntegrity,
    jsonReport: JSON_REPORT,
    markdownReport: MD_REPORT,
  }, null, 2));

  if (!repaired) process.exitCode = 1;
};

run()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
