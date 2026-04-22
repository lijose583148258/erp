import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import type { PrismaClient as PrismaClientType } from '@prisma/client';
import {
  collectBusinessDataFingerprint,
  compareBusinessDataFingerprints,
  normalizeDatabasePath,
  withFingerprintPrisma,
} from './lib/business-data-fingerprint';
import {
  collectRuntimeResourceChecks,
  resolveRuntimeAppUrl,
  runStartStable,
  waitForRuntime,
  type RuntimeCheck,
} from './lib/runtime-stable-restart';

const ROOT = process.cwd();
const requireFromScript = createRequire(import.meta.url);
const { getSqliteDbPath } = requireFromScript('../backend/src/config/runtime.ts') as {
  getSqliteDbPath: () => string | null;
};

const APP_URL = resolveRuntimeAppUrl();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'runtime-write-read-restart-audit-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'runtime-write-read-restart-audit-v1.md');
const START_TIMEOUT_MS = Number(process.env.AUDIT_RESTART_TIMEOUT_MS || 240_000);
const REQUEST_TIMEOUT_MS = Number(process.env.AUDIT_REQUEST_TIMEOUT_MS || 10_000);
const RUNTIME_READY_TIMEOUT_MS = Number(process.env.AUDIT_RUNTIME_READY_TIMEOUT_MS || 20_000);
const PROBE_ACTION = 'RUNTIME_WRITE_PERSISTENCE_PROBE';
const PROBE_RESOURCE = 'runtime_persistence_probe';

type UserRow = {
  id: number;
  username: string;
};

