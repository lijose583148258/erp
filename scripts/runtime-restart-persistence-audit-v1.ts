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
  collectRuntimeResourceChecks,
  runStartStable,
  waitForRuntime,
  resolveRuntimeAppUrl,
  type RuntimeCheck,
} from './lib/runtime-stable-restart';

const ROOT = process.cwd();
const requireFromScript = createRequire(import.meta.url);
const { getSqliteDbPath } = requireFromScript('../backend/src/config/runtime.ts') as {
  getSqliteDbPath: () => string | null;
};

const APP_URL = resolveRuntimeAppUrl();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'runtime-restart-persistence-audit-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'runtime-restart-persistence-audit-v1.md');
const START_TIMEOUT_MS = Number(process.env.AUDIT_RESTART_TIMEOUT_MS || 240_000);
const REQUEST_TIMEOUT_MS = Number(process.env.AUDIT_REQUEST_TIMEOUT_MS || 10_000);
const RUNTIME_READY_TIMEOUT_MS = Number(process.env.AUDIT_RUNTIME_READY_TIMEOUT_MS || 20_000);

type DbSnapshot = {
  path: string;
  exists: boolean;
  size: number;
  mtimeMs: number;
};

function readDbSnapshot(databasePath: string): DbSnapshot {
  const exists = fs.existsSync(databasePath);
  const stat = exists ? fs.statSync(databasePath) : null;
  return {
    path: normalizeDatabasePath(databasePath),
    exists,
    size: stat?.size || 0,
    mtimeMs: stat?.mtimeMs || 0,
  };
}

function writeReports(report: Record<string, unknown>) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const summary = report.summary as Record<string, unknown>;
  const failedChecks = report.failedRuntimeChecks as RuntimeCheck[];
  const mismatches = report.fingerprintMismatches as Array<Record<string, unknown>>;
  const md = [
    '# Runtime Restart Persistence Audit v1',
    '',
    `- status: ${report.status}`,
    `- generated: ${report.generatedAt}`,
    `- app url: ${APP_URL}`,
    `- runtime db before: ${summary.databasePathBefore}`,
    `- runtime db after: ${summary.databasePathAfter}`,
    `- compared tables: ${summary.comparedTables}`,
    `- fingerprint mismatches: ${summary.fingerprintMismatches}`,
    `- failed runtime checks: ${summary.failedRuntimeChecks}`,
    `- restart timed out: ${summary.restartTimedOut}`,
    '',
    '## Failed Runtime Checks',
  ];

  if (failedChecks.length === 0) md.push('- none');
  for (const check of failedChecks) {
    md.push(`- ${check.name}: ${check.status} ${check.error || ''}`.trim());
  }

  md.push('');
  md.push('## Fingerprint Mismatches');
  if (mismatches.length === 0) md.push('- none');
  for (const mismatch of mismatches) {
    md.push(`- ${JSON.stringify(mismatch)}`);
  }

  fs.writeFileSync(MD_REPORT, `${md.join('\n')}\n`, 'utf8');
}

async function main() {
  const generatedAt = new Date().toISOString();
  const beforeDbPath = getSqliteDbPath();
  if (!beforeDbPath || !fs.existsSync(beforeDbPath)) {
    throw new Error(`Runtime SQLite database is not available before restart: ${beforeDbPath || 'not configured'}`);
  }

  const beforeSnapshot = readDbSnapshot(beforeDbPath);
  const beforeFingerprint = await withFingerprintPrisma(
    beforeDbPath,
    client => collectBusinessDataFingerprint(client, 'before-runtime-restart'),
  );

  const restart = await runStartStable(ROOT, START_TIMEOUT_MS);
  if (restart.exitCode !== 0 || restart.timedOut) {
    const report = {
      name: 'Runtime Restart Persistence Audit',
      version: '1.0',
      generatedAt,
      status: 'failed',
      appUrl: APP_URL,
      beforeSnapshot,
      afterSnapshot: null,
      restart,
      summary: {
        databasePathBefore: beforeSnapshot.path,
        databasePathAfter: null,
        comparedTables: beforeFingerprint.tableCount,
        fingerprintMismatches: 'not-run',
        failedRuntimeChecks: 'not-run',
        restartTimedOut: restart.timedOut,
      },
      failedRuntimeChecks: [],
      fingerprintMismatches: [],
      reports: {
        json: JSON_REPORT,
        markdown: MD_REPORT,
      },
    };
    writeReports(report);
    console.log(JSON.stringify({ status: report.status, summary: report.summary, jsonReport: JSON_REPORT, markdownReport: MD_REPORT }, null, 2));
    process.exitCode = 1;
    return;
  }

  await waitForRuntime(APP_URL, RUNTIME_READY_TIMEOUT_MS, REQUEST_TIMEOUT_MS);
  const runtimeChecks = await collectRuntimeResourceChecks(APP_URL, REQUEST_TIMEOUT_MS);
  const failedRuntimeChecks = runtimeChecks.filter(check => !check.ok);

  const afterDbPath = getSqliteDbPath();
  if (!afterDbPath || !fs.existsSync(afterDbPath)) {
    throw new Error(`Runtime SQLite database is not available after restart: ${afterDbPath || 'not configured'}`);
  }

  const afterSnapshot = readDbSnapshot(afterDbPath);
  const afterFingerprint = await withFingerprintPrisma(
    afterDbPath,
    client => collectBusinessDataFingerprint(client, 'after-runtime-restart'),
  );
  const fingerprintMismatches = compareBusinessDataFingerprints(beforeFingerprint, afterFingerprint);
  const pathChanged = beforeSnapshot.path !== afterSnapshot.path;
  const failed = pathChanged || failedRuntimeChecks.length > 0 || fingerprintMismatches.length > 0;

  const report = {
    name: 'Runtime Restart Persistence Audit',
    version: '1.0',
    generatedAt,
    status: failed ? 'failed' : 'passed',
    appUrl: APP_URL,
    beforeSnapshot,
    afterSnapshot,
    restart,
    runtimeChecks,
    failedRuntimeChecks,
    pathChanged,
    beforeFingerprint,
    afterFingerprint,
    fingerprintMismatches,
    summary: {
      databasePathBefore: beforeSnapshot.path,
      databasePathAfter: afterSnapshot.path,
      databasePathChanged: pathChanged,
      comparedTables: beforeFingerprint.tableCount,
      beforeHash: beforeFingerprint.hash,
      afterHash: afterFingerprint.hash,
      fingerprintMismatches: fingerprintMismatches.length,
      failedRuntimeChecks: failedRuntimeChecks.length,
      restartTimedOut: restart.timedOut,
      restartDurationMs: restart.durationMs,
    },
    reports: {
      json: JSON_REPORT,
      markdown: MD_REPORT,
    },
  };

  writeReports(report);
  console.log(JSON.stringify({
    status: report.status,
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
