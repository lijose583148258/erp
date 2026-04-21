/**
 * Account role assignment audit.
 *
 * This script proves the current authorization model with real API actions:
 * - Admin can create a user.
 * - Non-admin cannot create users.
 * - Updating the user's fixed role changes readable modules after re-login.
 * - Disabled users cannot log in.
 *
 * It intentionally checks that assigning a non-existent role is rejected; dynamic
 * roles are covered by dynamic-role-rbac-audit-v1.cjs.
 */
const fs = require('fs');
const path = require('path');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'role-account-permission-audit-report-v1.json');
const REQUEST_TIMEOUT_MS = 10_000;
const SCRIPT_TIMEOUT_MS = 290_000;
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

const ACCOUNTS = {
  admin: { username: 'admin', password: 'admin123' },
  sales: { username: 'sales', password: 'sales123' },
};

const TEST_USER = {
  username: `rbac_audit_${RUN_ID}`,
  password: 'Audit12345',
  email: `rbac-audit-${RUN_ID}@example.com`,
};

const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  testUser: { username: TEST_USER.username },
  status: 'running',
  steps: [],
  findings: [],
  failure: null,
};

let scriptTimer = null;

function ensureOutputDir() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function recordStep(step) {
  report.steps.push({ at: new Date().toISOString(), ...step });
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 300) };
  }
}

function normalizeBody(body) {
  if (body == null) return undefined;
  return JSON.stringify(body);
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
      body: normalizeBody(options.data),
      signal: controller.signal,
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      json: parseJson(text),
      text,
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(`Request timeout after ${REQUEST_TIMEOUT_MS}ms for ${endpoint}`);
      timeoutError.code = 'REQUEST_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function dataOf(response) {
  return response?.json?.data ?? null;
}

function expectStatus(response, expected, label) {
  if (!expected.includes(response.status)) {
    const error = new Error(`${label}: expected ${expected.join('/')} but got ${response.status}`);
    error.details = response.json;
    error.status = response.status;
    throw error;
  }
}

async function login(username, password, expectedStatuses = [200]) {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    data: { username, password },
  });
  expectStatus(response, expectedStatuses, `login ${username}`);
  if (response.status !== 200) {
    return { status: response.status, token: null, user: null, response };
  }

  const data = dataOf(response);
  if (!data?.token || !data?.user?.id || !data?.user?.role) {
    throw new Error(`login ${username}: missing token/user/role`);
  }
  return { status: response.status, token: data.token, user: data.user, response };
}

async function assertEndpoint(label, endpoint, token, expectedStatuses) {
  const response = await apiFetch(endpoint, {}, token);
  expectStatus(response, expectedStatuses, label);
  recordStep({
    step: 'endpoint-access',
    label,
    endpoint,
    expected: expectedStatuses,
    actual: response.status,
    result: 'passed',
  });
  return response;
}

async function createTeamMember(adminToken, payload, expectedStatuses = [201]) {
  const response = await apiFetch('/team', {
    method: 'POST',
    data: payload,
  }, adminToken);
  expectStatus(response, expectedStatuses, `create team member ${payload.username}`);
  return response;
}

async function updateTeamMember(adminToken, userId, payload, expectedStatuses = [200]) {
  const response = await apiFetch(`/team/${userId}`, {
    method: 'PUT',
    data: payload,
  }, adminToken);
  expectStatus(response, expectedStatuses, `update team member ${userId}`);
  return response;
}

