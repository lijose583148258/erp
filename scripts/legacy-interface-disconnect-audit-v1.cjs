const fs = require('fs');
const path = require('path');
const { ensureUiAuditUser } = require('./lib/ui-audit-user.cjs');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'legacy-interface-disconnect-audit-report-v1.json');
const REQUEST_TIMEOUT_MS = 8000;

const ACCOUNTS = [
  { role: 'admin', username: 'legacy_admin_audit', password: 'AuditLegacyAdmin123!' },
  { role: 'manager', username: 'legacy_manager_audit', password: 'AuditLegacyManager123!' },
  { role: 'sales', username: 'legacy_sales_audit', password: 'AuditLegacySales123!' },
];

const LEGACY_ENDPOINTS = [
  {
    label: 'legacy-timber-calculate',
    method: 'POST',
    endpoint: '/timber/calculate',
    body: { length: 2440, width: 1220, thickness: 18, pieces: 10 },
    roles: ['anonymous', 'admin'],
  },
  {
    label: 'legacy-timber-summary',
    method: 'GET',
    endpoint: '/timber/summary',
    roles: ['anonymous', 'admin', 'manager', 'sales'],
  },
  {
    label: 'legacy-timber-convert-po',
    method: 'POST',
    endpoint: '/timber/convert-po',
    body: { orderItemId: 1, supplierId: 1 },
    roles: ['anonymous', 'admin', 'manager'],
  },
];

const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  status: 'running',
  endpoints: LEGACY_ENDPOINTS.map(item => ({ label: item.label, endpoint: item.endpoint, expectedStatus: 410 })),
  steps: [],
};

function pushStep(step) {
  report.steps.push({ at: new Date().toISOString(), ...step });
}

async function withTimeout(label, fn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`${label} timed out after ${REQUEST_TIMEOUT_MS}ms`)), REQUEST_TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function apiJson(endpoint, options = {}) {
  return withTimeout(endpoint, async (signal) => {
    const response = await fetch(`${APP_URL}api${endpoint}`, {
      method: options.method || 'GET',
      headers: {
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal,
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text.slice(0, 200) };
    }
    return { status: response.status, json };
  });
}

async function login(account) {
  await ensureUiAuditUser(account);
  const response = await apiJson('/auth/login', {
    method: 'POST',
    body: { username: account.username, password: account.password },
  });
  if (response.status !== 200 || !response.json?.data?.token) {
    throw new Error(`login failed for ${account.role}: ${response.status} ${JSON.stringify(response.json)}`);
  }
  return response.json.data.token;
}

function assertGone(result, context) {
  if (result.status !== 410) {
    throw new Error(`${context} expected 410 but got ${result.status}: ${JSON.stringify(result.json)}`);
  }
  if (result.json?.code !== 'LEGACY_TIMBER_API_DISABLED') {
    throw new Error(`${context} returned 410 without LEGACY_TIMBER_API_DISABLED marker: ${JSON.stringify(result.json)}`);
  }
  if (result.json?.replacement !== '/api/barter') {
    throw new Error(`${context} missing replacement /api/barter: ${JSON.stringify(result.json)}`);
  }
}

async function run() {
  try {
    const tokens = { anonymous: '' };
    for (const account of ACCOUNTS) {
      tokens[account.role] = await login(account);
    }
    pushStep({ step: 'login-test-roles', result: 'passed', roles: Object.keys(tokens) });

    for (const endpoint of LEGACY_ENDPOINTS) {
      for (const role of endpoint.roles) {
        const result = await apiJson(endpoint.endpoint, {
          method: endpoint.method,
          body: endpoint.body,
          token: tokens[role],
        });
        assertGone(result, `${endpoint.label} ${role}`);
        pushStep({
          step: endpoint.label,
          role,
          expected: 410,
          actual: result.status,
          marker: result.json?.code,
          replacement: result.json?.replacement,
          result: 'passed',
        });
      }
    }

    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error.message || error);
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  }

  if (report.status !== 'passed') {
    console.error(report.error || 'Legacy interface disconnect audit failed');
    process.exit(1);
  }

  console.log(JSON.stringify({
    status: report.status,
    steps: report.steps.length,
    reportPath: REPORT_PATH,
  }, null, 2));
}

run();
