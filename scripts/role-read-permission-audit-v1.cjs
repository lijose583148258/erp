/**
 * Role read-permission audit for active ERP routes.
 *
 * Purpose:
 * - Verify route-level read guards match the visible module menu.
 * - Catch "authenticated but not authorized" leaks before browser testing.
 */
const fs = require('fs');
const path = require('path');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'role-read-permission-audit-report-v1.json');
const REQUEST_TIMEOUT_MS = 8000;

const ACCOUNTS = {
  admin: { username: 'admin', password: 'admin123' },
  manager: { username: 'manager', password: 'manager123' },
  sales: { username: 'sales', password: 'sales123' },
  finance: { username: 'finance', password: 'finance123' },
  warehouse: { username: 'warehouse', password: 'warehouse123' },
};

const MATRIX = [
  { label: 'orders-list', endpoint: '/orders?pageSize=1', allow: ['admin', 'manager', 'sales', 'finance'], deny: ['warehouse'], allowStatuses: [200] },
  { label: 'orders-stats', endpoint: '/orders/stats', allow: ['admin', 'manager', 'sales', 'finance'], deny: ['warehouse'], allowStatuses: [200] },
  { label: 'orders-export', endpoint: '/orders/export', allow: ['admin', 'manager', 'sales', 'finance'], deny: ['warehouse'], allowStatuses: [200] },
  { label: 'orders-detail-missing', endpoint: '/orders/999999999', allow: ['admin', 'manager', 'sales', 'finance'], deny: ['warehouse'], allowStatuses: [404] },

  { label: 'contracts-list', endpoint: '/contracts?pageSize=1', allow: ['admin', 'manager', 'sales', 'finance'], deny: ['warehouse'], allowStatuses: [200] },
  { label: 'contracts-detail-missing', endpoint: '/contracts/999999999', allow: ['admin', 'manager', 'sales', 'finance'], deny: ['warehouse'], allowStatuses: [404] },

  { label: 'shipping-list', endpoint: '/shipping?pageSize=1', allow: ['admin', 'manager', 'sales', 'warehouse'], deny: ['finance'], allowStatuses: [200] },
  { label: 'rma-list', endpoint: '/rma?pageSize=1', allow: ['admin', 'manager', 'sales'], deny: ['finance', 'warehouse'], allowStatuses: [200] },
  { label: 'samples-list', endpoint: '/samples?pageSize=1', allow: ['admin', 'manager', 'sales', 'warehouse'], deny: ['finance'], allowStatuses: [200] },

  { label: 'dashboard-summary', endpoint: '/dashboard', allow: ['admin', 'manager', 'sales', 'warehouse', 'finance'], deny: [], allowStatuses: [200] },
  { label: 'dashboard-trends', endpoint: '/dashboard/trends', allow: ['admin', 'manager', 'sales', 'warehouse', 'finance'], deny: [], allowStatuses: [200] },
  { label: 'procurement-suppliers', endpoint: '/procurement/suppliers?pageSize=1', allow: ['admin', 'manager', 'warehouse', 'finance'], deny: ['sales'], allowStatuses: [200] },
  {
    label: 'legacy-timber-summary-disabled',
    endpoint: '/timber/summary',
    disabled: ['admin', 'manager', 'sales', 'warehouse', 'finance'],
    disabledStatuses: [410],
  },
];

const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  status: 'running',
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

async function apiStatus(endpoint, token, options = {}) {
  return withTimeout(endpoint, async (signal) => {
    const response = await fetch(`${APP_URL}api${endpoint}`, {
      method: options.method || 'GET',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal,
    });
    return response.status;
  });
}

async function apiJson(endpoint, token, options = {}) {
  return withTimeout(endpoint, async (signal) => {
    const response = await fetch(`${APP_URL}api${endpoint}`, {
      method: options.method || 'GET',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

async function login(role) {
  const account = ACCOUNTS[role];
  const response = await apiJson('/auth/login', '', {
    method: 'POST',
    body: { username: account.username, password: account.password },
  });
  if (response.status !== 200 || !response.json?.data?.token) {
    throw new Error(`login failed for ${role}: ${response.status} ${JSON.stringify(response.json)}`);
  }
  return response.json.data.token;
}

function expectStatus(actual, expectedStatuses, label) {
  if (!expectedStatuses.includes(actual)) {
    throw new Error(`${label}: expected ${expectedStatuses.join('/')} but got ${actual}`);
  }
}

async function run() {
  try {
    const tokens = {};
    for (const role of Object.keys(ACCOUNTS)) {
      tokens[role] = await login(role);
    }
    pushStep({ step: 'login-all-roles', result: 'passed', roles: Object.keys(tokens) });

    for (const rule of MATRIX) {
      for (const role of rule.disabled || []) {
        const status = await apiStatus(rule.endpoint, tokens[role]);
        expectStatus(status, rule.disabledStatuses || [410], `${rule.label} disabled ${role}`);
        pushStep({ step: rule.label, role, expected: rule.disabledStatuses || [410], actual: status, result: 'passed' });
      }
      for (const role of rule.allow || []) {
        const status = await apiStatus(rule.endpoint, tokens[role]);
        expectStatus(status, rule.allowStatuses, `${rule.label} allowed ${role}`);
        pushStep({ step: rule.label, role, expected: rule.allowStatuses, actual: status, result: 'passed' });
      }
      for (const role of rule.deny || []) {
        const status = await apiStatus(rule.endpoint, tokens[role]);
        expectStatus(status, [403], `${rule.label} denied ${role}`);
        pushStep({ step: rule.label, role, expected: [403], actual: status, result: 'passed' });
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
    console.error(report.error || 'Role read-permission audit failed');
    process.exit(1);
  }

  console.log(`Role read-permission audit passed. Report: ${REPORT_PATH}`);
}

run();
