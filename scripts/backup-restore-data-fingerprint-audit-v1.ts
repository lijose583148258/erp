import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import {
  collectBusinessDataFingerprint,
  compareBusinessDataFingerprints,
  normalizeDatabasePath,
  withFingerprintPrisma,
} from './lib/business-data-fingerprint';
import {
  createSystemBackup,
  loginAsAdmin,
  resolveRuntimeApiUrl,
  restoreSystemBackup,
} from './lib/runtime-system-api';

const ROOT = process.cwd();
const requireFromScript = createRequire(import.meta.url);
const { getBackupDir, getSqliteDbPath } = requireFromScript('../backend/src/config/runtime.ts') as {
  getBackupDir: () => string;
  getSqliteDbPath: () => string | null;
};

const APP_URL = resolveRuntimeApiUrl();
const REQUEST_TIMEOUT_MS = Number(process.env.AUDIT_REQUEST_TIMEOUT_MS || 10000);
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'backup-restore-data-fingerprint-audit-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'backup-restore-data-fingerprint-audit-v1.md');

function writeReports(report: Record<string, unknown>) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const summary = report.summary as Record<string, unknown>;
  const mismatches = report.mismatches as Array<Record<string, unknown>>;
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

  const token = await loginAsAdmin(APP_URL, REQUEST_TIMEOUT_MS);
  const backupFileName = await createSystemBackup(APP_URL, token, REQUEST_TIMEOUT_MS);
  const backupPath = path.join(getBackupDir(), backupFileName);
  if (!fs.existsSync(backupPath)) {
    throw new Error(`Created backup file was not found: ${backupPath}`);
  }

  const backupFingerprint = await withFingerprintPrisma(
    backupPath,
    client => collectBusinessDataFingerprint(client, 'backup-file'),
  );
  const restoreIntegrity = await restoreSystemBackup(APP_URL, token, backupFileName, REQUEST_TIMEOUT_MS);
  const restoredFingerprint = await withFingerprintPrisma(
    runtimeDbPath,
    client => collectBusinessDataFingerprint(client, 'restored-runtime'),
  );
  const mismatches = compareBusinessDataFingerprints(backupFingerprint, restoredFingerprint);

  const report = {
    name: 'Backup Restore Data Fingerprint Audit',
    version: '1.1',
    generatedAt,
    status: mismatches.length === 0 ? 'passed' : 'failed',
    appUrl: APP_URL,
    runtimeDbPath: normalizeDatabasePath(runtimeDbPath),
    backupFileName,
    backupPath: normalizeDatabasePath(backupPath),
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
