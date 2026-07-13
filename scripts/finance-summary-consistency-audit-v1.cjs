const fs = require('fs');
const path = require('path');
const { ensureUiAuditUser } = require('./lib/ui-audit-user.cjs');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001').replace(/\/$/, '');
const OUTPUT_DIR = path.resolve(process.cwd(), 'output', 'audit');
const REPORT_PATH = path.join(OUTPUT_DIR, 'finance-summary-consistency-audit-v1.json');
const TIMEOUT_MS = Number(process.env.AILAODA_AUDIT_REQUEST_TIMEOUT_MS || 20_000);
const EPSILON = Number(process.env.AILAODA_FINANCE_AUDIT_EPSILON || 1);

const report = {
  name: 'finance-summary-consistency-audit-v1',
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  status: 'running',
  checks: [],
  failure: null,
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeReport() {
  ensureDir(OUTPUT_DIR);
  report.finishedAt = new Date().toISOString();
  report.durationMs = new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime();
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function recordCheck(name, result, extra = {}) {
  report.checks.push({
    at: new Date().toISOString(),
    name,
    result,
    ...extra,
  });
}

async function requestJson(pathname, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${APP_URL}${pathname}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`${pathname} returned non-json response: ${text.slice(0, 120)}`);
    }
    return { status: response.status, ok: response.ok, json };
  } finally {
    clearTimeout(timer);
  }
}

function dataOf(response) {
  return response?.json?.data || response?.json || {};
}

function num(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function assert(condition, message, extra = {}) {
  if (!condition) {
    const error = new Error(message);
    error.extra = extra;
    throw error;
  }
}

function assertNear(name, left, right, epsilon = EPSILON) {
  const diff = Math.abs(num(left) - num(right));
  const passed = diff <= epsilon;
  recordCheck(name, passed ? 'passed' : 'failed', {
    left: num(left),
    right: num(right),
    diff,
    epsilon,
  });
  assert(passed, `${name} mismatch`, { left, right, diff, epsilon });
}

async function login() {
  const account = {
    username: 'finance_summary_audit_admin',
    password: 'FinanceSummaryAudit123!',
    role: 'admin',
  };
  await ensureUiAuditUser(account);
  const response = await requestJson('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      username: account.username,
      password: account.password,
      role: account.role,
    }),
  });
  assert(response.ok, 'finance audit login failed', { status: response.status, json: response.json });
  const token = response.json?.data?.token;
  assert(Boolean(token), 'finance audit login returned empty token', response.json);
  recordCheck('finance-audit-login', 'passed', { status: response.status, username: account.username });
  return token;
}

async function authedGet(pathname, token) {
  const response = await requestJson(pathname, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(response.ok, `${pathname} failed`, { status: response.status, json: response.json });
  recordCheck(`get-${pathname}`, 'passed', { status: response.status });
  return dataOf(response);
}

(async () => {
  try {
    const token = await login();
    const [finance, dashboard, collections] = await Promise.all([
      authedGet('/api/finance/summary', token),
      authedGet('/api/dashboard', token),
      authedGet('/api/collections/summary', token),
    ]);

    const financeOverview = finance.overview || {};
    const dashboardOverview = dashboard.overview || {};

    recordCheck('finance-positive-totals', 'passed', {
      totalRevenue: num(financeOverview.totalRevenue),
      totalReceived: num(financeOverview.totalReceived),
      totalReceivable: num(financeOverview.totalReceivable),
    });
    assert(num(financeOverview.totalRevenue) > 0, 'finance totalRevenue should be positive', financeOverview);
    assert(num(financeOverview.totalReceivable) >= 0, 'finance totalReceivable should not be negative', financeOverview);
    assert(num(financeOverview.totalReceived) >= 0, 'finance totalReceived should not be negative', financeOverview);

    assertNear('finance-vs-dashboard-totalRevenue', financeOverview.totalRevenue, dashboardOverview.totalRevenue);
    assertNear('finance-vs-collections-totalReceivable', financeOverview.totalReceivable, collections.totalReceivable);
    assertNear('finance-vs-collections-totalPaid', financeOverview.totalReceived, collections.totalPaid);
    assertNear('finance-vs-collections-overdueAmount', financeOverview.overdueAmount, collections.overdueAmount);

    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.failure = {
      message: String(error?.message || error),
      extra: error?.extra || null,
      stack: error?.stack || null,
    };
    process.exitCode = 1;
  } finally {
    writeReport();
    console.log(JSON.stringify({
      status: report.status,
      reportPath: REPORT_PATH,
      checks: report.checks.length,
      failure: report.failure,
    }, null, 2));
  }
})();
