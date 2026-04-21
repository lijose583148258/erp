const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit', 'phase3-daily');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const REPORT_PATH = path.join(OUTPUT_DIR, `phase3-daily-stability-${RUN_ID}.json`);
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
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  if (report.status !== 'passed') {
    console.error(report.error || 'Phase 3 daily stability audit failed');
    process.exitCode = 1;
    return;
  }
  console.log(`Phase 3 daily stability audit passed. Report: ${REPORT_PATH}`);
}

main();
