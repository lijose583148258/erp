/**
 * Audit-read dynamic permission regression.
 *
 * Proves /api/audit is governed by audit.read, not by hard-coded admin role checks:
 * - sales without audit.read is denied
 * - super admin grants audit.read to sales
 * - sales can read audit logs without being admin
 * - permission is revoked and original sales role is restored
 */
const fs = require('fs');
const path = require('path');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'audit-read-dynamic-permission-audit-report-v1.json');
const REQUEST_TIMEOUT_MS = 10_000;
const SCRIPT_TIMEOUT_MS = 290_000;

const ADMIN = { username: 'admin', password: 'admin123' };
const SALES = { username: 'sales', password: 'sales123' };
const AUDIT_READ_PERMISSION = 'audit.read';

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
  recordStep({
    step: 'login',
    role: label,
    permissionCount: data.user?.permissions?.length || 0,
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

async function readSalesRole(adminToken) {
  const response = await apiFetch('/roles', {}, adminToken);
  expectStatus(response, [200], 'admin list roles');
  const roles = dataOf(response) || [];
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
    hasAuditRead: saved.permissions.includes(AUDIT_READ_PERMISSION),
    result: 'passed',
  });
  return saved;
}

async function assertAuditAccess(token, expectedStatus, label) {
  const response = await apiFetch('/audit?page=1&pageSize=1', {}, token);
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
    admin = await login(ADMIN, 'admin');
    sales = await login(SALES, 'sales');

    const permissionResponse = await apiFetch('/roles/permissions', {}, admin.token);
    expectStatus(permissionResponse, [200], 'admin list permission definitions');
    const permissionCodes = (dataOf(permissionResponse) || []).map((permission) => permission.code);
    expect(permissionCodes.includes(AUDIT_READ_PERMISSION), `permission definition missing ${AUDIT_READ_PERMISSION}`, permissionCodes);
    recordStep({ step: 'permission-definition-readback', result: 'passed', required: [AUDIT_READ_PERMISSION] });

    originalSalesRole = await readSalesRole(admin.token);
    const originalPermissions = normalizePermissions(originalSalesRole.permissions || []);
    const withoutAuditRead = originalPermissions.filter((permission) => permission !== AUDIT_READ_PERMISSION);
    const withAuditRead = normalizePermissions([...withoutAuditRead, AUDIT_READ_PERMISSION]);

    await updateSalesRole(admin.token, originalSalesRole, withoutAuditRead, 'super-admin-revoke-sales-audit-read');
    await assertAuditAccess(sales.token, 403, 'sales-audit-denied-before-grant');

    await updateSalesRole(admin.token, originalSalesRole, withAuditRead, 'super-admin-grant-sales-audit-read');
    const auditReadResponse = await assertAuditAccess(sales.token, 200, 'sales-audit-allowed-after-grant');
    expect(auditReadResponse.json?.success === true, 'sales audit read response should be successful', auditReadResponse.json);

    await updateSalesRole(admin.token, originalSalesRole, withoutAuditRead, 'super-admin-revoke-sales-audit-read-again');
    await assertAuditAccess(sales.token, 403, 'sales-audit-denied-after-revoke');

    report.status = 'passed';
  } catch (error) {
    fail('audit-read-dynamic-permission-audit', error);
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
    console.error(report.failure?.message || 'Audit-read dynamic permission audit failed');
    process.exit(1);
  }

  console.log(`Audit-read dynamic permission audit passed. Report: ${REPORT_PATH}`);
}

main();
