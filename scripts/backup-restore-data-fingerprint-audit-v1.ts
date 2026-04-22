import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import {
  collectBusinessDataFingerprint,
  compareBusinessDataFingerprints,
  normalizeDatabasePath,
  withFingerprintPrisma,
} from './lib/business-data-fingerprint';

const ROOT = process.cwd();
const requireFromScript = createRequire(import.meta.url);
const { getBackupDir, getSqliteDbPath } = requireFromScript('../backend/src/config/runtime.ts') as {
  getBackupDir: () => string;
  getSqliteDbPath: () => string | null;
};

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/+$/, '/');
const REQUEST_TIMEOUT_MS = Number(process.env.AUDIT_REQUEST_TIMEOUT_MS || 10000);
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'backup-restore-data-fingerprint-audit-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'backup-restore-data-fingerprint-audit-v1.md');

type ApiResponse = {
  ok: boolean;
  status: number;
  json: any;
};

async function apiFetch(endpoint: string, options: { method?: string; data?: unknown } = {}, token = ''): Promise<ApiResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${APP_URL}api${endpoint}`, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.data ? JSON.stringify(options.data) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { ok: response.ok, status: response.status, json };
  } finally {
    clearTimeout(timer);
  }
}

async function login() {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    data: { username: 'admin', password: 'admin123' },
  });

  if (!response.ok) {
    throw new Error(`Login failed: HTTP ${response.status}`);
  }

  const token = response.json?.data?.token;
  if (!token) {
    throw new Error('Login response does not include a token');
  }
  return token as string;
}

async function createBackup(token: string) {
  const response = await apiFetch('/system/backups', { method: 'POST' }, token);
  if (!response.ok) {
    throw new Error(`Create backup failed: HTTP ${response.status}`);
  }
  const fileName = response.json?.data?.fileName;
  if (!fileName) {
    throw new Error('Create backup response does not include fileName');
  }
  return String(fileName);
}

async function restoreBackup(token: string, fileName: string) {
  const response = await apiFetch('/system/restore', {
    method: 'POST',
    data: { fileName },
  }, token);
  if (!response.ok) {
    throw new Error(`Restore backup failed: HTTP ${response.status} ${response.json?.message || ''}`);
  }
  const integrity = response.json?.data?.integrity;
  if (!integrity?.manifestExists || !integrity?.verified) {
    throw new Error(`Restore did not verify backup manifest: ${fileName}`);
  }
  return integrity;
}

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

  const token = await login();
  const backupFileName = await createBackup(token);
  const backupPath = path.join(getBackupDir(), backupFileName);
  if (!fs.existsSync(backupPath)) {
    throw new Error(`Created backup file was not found: ${backupPath}`);
  }

  const backupFingerprint = await withFingerprintPrisma(
    backupPath,
    client => collectBusinessDataFingerprint(client, 'backup-file'),
  );
  const restoreIntegrity = await restoreBackup(token, backupFileName);
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
