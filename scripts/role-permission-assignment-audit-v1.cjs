/**
 * Super-admin role permission assignment audit.
 *
 * Proves that sensitive permissions are not hard-coded by role anymore:
 * - Sales cannot manage role policies.
 * - Sales cannot read warehouse ledger until the super admin grants it.
 * - Grant/revoke takes effect through the existing /roles API without code changes.
 * - The original sales role permissions are restored before exit.
 */
const fs = require('fs');
const path = require('path');
const { ensureUiAuditUser } = require('./lib/ui-audit-user.cjs');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'role-permission-assignment-audit-report-v1.json');
const REQUEST_TIMEOUT_MS = 10_000;
const SCRIPT_TIMEOUT_MS = 290_000;

const ADMIN = {
  username: process.env.AUDIT_UI_USERNAME || 'ui_permission_assignment_admin',
  password: process.env.AUDIT_UI_PASSWORD || 'AuditSmoke12345!',
  role: 'admin',
};
const SALES = { username: 'sales', password: 'sales123' };
const LEDGER_PERMISSION = 'warehouse.ledger.read';
const ROLE_MANAGE_PERMISSION = 'authorization.roles.manage';

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

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

function expect(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function expectStatus(response, expected, label) {
  if (!expected.includes(response.status)) {
    const error = new Error(`${label}: expected ${expected.join('/')} but got ${response.status}`);
    error.status = response.status;
    error.details = response.json;
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
        ...(options.headers || {}),
      },
      body: options.data === undefined ? undefined : JSON.stringify(options.data),
      signal: controller.signal,
    });
    const text = await response.text();
    return { status: response.status, ok: response.ok, json: parseJson(text), text };
  } finally {
    clearTimeout(timer);
  }
}

function dataOf(response) {
  return response?.json?.data ?? null;
}

async function login(account, label) {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    data: account,
  });
  expectStatus(response, [200], `login:${label}`);
  const data = dataOf(response);
  expect(Boolean(data?.token), `login:${label} missing token`, response.json);
  expect(Boolean(data?.user?.permissions), `login:${label} missing permission list`, response.json);
  recordStep({
    step: 'login',
    role: label,
    permissionCount: data.user.permissions.length,
    result: 'passed',
  });
  return data;
}

function normalizePermissions(values) {
  return Array.from(new Set(values)).sort();
}

function rolePayload(role, permissions) {
  return {
    name: role.name,
    description: role.description || null,
    isActive: role.isActive,
    dataScopes: role.dataScopes || [],
    permissions: normalizePermissions(permissions),
  };
}

async function listRoles(adminToken) {
  const response = await apiFetch('/roles', {}, adminToken);
  expectStatus(response, [200], 'admin list roles');
  return dataOf(response) || [];
}

async function readSalesRole(adminToken) {
  const roles = await listRoles(adminToken);
  const salesRole = roles.find((role) => role.code === 'sales');
  expect(Boolean(salesRole), 'sales role not found in /roles readback', roles);
  return salesRole;
}

async function updateSalesRole(adminToken, salesRole, permissions, label) {
  const response = await apiFetch('/roles/sales', {
    method: 'PUT',
    data: rolePayload(salesRole, permissions),
  }, adminToken);
  expectStatus(response, [200], label);
  const saved = dataOf(response);
  expect(saved?.code === 'sales', `${label}: saved role mismatch`, saved);
  recordStep({
    step: label,
    permissionCount: saved.permissions.length,
    hasLedgerPermission: saved.permissions.includes(LEDGER_PERMISSION),
    result: 'passed',
  });
  return saved;
}

