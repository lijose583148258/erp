const fs = require('fs');
const path = require('path');
const { ensureUiAuditUser } = require('./lib/ui-audit-user.cjs');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const API_BASE = `${APP_URL.replace(/\/$/, '')}/api`;
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'audit');
const REPORT_PATH = path.join(OUTPUT_DIR, 'system-backup-restore-concurrency-audit-v1.json');
const REQUEST_TIMEOUT_MS = 30_000;

const report = {
  name: 'system-backup-restore-concurrency-audit-v1',
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  status: 'running',
  steps: [],
};

function record(step) {
  report.steps.push({ at: new Date().toISOString(), ...step });
}

async function apiFetch(pathname, options = {}, token = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);
  try {
    const headers = {
      ...(options.data !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    };
    const response = await fetch(`${API_BASE}${pathname}`, {
      method: options.method || 'GET',
      headers,
      body: options.data !== undefined ? JSON.stringify(options.data) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { status: response.status, ok: response.ok, json };
  } finally {
    clearTimeout(timer);
  }
}

async function loginAdmin() {
  const account = await ensureUiAuditUser({
    username: process.env.AUDIT_UI_USERNAME || 'ui_backup_restore_admin',
    password: process.env.AUDIT_UI_PASSWORD || 'AuditSmoke12345!',
    role: 'admin',
  });
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    data: { username: account.username, password: account.password, role: 'admin' },
  });
  if (response.status !== 200 || !response.json?.data?.token) {
    throw new Error(`admin login failed: HTTP ${response.status}`);
  }
  record({ step: 'login-admin', result: 'passed' });
  return { token: response.json.data.token, account };
}

async function createBackup(token, label) {
  const response = await apiFetch('/system/backups', { method: 'POST', timeoutMs: 60_000 }, token);
  if (response.status !== 201 || !response.json?.data?.fileName) {
    throw new Error(`${label} backup failed: HTTP ${response.status} ${response.json?.message || ''}`);
  }
  record({ step: label, result: 'passed', fileName: response.json.data.fileName });
  return response.json.data.fileName;
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  try {
    const { token, account } = await loginAdmin();
    const baseBackup = await createBackup(token, 'create-base-backup');

    const started = Date.now();
    const [backupResult, restoreResult] = await Promise.all([
      apiFetch('/system/backups', { method: 'POST', timeoutMs: 60_000 }, token),
      apiFetch('/system/restore', { method: 'POST', data: { fileName: baseBackup }, timeoutMs: 60_000 }, token),
    ]);

    const statuses = [backupResult.status, restoreResult.status];
    const successCount = statuses.filter(status => status === 200 || status === 201).length;
    const conflictCount = statuses.filter(status => status === 409).length;
    if (successCount !== 1 || conflictCount !== 1) {
      throw new Error(`backup/restore mutual exclusion failed: ${statuses.join(', ')}`);
    }

    record({
      step: 'concurrent-backup-restore-mutual-exclusion',
      result: 'passed',
      durationMs: Date.now() - started,
      statuses,
      backupMessage: backupResult.json?.message || null,
      restoreMessage: restoreResult.json?.message || null,
    });

    const health = await fetch(`${APP_URL.replace(/\/$/, '')}/api/health`);
    const healthJson = await health.json();
    if (health.status !== 200 || healthJson.status !== 'ok') {
      throw new Error(`health failed after concurrent backup/restore: HTTP ${health.status}`);
    }
    record({ step: 'health-after-concurrency', result: 'passed', health: healthJson });

    const relogin = await apiFetch('/auth/login', {
      method: 'POST',
      data: { username: account.username, password: account.password, role: 'admin' },
    });
    if (relogin.status !== 200 || !relogin.json?.data?.token) {
      throw new Error(`login after concurrent backup/restore failed: HTTP ${relogin.status}`);
    }
    record({ step: 'login-after-concurrency', result: 'passed' });

    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error?.message || error);
    report.stack = error?.stack || null;
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ status: report.status, reportPath: REPORT_PATH, error: report.error || null }, null, 2));
  }
}

main();
