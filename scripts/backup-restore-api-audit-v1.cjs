const fs = require('fs');
const path = require('path');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/+$/, '/');
const REQUEST_TIMEOUT_MS = Number(process.env.AUDIT_REQUEST_TIMEOUT_MS || 10000);
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'backup-restore-api-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

const report = {
  name: 'Backup Restore API Audit',
  version: '1.2',
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
  steps: [],
  status: 'running',
};

function recordStep(entry) {
  report.steps.push({ at: new Date().toISOString(), ...entry });
}

function extractDatabaseStatus(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.data && payload.data.database) return payload.data.database;
  return payload.data || null;
}

async function apiFetch(endpoint, options = {}, token = '') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${APP_URL}api${endpoint}`, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
      body: options.data ? JSON.stringify(options.data) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }

    return { ok: response.ok, status: response.status, json };
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms: ${endpoint}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function login(username, password) {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    data: { username, password },
  });

  if (!response.ok) {
    throw new Error(`Login failed (${username}): HTTP ${response.status}`);
  }

  const data = response.json?.data;
  if (!data?.token || !data?.user?.id) {
    throw new Error(`Login response is incomplete (${username})`);
  }

  return data;
}

async function run() {
  try {
    const admin = await login('admin', 'admin123');
    recordStep({ step: 'login-admin', result: 'passed', userId: admin.user.id });

    const statusBefore = await apiFetch('/system/status', {}, admin.token);
    if (!statusBefore.ok) {
      throw new Error(`System status before backup failed: HTTP ${statusBefore.status}`);
    }

    const dbStatus = extractDatabaseStatus(statusBefore.json);
    if (!dbStatus?.databaseExists) {
      throw new Error('Runtime database does not exist before backup');
    }

    report.statusBefore = {
      databaseType: dbStatus.databaseType,
      databaseExists: dbStatus.databaseExists,
      databaseSize: dbStatus.databaseSize,
      backupCount: dbStatus.backupCount,
      latestBackup: dbStatus.latestBackup?.filename || null,
    };
    recordStep({ step: 'get-system-status-before', result: 'passed', databaseType: dbStatus.databaseType });

    const createBackup = await apiFetch('/system/backups', { method: 'POST' }, admin.token);
    if (!createBackup.ok) {
      throw new Error(`Create backup failed: HTTP ${createBackup.status}`);
    }

    const backupFileName = createBackup.json?.data?.fileName;
    if (!backupFileName) {
      throw new Error('Backup creation response did not include fileName');
    }

    report.createdBackup = backupFileName;
    recordStep({ step: 'create-backup', result: 'passed', fileName: backupFileName });

    const listBackups = await apiFetch('/system/backups', {}, admin.token);
    if (!listBackups.ok) {
      throw new Error(`List backups failed: HTTP ${listBackups.status}`);
    }

    const backups = listBackups.json?.data;
    if (!Array.isArray(backups)) {
      throw new Error('Backup list response is not an array');
    }

    const found = backups.find(item => item.filename === backupFileName);
    if (!found) {
      throw new Error(`Created backup was not found in list: ${backupFileName}`);
    }
    if (!found.manifestExists || !found.checksumSha256) {
      throw new Error(`Created backup does not have integrity manifest evidence: ${backupFileName}`);
    }
    report.createdBackupIntegrity = {
      manifestExists: Boolean(found.manifestExists),
      checksumSha256: found.checksumSha256,
      size: found.size,
    };
    recordStep({
      step: 'verify-backup-in-list',
      result: 'passed',
      totalBackups: backups.length,
      manifestExists: found.manifestExists,
      checksumSha256: found.checksumSha256,
    });

    const restoreResult = await apiFetch('/system/restore', {
      method: 'POST',
      data: { fileName: backupFileName },
    }, admin.token);
    if (!restoreResult.ok) {
      throw new Error(`Restore backup failed: HTTP ${restoreResult.status} ${restoreResult.json?.message || ''}`);
    }
    const restoreIntegrity = restoreResult.json?.data?.integrity;
    if (!restoreIntegrity?.manifestExists || !restoreIntegrity?.verified) {
      throw new Error(`Restore did not verify backup manifest: ${backupFileName}`);
    }
    recordStep({
      step: 'restore-from-backup',
      result: 'passed',
      restoredFrom: backupFileName,
      manifestVerified: restoreIntegrity.verified,
      verifiedFiles: Array.isArray(restoreIntegrity.files) ? restoreIntegrity.files.length : 0,
    });

    const statusAfter = await apiFetch('/system/status', {}, admin.token);
    if (!statusAfter.ok) {
      throw new Error(`System status after restore failed: HTTP ${statusAfter.status}`);
    }

    const dbAfter = extractDatabaseStatus(statusAfter.json);
    if (!dbAfter?.databaseExists) {
      throw new Error('Runtime database does not exist after restore');
    }

    report.statusAfter = {
      databaseType: dbAfter.databaseType,
      databaseExists: dbAfter.databaseExists,
      databaseSize: dbAfter.databaseSize,
      backupCount: dbAfter.backupCount,
      latestBackup: dbAfter.latestBackup?.filename || null,
    };
    recordStep({ step: 'get-system-status-after', result: 'passed', databaseExists: dbAfter.databaseExists });

    const loginAfterRestore = await login('admin', 'admin123');
    recordStep({ step: 'verify-login-after-restore', result: 'passed', userId: loginAfterRestore.user.id });

    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error.message || error);
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  if (report.status !== 'passed') {
    console.error(report.error || 'Backup/restore API audit failed');
    console.error(`Report: ${REPORT_PATH}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Backup/restore API audit passed. Report: ${REPORT_PATH}`);
}

run();
