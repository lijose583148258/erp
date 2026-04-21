/**
 * Permission model audit.
 *
 * Verifies the first RBAC hardening package:
 * - Backend Casbin-compatible authorization model is loaded.
 * - Key permissions match current mature business boundaries.
 * - Frontend menu permission registry does not expose CRM to finance/warehouse.
 * - Real API endpoints return expected allow/deny statuses.
 */
const fs = require('fs');
const path = require('path');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'permission-model-audit-report-v1.json');
const REQUEST_TIMEOUT_MS = 10_000;
const SCRIPT_TIMEOUT_MS = 290_000;

const ACCOUNTS = {
  admin: { username: 'admin', password: 'admin123' },
  manager: { username: 'manager', password: 'manager123' },
  sales: { username: 'sales', password: 'sales123' },
  warehouse: { username: 'warehouse', password: 'warehouse123' },
  finance: { username: 'finance', password: 'finance123' },
};

const API_MATRIX = [
  { label: 'dashboard', endpoint: '/dashboard', allow: ['admin', 'manager', 'sales', 'warehouse', 'finance'], deny: [] },
  { label: 'customers-list', endpoint: '/customers?pageSize=1', allow: ['admin', 'manager', 'sales'], deny: ['warehouse', 'finance'] },
  { label: 'orders-list', endpoint: '/orders?pageSize=1', allow: ['admin', 'manager', 'sales', 'finance'], deny: ['warehouse'] },
  { label: 'orders-shipping-ready', endpoint: '/orders/shipping-ready', allow: ['admin', 'manager', 'warehouse'], deny: ['sales', 'finance'] },
  { label: 'procurement-suppliers', endpoint: '/procurement/suppliers?pageSize=1', allow: ['admin', 'manager', 'warehouse', 'finance'], deny: ['sales'] },
  { label: 'warehouses', endpoint: '/warehouses', allow: ['admin', 'manager', 'warehouse'], deny: ['sales', 'finance'] },
  { label: 'finance-summary', endpoint: '/finance/summary', allow: ['admin', 'manager', 'finance'], deny: ['sales', 'warehouse'] },
  { label: 'team-list', endpoint: '/team', allow: ['admin', 'manager'], deny: ['sales', 'warehouse', 'finance'] },
];

const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  status: 'running',
  steps: [],
  findings: [],
  failure: null,
};

let scriptTimer = null;

function recordStep(step) {
  report.steps.push({ at: new Date().toISOString(), ...step });
}

function fail(stage, error) {
  report.status = 'failed';
  report.failure = {
    stage,
    name: error?.name || null,
    message: error?.message || String(error),
    status: error?.status || null,
    details: error?.details || null,
    stack: error?.stack || null,
  };
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 300) };
  }
}