async function assertSalesLedgerAccess(salesToken, expectedStatus, label) {
  const response = await apiFetch('/warehouses/stock-entries?limit=1', {}, salesToken);
  expectStatus(response, [expectedStatus], label);
  recordStep({
    step: label,
    expectedStatus,
    actualStatus: response.status,
    result: 'passed',
  });
  return response;
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
    saveReport().finally(() => {
      console.error(error.message);
      process.exit(1);
    });
  }, SCRIPT_TIMEOUT_MS);

  let admin = null;
  let sales = null;
  let originalSalesRole = null;
  try {
    await ensureUiAuditUser(ADMIN);
    admin = await login(ADMIN, 'admin');
    sales = await login(SALES, 'sales');
    expect(admin.user.permissions.includes(ROLE_MANAGE_PERMISSION), 'admin must have authorization role management permission', admin.user);
    expect(!sales.user.permissions.includes(ROLE_MANAGE_PERMISSION), 'sales must not have authorization role management permission by default', sales.user);

    const permissionResponse = await apiFetch('/roles/permissions', {}, admin.token);
    expectStatus(permissionResponse, [200], 'admin list permission definitions');
    const permissionCodes = (dataOf(permissionResponse) || []).map((permission) => permission.code);
    for (const required of [ROLE_MANAGE_PERMISSION, LEDGER_PERMISSION, 'production.cost.read']) {
      expect(permissionCodes.includes(required), `permission definition missing ${required}`, permissionCodes);
    }
    recordStep({ step: 'permission-definition-readback', result: 'passed', required: [ROLE_MANAGE_PERMISSION, LEDGER_PERMISSION, 'production.cost.read'] });

    const salesRoleListAttempt = await apiFetch('/roles', {}, sales.token);
    expectStatus(salesRoleListAttempt, [403], 'sales cannot list role policies');
    recordStep({ step: 'sales-role-policy-list-denied', actualStatus: salesRoleListAttempt.status, result: 'passed' });

    const salesRoleUpdateAttempt = await apiFetch('/roles/sales', {
      method: 'PUT',
      data: {
        name: 'sales',
        isActive: true,
        dataScopes: ['own_customers'],
        permissions: ['dashboard.read'],
      },
    }, sales.token);
    expectStatus(salesRoleUpdateAttempt, [403], 'sales cannot update role policies');
    recordStep({ step: 'sales-role-policy-update-denied', actualStatus: salesRoleUpdateAttempt.status, result: 'passed' });

    originalSalesRole = await readSalesRole(admin.token);
    const originalPermissions = normalizePermissions(originalSalesRole.permissions || []);
    const withoutLedger = originalPermissions.filter((permission) => permission !== LEDGER_PERMISSION);
    const withLedger = normalizePermissions([...withoutLedger, LEDGER_PERMISSION]);

    await updateSalesRole(admin.token, originalSalesRole, withoutLedger, 'super-admin-revoke-sales-ledger');
    await assertSalesLedgerAccess(sales.token, 403, 'sales-ledger-denied-before-grant');

    await updateSalesRole(admin.token, originalSalesRole, withLedger, 'super-admin-grant-sales-ledger');
    await assertSalesLedgerAccess(sales.token, 200, 'sales-ledger-allowed-after-grant');

    const salesMeAfterGrant = await apiFetch('/auth/me', {}, sales.token);
    expectStatus(salesMeAfterGrant, [200], 'sales /auth/me after grant');
    expect(dataOf(salesMeAfterGrant)?.permissions?.includes(LEDGER_PERMISSION), 'sales /auth/me did not reflect granted permission', salesMeAfterGrant.json);
    recordStep({ step: 'sales-auth-me-reflects-grant', result: 'passed' });

    await updateSalesRole(admin.token, originalSalesRole, withoutLedger, 'super-admin-revoke-sales-ledger-again');
    await assertSalesLedgerAccess(sales.token, 403, 'sales-ledger-denied-after-revoke');

    report.status = 'passed';
  } catch (error) {
    fail('role-permission-assignment-audit', error);
  } finally {
    try {
      if (admin?.token && originalSalesRole) {
        await updateSalesRole(admin.token, originalSalesRole, originalSalesRole.permissions || [], 'restore-original-sales-role');
      }
    } catch (restoreError) {
      report.findings.push({
        level: 'P0',
        area: 'restore',
        message: String(restoreError?.message || restoreError),
      });
      if (report.status === 'passed') {
        fail('restore-original-sales-role', restoreError);
      }
    }
    if (scriptTimer) clearTimeout(scriptTimer);
    await saveReport();
  }

  if (report.status !== 'passed') {
    console.error(report.failure?.message || 'Role permission assignment audit failed');
    process.exit(1);
  }

  console.log(`Role permission assignment audit passed. Report: ${REPORT_PATH}`);
}

main();
