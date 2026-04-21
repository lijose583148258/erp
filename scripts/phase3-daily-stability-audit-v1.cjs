const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit', 'phase3-daily');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const REPORT_PATH = path.join(OUTPUT_DIR, `phase3-daily-stability-${RUN_ID}.json`);
const LEDGER_PATH = path.join(OUTPUT_DIR, 'phase3-daily-stability-ledger-v1.jsonl');
const SUMMARY_PATH = path.join(OUTPUT_DIR, 'phase3-daily-stability-ledger-v1.json');
const LEGACY_LEDGER_PATH = path.join(ROOT, 'output', 'audit', 'phase3-daily-stability-ledger-v1.jsonl');
const LEGACY_SUMMARY_PATH = path.join(ROOT, 'output', 'audit', 'phase3-daily-stability-ledger-v1.json');
const REQUEST_TIMEOUT_MS = 30_000;

const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  status: 'running',
  steps: [],
};

function recordStep(entry) {
  report.steps.push({ at: new Date().toISOString(), ...entry });
}

function toProjectPath(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join('/');
}

function normalizeStoredReportPath(value) {
  if (!value || typeof value !== 'string') return value || null;
  const normalized = value.replace(/\\/g, '/');
  const phase3Match = normalized.match(/output\/audit\/phase3-daily\/[^/]+\.json$/);
  if (phase3Match) return phase3Match[0];

  if (path.isAbsolute(value)) {
    const relative = path.relative(ROOT, value);
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
      return relative.split(path.sep).join('/');
    }
  }

  return normalized;
}

function readLedgerFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .map((entry) => ({
      ...entry,
      reportPath: normalizeStoredReportPath(entry.reportPath),
    }));
}

function readLedgerEntries() {
  const byRunId = new Map();
  for (const entry of [...readLedgerFile(LEGACY_LEDGER_PATH), ...readLedgerFile(LEDGER_PATH)]) {
    const key = entry.runId || `${entry.startedAt || ''}:${entry.reportPath || ''}`;
    byRunId.set(key, entry);
  }
  return Array.from(byRunId.values()).sort((a, b) => String(a.startedAt || '').localeCompare(String(b.startedAt || '')));
}

function countTrailingPasses(entries) {
  let count = 0;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i].status !== 'passed') break;
    count += 1;
  }
  return count;
}

function compactDailyRun(finalReport) {
  const failedSteps = finalReport.steps.filter(step => step.result !== 'passed');
  const maxStepDurationMs = finalReport.steps.reduce((max, step) => Math.max(max, step.durationMs || 0), 0);
  const systemStatus = finalReport.steps.find(step => step.step === 'system-status');
  const backupList = finalReport.steps.find(step => step.step === 'backup-list');
  const health = finalReport.steps.find(step => step.step === 'health');

  return {
    runId: finalReport.runId,
    appUrl: finalReport.appUrl,
    startedAt: finalReport.startedAt,
    finishedAt: finalReport.finishedAt,
    status: finalReport.status,
    durationMs: Date.parse(finalReport.finishedAt) - Date.parse(finalReport.startedAt),
    stepCount: finalReport.steps.length,
    failedStepCount: failedSteps.length,
    failedSteps: failedSteps.map(step => step.step),
    maxStepDurationMs,
    runtimeMode: health?.mode || null,
    uptime: health?.uptime || null,
    databaseType: systemStatus?.databaseType || null,
    databaseExists: systemStatus?.databaseExists ?? null,
    backupCount: backupList?.backupCount ?? systemStatus?.backupCount ?? null,
    reportPath: toProjectPath(REPORT_PATH),
  };
}