async function runRoleAccessChecks(roleLabel, token, checks) {
  for (const check of checks) {
    await assertEndpoint(`${roleLabel}:${check.label}`, check.endpoint, token, check.expected);
  }
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
  ensureOutputDir();
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
    const admin = await login(ACCOUNTS.admin.username, ACCOUNTS.admin.password);
    const sales = await login(ACCOUNTS.sales.username, ACCOUNTS.sales.password);
    recordStep({ step: 'login-built-in-users', result: 'passed', users: ['admin', 'sales'] });

    const salesCreateAttempt = await createTeamMember(sales.token, {
      username: `${TEST_USER.username}_forbidden`,
      password: TEST_USER.password,
      role: 'sales',
      segment: 'direct',
    }, [403]);
    recordStep({
      step: 'non-admin-create-user-denied',
      expected: [403],
      actual: salesCreateAttempt.status,
      result: 'passed',
    });

    const unknownRoleAttempt = await createTeamMember(admin.token, {
      username: `${TEST_USER.username}_custom_role`,
      password: TEST_USER.password,
      role: 'auditor_custom',
      segment: 'mixed',
    }, [400]);
    recordStep({
      step: 'unknown-role-rejected',
      expected: [400],
      actual: unknownRoleAttempt.status,
      result: 'passed',
    });

    const createResponse = await createTeamMember(admin.token, {
      username: TEST_USER.username,
      password: TEST_USER.password,
      email: TEST_USER.email,
      role: 'sales',
      segment: 'direct',
    });
    const createdUser = dataOf(createResponse);
    if (!createdUser?.id || createdUser.role !== 'sales') {
      throw new Error(`created user missing id or role: ${JSON.stringify(createdUser)}`);
    }
    report.testUser.id = createdUser.id;
    recordStep({
      step: 'admin-create-sales-user',
      result: 'passed',
      userId: createdUser.id,
      role: createdUser.role,
      segment: createdUser.segment,
    });

    const createdAsSales = await login(TEST_USER.username, TEST_USER.password);
    recordStep({
      step: 'created-user-login-as-sales',
      result: 'passed',
      role: createdAsSales.user.role,
      segment: createdAsSales.user.segment,
    });
    await runRoleAccessChecks('created-sales', createdAsSales.token, [
      { label: 'dashboard-allowed', endpoint: '/dashboard', expected: [200] },
      { label: 'orders-allowed', endpoint: '/orders?pageSize=1', expected: [200] },
      { label: 'procurement-suppliers-basic-redacted-allowed', endpoint: '/procurement/suppliers?pageSize=1', expected: [200] },
      { label: 'procurement-orders-denied', endpoint: '/procurement/orders?pageSize=1', expected: [403] },
      { label: 'warehouses-denied', endpoint: '/warehouses', expected: [403] },
      { label: 'finance-denied', endpoint: '/finance/summary', expected: [403] },
    ]);

    const warehouseUpdate = await updateTeamMember(admin.token, createdUser.id, { role: 'warehouse' });
    const warehouseUser = dataOf(warehouseUpdate);
    recordStep({
      step: 'admin-change-role-to-warehouse',
      result: 'passed',
      role: warehouseUser?.role,
      isActive: warehouseUser?.isActive,
    });

    const createdAsWarehouse = await login(TEST_USER.username, TEST_USER.password);
    recordStep({
      step: 'created-user-login-as-warehouse',
      result: 'passed',
      role: createdAsWarehouse.user.role,
      segment: createdAsWarehouse.user.segment,
    });
    if (createdAsWarehouse.user.segment !== 'mixed') {
      throw new Error(`warehouse role segment should be mixed, got ${createdAsWarehouse.user.segment}`);
    }
    await runRoleAccessChecks('created-warehouse', createdAsWarehouse.token, [
      { label: 'dashboard-allowed', endpoint: '/dashboard', expected: [200] },
      { label: 'warehouses-allowed', endpoint: '/warehouses', expected: [200] },
      { label: 'procurement-suppliers-allowed', endpoint: '/procurement/suppliers?pageSize=1', expected: [200] },
      { label: 'orders-denied', endpoint: '/orders?pageSize=1', expected: [403] },
      { label: 'finance-denied', endpoint: '/finance/summary', expected: [403] },
    ]);

    const financeUpdate = await updateTeamMember(admin.token, createdUser.id, { role: 'finance' });
    const financeUser = dataOf(financeUpdate);
    recordStep({
      step: 'admin-change-role-to-finance',
      result: 'passed',
      role: financeUser?.role,
      isActive: financeUser?.isActive,
    });

    const createdAsFinance = await login(TEST_USER.username, TEST_USER.password);
    recordStep({
      step: 'created-user-login-as-finance',
      result: 'passed',
      role: createdAsFinance.user.role,
      segment: createdAsFinance.user.segment,
    });
    if (createdAsFinance.user.segment !== 'mixed') {
      throw new Error(`finance role segment should be mixed, got ${createdAsFinance.user.segment}`);
    }
    await runRoleAccessChecks('created-finance', createdAsFinance.token, [
      { label: 'dashboard-allowed', endpoint: '/dashboard', expected: [200] },
      { label: 'finance-allowed', endpoint: '/finance/summary', expected: [200] },
      { label: 'procurement-suppliers-allowed', endpoint: '/procurement/suppliers?pageSize=1', expected: [200] },
      { label: 'warehouses-denied', endpoint: '/warehouses', expected: [403] },
      { label: 'shipping-denied', endpoint: '/shipping?pageSize=1', expected: [403] },
    ]);

    const disableResponse = await updateTeamMember(admin.token, createdUser.id, { isActive: false });
    const disabledUser = dataOf(disableResponse);
    recordStep({
      step: 'admin-disable-created-user',
      result: 'passed',
      isActive: disabledUser?.isActive,
    });

    const disabledLogin = await login(TEST_USER.username, TEST_USER.password, [403]);
    recordStep({
      step: 'disabled-user-login-denied',
      expected: [403],
      actual: disabledLogin.status,
      result: 'passed',
    });

    report.status = 'passed';
  } catch (error) {
    fail('role-account-permission-audit', error);
  } finally {
    if (scriptTimer) clearTimeout(scriptTimer);
    await saveReport();
  }

  if (report.status !== 'passed') {
    console.error(report.failure?.message || 'Role account permission audit failed');
    process.exit(1);
  }

  console.log(`Role account permission audit passed. Report: ${REPORT_PATH}`);
  if (report.findings.length > 0) {
    console.log(`Findings: ${report.findings.length}`);
  }
}

main();
