const fs = require('fs');
const path = require('path');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'backup-retention-governance-audit-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'backup-retention-governance-audit-v1.md');
const REQUEST_TIMEOUT_MS = 8000;

const report = {
  appUrl: APP_URL,
  generatedAt: new Date().toISOString(),
  status: 'running',
  checks: [],
  findings: [],
};

function addCheck(entry) {
  report.checks.push({ at: new Date().toISOString(), ...entry });
}

function addFinding(level, area, message, evidence = {}) {
  report.findings.push({ level, area, message, evidence });
}

function readText(relativePath) {
  const fullPath = path.join(process.cwd(), relativePath);
  if (!fs.existsSync(fullPath)) return '';
  return fs.readFileSync(fullPath, 'utf8');
}

async function apiFetch(endpoint, options = {}, token = '') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Timeout after ${REQUEST_TIMEOUT_MS}ms`)), REQUEST_TIMEOUT_MS);
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
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text.slice(0, 300) };
    }
    return { ok: response.ok, status: response.status, json };
  } finally {
    clearTimeout(timeout);
  }
}

async function loginAdmin() {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    data: { username: 'admin', password: 'admin123' },
  });
  if (!response.ok || !response.json?.data?.token) {
    throw new Error(`admin login failed: ${response.status} ${JSON.stringify(response.json)}`);
  }
  return response.json.data.token;
}

function checkSourceGuardrails() {
  const backupService = readText('backend/src/services/backup.service.ts');
  const envExample = readText('.env.production.example');
  const compose = readText('docker-compose.yml');

  for (const token of ['BACKUP_RETENTION_MODE', 'BACKUP_MAX_FILES', 'BACKUP_MAX_TOTAL_MB', 'backupTotalSize', 'backupDirectoryStats', 'backupRetention']) {
    if (!backupService.includes(token)) {
      addFinding('P0', 'source-guardrail', `backup service missing ${token}`);
    }
  }
  for (const token of ['BACKUP_RETENTION_MODE=report-only', 'BACKUP_MAX_FILES=800', 'BACKUP_MAX_TOTAL_MB=8192']) {
    if (!envExample.includes(token)) {
      addFinding('P1', 'production-env', `.env.production.example missing ${token}`);
    }
  }
  for (const token of ['BACKUP_RETENTION_MODE: ${BACKUP_RETENTION_MODE:-report-only}', 'BACKUP_MAX_FILES: ${BACKUP_MAX_FILES:-800}', 'BACKUP_MAX_TOTAL_MB: ${BACKUP_MAX_TOTAL_MB:-8192}']) {
    if (!compose.includes(token)) {
      addFinding('P1', 'docker-compose', `docker-compose.yml missing ${token}`);
    }
  }
  addCheck({ step: 'source-guardrails', result: 'checked' });
}

async function checkRuntimeBackupPolicy() {
  const token = await loginAdmin();
  const response = await apiFetch('/system/status', {}, token);
  if (!response.ok) {
    throw new Error(`system status failed: ${response.status} ${JSON.stringify(response.json)}`);
  }

  const database = response.json?.data?.database || {};
  const stats = database.backupDirectoryStats || {};
  const retention = database.backupRetention || {};
  const totalMB = Number(database.backupTotalSize || 0) / 1024 / 1024;

  if (typeof database.backupTotalSize !== 'number' || !database.backupDirectoryStats || !database.backupRetention) {
    addFinding('P0', 'runtime-status', 'system status missing backup retention telemetry', { database });
  }
  if (!retention.maxFiles || !retention.maxTotalMB) {
    addFinding('P2', 'runtime-policy', 'active runtime has not enabled count/size backup guardrails; existing files are intentionally not deleted without explicit configuration', {
      maxFiles: retention.maxFiles ?? null,
      maxTotalMB: retention.maxTotalMB ?? null,
    });
  }
  if (retention.mode !== 'report-only' && retention.mode !== 'enforce') {
    addFinding('P1', 'runtime-policy', 'active runtime has not declared backup retention mode', {
      mode: retention.mode ?? null,
    });
  }
  if (retention.mode === 'enforce') {
    addFinding('P2', 'runtime-policy', 'backup retention is in enforce mode; confirm off-machine backup coverage before long local soak', {
      mode: retention.mode,
    });
  }
  if (Number(database.backupCount || 0) >= 700) {
    addFinding('P1', 'runtime-growth', 'backup count is approaching the recommended 800-file guardrail', {
      backupCount: database.backupCount,
    });
  }
  if (totalMB >= 6144) {
    addFinding('P1', 'runtime-growth', 'backup directory is approaching the recommended 8192MB guardrail', {
      backupTotalMB: Number(totalMB.toFixed(2)),
    });
  }

  addCheck({
    step: 'runtime-backup-telemetry',
    result: 'checked',
    backupDir: database.backupDir,
    backupCount: database.backupCount,
    backupTotalMB: Number(totalMB.toFixed(2)),
    backupDirectoryStats: stats,
    backupRetention: retention,
  });
}

function writeReports() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const hasP0 = report.findings.some(finding => finding.level === 'P0');
  report.status = hasP0 ? 'failed' : report.findings.length ? 'warning' : 'passed';
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const lines = [
    '# Backup Retention Governance Audit v1',
    '',
    `- status: ${report.status}`,
    `- generated: ${report.generatedAt}`,
    `- findings: ${report.findings.length}`,
    '',
    '## Checks',
  ];
  for (const check of report.checks) {
    lines.push(`- ${check.step}: ${check.result}`);
  }
  lines.push('', '## Findings');
  if (report.findings.length === 0) lines.push('- none');
  for (const finding of report.findings) {
    lines.push(`- ${finding.level} ${finding.area}: ${finding.message}`);
  }
  fs.writeFileSync(MD_REPORT, `${lines.join('\n')}\n`, 'utf8');
}

async function main() {
  try {
    checkSourceGuardrails();
    await checkRuntimeBackupPolicy();
  } catch (error) {
    addFinding('P0', 'audit-runtime', error.message || String(error));
  } finally {
    writeReports();
    console.log(JSON.stringify({
      status: report.status,
      findings: report.findings.length,
      jsonReport: JSON_REPORT,
      markdownReport: MD_REPORT,
    }, null, 2));
    if (report.status === 'failed') process.exitCode = 1;
  }
}

main();
