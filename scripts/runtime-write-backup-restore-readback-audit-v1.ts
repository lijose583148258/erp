import crypto from 'crypto';
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
  assertSameAuditProbe,
  insertAuditProbe,
  readAuditProbe,
  type AuditLogProbeRow,
} from './lib/runtime-audit-probe';
import {
  collectRuntimeResourceChecks,
  resolveRuntimeAppUrl,
  waitForRuntime,
  type RuntimeCheck,
} from './lib/runtime-stable-restart';
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
const RESOURCE_APP_URL = resolveRuntimeAppUrl();
const REQUEST_TIMEOUT_MS = Number(process.env.AUDIT_REQUEST_TIMEOUT_MS || 10_000);
const RUNTIME_READY_TIMEOUT_MS = Number(process.env.AUDIT_RUNTIME_READY_TIMEOUT_MS || 20_000);
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'runtime-write-backup-restore-readback-audit-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'runtime-write-backup-restore-readback-audit-v1.md');
const SQLITE_COMPANION_SUFFIXES = ['-wal', '-shm', '-journal'] as const;

function resolveCreatedBackupPath(fileName: string, runtimeDbPath?: string | null) {
  const candidates = [
    path.join(getBackupDir(), fileName),
    ...(runtimeDbPath ? [path.join(path.dirname(runtimeDbPath), 'backups', fileName)] : []),
    path.join('D:\\', 'AilaoDaRuntime', 'backups', fileName),
    path.join(ROOT, 'AilaoDa_Stable_Package', 'backups', fileName),
    path.join(ROOT, 'backups', fileName),
  ];
  const found = candidates.find(candidate => fs.existsSync(candidate));
  return found || candidates[0];
}

function writeReports(report: Record<string, unknown>) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const summary = report.summary as Record<string, unknown>;
  const failedChecks = report.failedRuntimeChecks as RuntimeCheck[];
  const probeMismatches = report.probeMismatches as string[];
  const backupProbeMismatches = report.backupProbeMismatches as string[];
  const businessMismatches = report.businessMismatches as Array<Record<string, unknown>>;
  const md = [
    '# Runtime Write Backup Restore Readback Audit v1',
    '',
    `- status: ${report.status}`,
    `- generated: ${report.generatedAt}`,
    `- app url: ${APP_URL}`,
    `- runtime db: ${summary.runtimeDbPath}`,
    `- backup: ${summary.backupFileName}`,
    `- probe id: ${summary.probeId}`,
    `- probe row id: ${summary.probeRowId}`,
    `- immediate read back: ${summary.immediateReadBack}`,
    `- backup file read back: ${summary.backupFileReadBack}`,
    `- restore read back: ${summary.restoreReadBack}`,
    `- manifest verified: ${summary.manifestVerified}`,
    `- pre-backup business mismatches: ${summary.preBackupBusinessMismatches}`,
    `- restored business mismatches: ${summary.businessMismatches}`,
    `- failed runtime checks: ${summary.failedRuntimeChecks}`,
    '',
    '## Probe Mismatches After Restore',
  ];

  if (probeMismatches.length === 0) md.push('- none');
  for (const mismatch of probeMismatches) md.push(`- ${mismatch}`);

  md.push('');
  md.push('## Probe Mismatches In Backup File');
  if (backupProbeMismatches.length === 0) md.push('- none');
  for (const mismatch of backupProbeMismatches) md.push(`- ${mismatch}`);

  md.push('');
  md.push('## Business Mismatches');
  if (businessMismatches.length === 0) md.push('- none');
  for (const mismatch of businessMismatches) md.push(`- ${JSON.stringify(mismatch)}`);

  md.push('');
  md.push('## Failed Runtime Checks');
  if (failedChecks.length === 0) md.push('- none');
  for (const check of failedChecks) {
    md.push(`- ${check.name}: ${check.status} ${check.error || ''}`.trim());
  }

  fs.writeFileSync(MD_REPORT, `${md.join('\n')}\n`, 'utf8');
}

function createFingerprintReadCopy(sourcePath: string) {
  const copyDir = path.join(OUTPUT_DIR, 'fingerprint-db-copies');
  fs.mkdirSync(copyDir, { recursive: true });

  const copyPath = path.join(copyDir, `${path.basename(sourcePath)}.${Date.now()}.copy.db`);
  fs.copyFileSync(sourcePath, copyPath);
  for (const suffix of SQLITE_COMPANION_SUFFIXES) {
    const sourceCompanionPath = `${sourcePath}${suffix}`;
    if (fs.existsSync(sourceCompanionPath)) {
      fs.copyFileSync(sourceCompanionPath, `${copyPath}${suffix}`);
    }
  }

  return copyPath;
}

function removeFingerprintReadCopy(copyPath: string) {
  for (const filePath of [copyPath, ...SQLITE_COMPANION_SUFFIXES.map(suffix => `${copyPath}${suffix}`)]) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // Best-effort cleanup; stale fingerprint copies are harmless audit artifacts.
    }
  }
}