function writeLedger(finalReport) {
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.mkdirSync(path.dirname(LEGACY_LEDGER_PATH), { recursive: true });
  const entry = compactDailyRun(finalReport);
  const entries = [
    ...readLedgerEntries().filter(item => item.runId !== entry.runId),
    entry,
  ].sort((a, b) => String(a.startedAt || '').localeCompare(String(b.startedAt || '')));
  const ledgerBody = `${entries.map(item => JSON.stringify(item)).join('\n')}\n`;
  fs.writeFileSync(LEDGER_PATH, ledgerBody, 'utf8');

  const failedEntries = entries.filter(item => item.status !== 'passed');
  const summary = {
    generatedAt: new Date().toISOString(),
    ledgerPath: toProjectPath(LEDGER_PATH),
    legacyLedgerPath: toProjectPath(LEGACY_LEDGER_PATH),
    totalRuns: entries.length,
    passedRuns: entries.filter(item => item.status === 'passed').length,
    failedRuns: failedEntries.length,
    consecutivePasses: countTrailingPasses(entries),
    latestStatus: entries.at(-1)?.status || 'unknown',
    latestRunId: entries.at(-1)?.runId || null,
    latestReportPath: entries.at(-1)?.reportPath || null,
    lastFailureAt: failedEntries.at(-1)?.finishedAt || null,
    maxStepDurationMs: entries.reduce((max, item) => Math.max(max, item.maxStepDurationMs || 0), 0),
  };
  fs.writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  fs.writeFileSync(LEGACY_SUMMARY_PATH, `${JSON.stringify({
    ...summary,
    canonicalLedgerPath: summary.ledgerPath,
    canonicalSummaryPath: toProjectPath(SUMMARY_PATH),
  }, null, 2)}\n`, 'utf8');
  if (LEGACY_LEDGER_PATH !== LEDGER_PATH) {
    fs.appendFileSync(LEGACY_LEDGER_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
  }
  finalReport.ledger = {
    appended: true,
    ledgerPath: toProjectPath(LEDGER_PATH),
    summaryPath: toProjectPath(SUMMARY_PATH),
    consecutivePasses: summary.consecutivePasses,
    totalRuns: summary.totalRuns,
  };
}

async function withTimeout(label, fn, timeoutMs = REQUEST_TIMEOUT_MS) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`${label} exceeded ${timeoutMs}ms`)), timeoutMs);
  try {
    const result = await fn(controller.signal);
    recordStep({ step: label, result: 'passed', durationMs: Date.now() - started, ...result });
    return result;
  } catch (error) {
    recordStep({ step: label, result: 'failed', durationMs: Date.now() - started, error: String(error.message || error) });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function apiFetch(endpoint, options = {}, token = '') {
  const response = await fetch(`${APP_URL}api${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.data ? JSON.stringify(options.data) : undefined,
    signal: options.signal,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { ok: response.ok, status: response.status, json };
}

async function login(signal) {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    data: { username: 'admin', password: 'admin123' },
    signal,
  });
  if (!response.ok || !response.json?.data?.token) {
    throw new Error(`admin login failed: ${response.status}`);
  }
  return response.json.data;
}

async function main() {
  let admin = null;
  try {
    await withTimeout('health', async signal => {
      const response = await fetch(`${APP_URL}api/health`, { signal });
      const json = await response.json();
      if (!response.ok || json?.status !== 'ok') throw new Error(`health failed: ${response.status}`);
      return { uptime: json.uptime, mode: json.mode };
    });

    await withTimeout('login-admin', async signal => {
      admin = await login(signal);
      return { userId: admin.user?.id, role: admin.user?.role };
    });

    await withTimeout('system-status', async signal => {
      const response = await apiFetch('/system/status', { signal }, admin.token);
      if (!response.ok) throw new Error(`system status failed: ${response.status}`);
      const database = response.json?.data?.database || response.json?.data;
      return {
        databaseType: database?.databaseType,
        databaseExists: database?.databaseExists,
        backupCount: database?.backupCount,
      };
    });

    await withTimeout('backup-list', async signal => {
      const response = await apiFetch('/system/backups', { signal }, admin.token);
      if (!response.ok) throw new Error(`backup list failed: ${response.status}`);
      const backups = Array.isArray(response.json?.data) ? response.json.data : [];
      return { backupCount: backups.length };
    });

    await withTimeout('core-module-smoke', async signal => {
      const endpoints = [
        '/customers?pageSize=1',
        '/orders?pageSize=1',
        '/procurement/suppliers?pageSize=1',
        '/warehouses',
        '/shipping?pageSize=1',
      ];
      const results = [];
      for (const endpoint of endpoints) {
        const response = await apiFetch(endpoint, { signal }, admin.token);
        results.push({ endpoint, status: response.status });
        if (!response.ok) throw new Error(`${endpoint} failed: ${response.status}`);
      }
      return { endpoints: results };
    }, 60_000);

    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error.message || error);
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    writeLedger(report);
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  if (report.status !== 'passed') {
    console.error(report.error || 'Phase 3 daily stability audit failed');
    process.exitCode = 1;
    return;
  }
  console.log(`Phase 3 daily stability audit passed. Report: ${toProjectPath(REPORT_PATH)}`);
}

main();