type AuditLogRow = {
  id: number;
  user_id: number;
  action: string;
  resource: string;
  resource_id: number | null;
  details: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

function writeReports(report: Record<string, unknown>) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const summary = report.summary as Record<string, unknown>;
  const failedChecks = report.failedRuntimeChecks as RuntimeCheck[];
  const mismatches = report.fingerprintMismatches as Array<Record<string, unknown>>;
  const md = [
    '# Runtime Write Read Restart Audit v1',
    '',
    `- status: ${report.status}`,
    `- generated: ${report.generatedAt}`,
    `- app url: ${APP_URL}`,
    `- runtime db before: ${summary.databasePathBefore}`,
    `- runtime db after: ${summary.databasePathAfter}`,
    `- probe id: ${summary.probeId}`,
    `- probe row id: ${summary.probeRowId}`,
    `- immediate read back: ${summary.immediateReadBack}`,
    `- restart read back: ${summary.restartReadBack}`,
    `- business fingerprint mismatches: ${summary.fingerprintMismatches}`,
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

async function pickProbeUser(client: PrismaClientType) {
  const users = await client.$queryRawUnsafe<UserRow[]>(
    "SELECT id, username FROM users ORDER BY CASE WHEN username = 'admin' THEN 0 ELSE 1 END, id ASC LIMIT 1",
  );
  const user = users[0];
  if (!user) {
    throw new Error('No user exists for runtime write/read persistence probe');
  }
  return user;
}

async function insertProbe(client: PrismaClientType, user: UserRow, probeId: string, databasePath: string) {
  const details = JSON.stringify({
    probeId,
    purpose: 'verify runtime write survives stable restart',
    databasePath: normalizeDatabasePath(databasePath),
    generatedAt: new Date().toISOString(),
  });

  await client.$executeRawUnsafe(
    `INSERT INTO audit_logs (
      user_id,
      action,
      resource,
      resource_id,
      details,
      ip_address,
      user_agent,
      created_at
    ) VALUES (?, ?, ?, NULL, ?, ?, ?, CURRENT_TIMESTAMP)`,
    user.id,
    PROBE_ACTION,
    PROBE_RESOURCE,
    details,
    '127.0.0.1',
    'runtime-write-read-restart-audit-v1',
  );

  const row = await readProbe(client, probeId);
  if (!row) {
    throw new Error(`Probe was inserted but could not be read immediately: ${probeId}`);
  }
  return row;
}

async function readProbe(client: PrismaClientType, probeId: string) {
  const rows = await client.$queryRawUnsafe<AuditLogRow[]>(
    `SELECT
      id,
      user_id,
      action,
      resource,
      resource_id,
      details,
      ip_address,
      user_agent,
      created_at
    FROM audit_logs
    WHERE action = ?
      AND resource = ?
      AND details LIKE ?
    ORDER BY id DESC
    LIMIT 1`,
    PROBE_ACTION,
    PROBE_RESOURCE,
    `%${probeId}%`,
  );
  return rows[0] || null;
}

function assertSameProbe(before: AuditLogRow, after: AuditLogRow | null, probeId: string) {
  if (!after) return [`Probe row missing after restart: ${probeId}`];
  const mismatches: string[] = [];
  for (const field of ['id', 'user_id', 'action', 'resource', 'details'] as const) {
    if (before[field] !== after[field]) {
      mismatches.push(`Probe field changed after restart: ${field}`);
    }
  }
  if (!after.details?.includes(probeId)) {
    mismatches.push(`Probe details no longer include probeId: ${probeId}`);
  }
  return mismatches;
}

async function main() {
  const generatedAt = new Date().toISOString();
  const probeId = `runtime-write-${crypto.randomUUID()}`;
  const beforeDbPath = getSqliteDbPath();
  if (!beforeDbPath || !fs.existsSync(beforeDbPath)) {
    throw new Error(`Runtime SQLite database is not available before write probe: ${beforeDbPath || 'not configured'}`);
  }
  const normalizedBeforePath = normalizeDatabasePath(beforeDbPath);

  const beforeBusinessFingerprint = await withFingerprintPrisma(
    beforeDbPath,
    client => collectBusinessDataFingerprint(client, 'before-runtime-write-restart'),
  );

  const insertedProbe = await withFingerprintPrisma(beforeDbPath, async client => {
    const user = await pickProbeUser(client);
    return insertProbe(client, user, probeId, beforeDbPath);
  });

  const immediateProbe = await withFingerprintPrisma(
    beforeDbPath,
    client => readProbe(client, probeId),
  );

  const restart = await runStartStable(ROOT, START_TIMEOUT_MS);
  const afterDbPath = getSqliteDbPath();
  const normalizedAfterPath = afterDbPath ? normalizeDatabasePath(afterDbPath) : null;

  let runtimeChecks: RuntimeCheck[] = [];
  let afterProbe: AuditLogRow | null = null;
  let afterBusinessFingerprint = beforeBusinessFingerprint;
  let fingerprintMismatches: ReturnType<typeof compareBusinessDataFingerprints> = [];

  if (restart.exitCode === 0 && !restart.timedOut) {
    await waitForRuntime(APP_URL, RUNTIME_READY_TIMEOUT_MS, REQUEST_TIMEOUT_MS);
    runtimeChecks = await collectRuntimeResourceChecks(APP_URL, REQUEST_TIMEOUT_MS);

    if (!afterDbPath || !fs.existsSync(afterDbPath)) {
      throw new Error(`Runtime SQLite database is not available after restart: ${afterDbPath || 'not configured'}`);
    }

    afterProbe = await withFingerprintPrisma(
      afterDbPath,
      client => readProbe(client, probeId),
    );
    afterBusinessFingerprint = await withFingerprintPrisma(
      afterDbPath,
      client => collectBusinessDataFingerprint(client, 'after-runtime-write-restart'),
    );
    fingerprintMismatches = compareBusinessDataFingerprints(beforeBusinessFingerprint, afterBusinessFingerprint);
  }

  const failedRuntimeChecks = runtimeChecks.filter(check => !check.ok);
  const probeMismatches = assertSameProbe(insertedProbe, afterProbe, probeId);
  const immediateReadBack = Boolean(immediateProbe && immediateProbe.id === insertedProbe.id);
  const restartReadBack = probeMismatches.length === 0;
  const databasePathChanged = normalizedBeforePath !== normalizedAfterPath;
  const failed = restart.exitCode !== 0
    || restart.timedOut
    || databasePathChanged
    || !immediateReadBack
    || !restartReadBack
    || fingerprintMismatches.length > 0
    || failedRuntimeChecks.length > 0;

  const report = {
    name: 'Runtime Write Read Restart Audit',
    version: '1.0',
    generatedAt,
    status: failed ? 'failed' : 'passed',
    appUrl: APP_URL,
    probeId,
    beforeDbPath: normalizedBeforePath,
    afterDbPath: normalizedAfterPath,
    databasePathChanged,
    insertedProbe,
    immediateProbe,
    afterProbe,
    probeMismatches,
    beforeBusinessFingerprint,
    afterBusinessFingerprint,
    fingerprintMismatches,
    restart,
    runtimeChecks,
    failedRuntimeChecks,
    summary: {
      databasePathBefore: normalizedBeforePath,
      databasePathAfter: normalizedAfterPath,
      databasePathChanged,
      probeId,
      probeRowId: insertedProbe.id,
      immediateReadBack,
      restartReadBack,
      probeMismatches: probeMismatches.length,
      comparedBusinessTables: beforeBusinessFingerprint.tableCount,
      beforeBusinessHash: beforeBusinessFingerprint.hash,
      afterBusinessHash: afterBusinessFingerprint.hash,
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