async function main() {
  const generatedAt = new Date().toISOString();
  const probeId = `runtime-backup-${crypto.randomUUID()}`;
  const runtimeDbPath = getSqliteDbPath();
  if (!runtimeDbPath || !fs.existsSync(runtimeDbPath)) {
    throw new Error(`Runtime SQLite database is not available before backup probe: ${runtimeDbPath || 'not configured'}`);
  }

  await waitForRuntime(RESOURCE_APP_URL, RUNTIME_READY_TIMEOUT_MS, REQUEST_TIMEOUT_MS);
  const token = await loginAsAdmin(APP_URL, REQUEST_TIMEOUT_MS);
  const beforeBusinessFingerprint = await withFingerprintPrisma(
    runtimeDbPath,
    client => collectBusinessDataFingerprint(client, 'before-runtime-write-backup-restore'),
  );

  const insertedProbe = await withFingerprintPrisma(
    runtimeDbPath,
    client => insertAuditProbe(client, {
      probeId,
      databasePath: runtimeDbPath,
      purpose: 'verify runtime write survives backup and restore',
      userAgent: 'runtime-write-backup-restore-readback-audit-v1',
    }),
  );

  const immediateProbe = await withFingerprintPrisma(
    runtimeDbPath,
    client => readAuditProbe(client, probeId),
  );
  const immediateReadBack = Boolean(immediateProbe && immediateProbe.id === insertedProbe.id);

  const backupFileName = await createSystemBackup(APP_URL, token, REQUEST_TIMEOUT_MS);
  const backupPath = resolveCreatedBackupPath(backupFileName, runtimeDbPath);
  if (!fs.existsSync(backupPath)) {
    throw new Error(`Created backup file was not found: ${backupPath}`);
  }

  const backupReadCopyPath = createFingerprintReadCopy(backupPath);
  let backupProbe: AuditLogProbeRow | null = null;
  let backupBusinessFingerprint;
  try {
    backupProbe = await withFingerprintPrisma(
      backupReadCopyPath,
      client => readAuditProbe(client, probeId),
    );
    backupBusinessFingerprint = await withFingerprintPrisma(
      backupReadCopyPath,
      client => collectBusinessDataFingerprint(client, 'backup-file-copy-after-runtime-write'),
    );
  } finally {
    removeFingerprintReadCopy(backupReadCopyPath);
  }
  const backupProbeMismatches = assertSameAuditProbe(insertedProbe, backupProbe, probeId);
  const backupFileReadBack = backupProbeMismatches.length === 0;
  const preBackupBusinessMismatches = compareBusinessDataFingerprints(beforeBusinessFingerprint, backupBusinessFingerprint);

  const restoreIntegrity = await restoreSystemBackup(APP_URL, token, backupFileName, REQUEST_TIMEOUT_MS);
  const restoredProbe = await withFingerprintPrisma(
    runtimeDbPath,
    client => readAuditProbe(client, probeId),
  );
  const probeMismatches = assertSameAuditProbe(insertedProbe, restoredProbe, probeId);
  const restoreReadBack = probeMismatches.length === 0;

  const restoredBusinessFingerprint = await withFingerprintPrisma(
    runtimeDbPath,
    client => collectBusinessDataFingerprint(client, 'restored-runtime-after-write-backup'),
  );
  const businessMismatches = compareBusinessDataFingerprints(backupBusinessFingerprint, restoredBusinessFingerprint);
  const runtimeChecks = await collectRuntimeResourceChecks(RESOURCE_APP_URL, REQUEST_TIMEOUT_MS);
  const failedRuntimeChecks = runtimeChecks.filter(check => !check.ok);
  const failed = !immediateReadBack
    || !backupFileReadBack
    || !restoreReadBack
    || !restoreIntegrity?.verified
    || preBackupBusinessMismatches.length > 0
    || businessMismatches.length > 0
    || failedRuntimeChecks.length > 0;

  const report = {
    name: 'Runtime Write Backup Restore Readback Audit',
    version: '1.0',
    generatedAt,
    status: failed ? 'failed' : 'passed',
    appUrl: APP_URL,
    runtimeDbPath: normalizeDatabasePath(runtimeDbPath),
    backupFileName,
    backupPath: normalizeDatabasePath(backupPath),
    probeId,
    insertedProbe,
    immediateProbe,
    backupProbe: backupProbe as AuditLogProbeRow | null,
    restoredProbe: restoredProbe as AuditLogProbeRow | null,
    backupProbeMismatches,
    probeMismatches,
    restoreIntegrity,
    beforeBusinessFingerprint,
    backupBusinessFingerprint,
    restoredBusinessFingerprint,
    preBackupBusinessMismatches,
    businessMismatches,
    runtimeChecks,
    failedRuntimeChecks,
    summary: {
      runtimeDbPath: normalizeDatabasePath(runtimeDbPath),
      backupFileName,
      probeId,
      probeRowId: insertedProbe.id,
      immediateReadBack,
      backupFileReadBack,
      restoreReadBack,
      manifestVerified: Boolean(restoreIntegrity?.verified),
      comparedBusinessTables: backupBusinessFingerprint.tableCount,
      beforeBusinessHash: beforeBusinessFingerprint.hash,
      backupBusinessHash: backupBusinessFingerprint.hash,
      restoredBusinessHash: restoredBusinessFingerprint.hash,
      preBackupBusinessMismatches: preBackupBusinessMismatches.length,
      businessMismatches: businessMismatches.length,
      failedRuntimeChecks: failedRuntimeChecks.length,
    },
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

  if (failed) process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