function expect(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function expectStatus(actual, expected, label) {
  if (!expected.includes(actual)) {
    const error = new Error(`${label}: expected ${expected.join('/')} but got ${actual}`);
    error.status = actual;
    throw error;
  }
}

async function apiFetch(endpoint, options = {}, token = '') {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Timeout after ${REQUEST_TIMEOUT_MS}ms for ${endpoint}`)),
    REQUEST_TIMEOUT_MS,
  );

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
    return { status: response.status, ok: response.ok, json: parseJson(text) };
  } finally {
    clearTimeout(timer);
  }
}

async function login(role) {
  const account = ACCOUNTS[role];
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    data: account,
  });
  expectStatus(response.status, [200], `login:${role}`);
  const token = response.json?.data?.token;
  expect(Boolean(token), `login:${role} missing token`);
  recordStep({ step: 'login', role, result: 'passed' });
  return token;
}

async function auditRuntimePermissions() {
  const registry = require('../backend/dist/permissions/permissionRegistry.js');
  const casbinAuth = require('../backend/dist/permissions/casbinAuthorization.js');

  const checks = [
    { role: 'finance', permission: 'customers.read', expected: false },
    { role: 'sales', permission: 'customers.read', expected: true },
    { role: 'warehouse', permission: 'warehouse.write', expected: true },
    { role: 'finance', permission: 'warehouse.read', expected: false },
    { role: 'finance', permission: 'orders.payment.verify', expected: true },
    { role: 'sales', permission: 'orders.payment.verify', expected: false },
    { role: 'sales', permission: 'procurement.read', expected: false },
    { role: 'sales', permission: 'procurement.b2b.read', expected: true },
  ];

  for (const check of checks) {
    const registryAllowed = registry.roleHasPermission(check.role, check.permission);
    const casbinAllowed = await casbinAuth.casbinAllowsPermission(check.role, check.permission);
    expect(registryAllowed === check.expected, `registry ${check.role}:${check.permission} expected ${check.expected} got ${registryAllowed}`);
    expect(casbinAllowed === check.expected, `casbin ${check.role}:${check.permission} expected ${check.expected} got ${casbinAllowed}`);
    recordStep({
      step: 'runtime-permission',
      role: check.role,
      permission: check.permission,
      expected: check.expected,
      registryAllowed,
      casbinAllowed,
      result: 'passed',
    });
  }
}

function auditFrontendRegistry() {
  const source = fs.readFileSync(path.join(process.cwd(), 'app', 'permissions.ts'), 'utf8');
  expect(source.includes("crm: 'customers.read'"), 'frontend registry must map crm to customers.read');

  const financeBlock = source.match(/finance:\s*\[([\s\S]*?)\],/);
  const warehouseBlock = source.match(/warehouse:\s*\[([\s\S]*?)\],/);
  expect(financeBlock, 'frontend finance permission block missing');
  expect(warehouseBlock, 'frontend warehouse permission block missing');
  expect(!financeBlock[1].includes("'customers.read'"), 'finance menu must not expose CRM/customers.read');
  expect(!warehouseBlock[1].includes("'customers.read'"), 'warehouse menu must not expose CRM/customers.read');

  recordStep({
    step: 'frontend-menu-registry',
    crmPermission: 'customers.read',
    financeCrmVisible: false,
    warehouseCrmVisible: false,
    result: 'passed',
  });
}

async function auditApiMatrix() {
  const tokens = {};
  for (const role of Object.keys(ACCOUNTS)) {
    tokens[role] = await login(role);
  }

  for (const rule of API_MATRIX) {
    for (const role of rule.allow) {
      const response = await apiFetch(rule.endpoint, {}, tokens[role]);
      expectStatus(response.status, [200], `${rule.label}:allow:${role}`);
      recordStep({ step: 'api-matrix', label: rule.label, role, expected: [200], actual: response.status, result: 'passed' });
    }
    for (const role of rule.deny) {
      const response = await apiFetch(rule.endpoint, {}, tokens[role]);
      expectStatus(response.status, [403], `${rule.label}:deny:${role}`);
      recordStep({ step: 'api-matrix', label: rule.label, role, expected: [403], actual: response.status, result: 'passed' });
    }
  }
}

async function saveReport() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  report.endedAt = new Date().toISOString();
  report.durationMs = new Date(report.endedAt).getTime() - new Date(report.startedAt).getTime();
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function main() {
  scriptTimer = setTimeout(() => {
    const error = new Error(`Script timeout after ${SCRIPT_TIMEOUT_MS}ms`);
    fail('script-timeout', error);
    saveReport()
      .finally(() => {
        console.error(error.message);
        process.exit(1);
      });
  }, SCRIPT_TIMEOUT_MS);

  try {
    await auditRuntimePermissions();
    auditFrontendRegistry();
    await auditApiMatrix();
    report.status = 'passed';
  } catch (error) {
    fail('permission-model-audit', error);
  } finally {
    if (scriptTimer) clearTimeout(scriptTimer);
    await saveReport();
  }

  if (report.status !== 'passed') {
    console.error(report.failure?.message || 'Permission model audit failed');
    process.exit(1);
  }

  console.log(`Permission model audit passed. Report: ${REPORT_PATH}`);
}

main();
