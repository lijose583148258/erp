/**
 * Dynamic role RBAC audit.
 *
 * Proves the custom-role chain end to end:
 * - Admin can list permission definitions and create a custom role.
 * - A custom-role user can log in and receives a permission list.
 * - API allow/deny follows the role permission matrix.
 * - Updating role permissions takes effect without code changes.
 * - Disabling a role blocks login, refresh, /auth/me, and old-token access.
 */
const fs = require('fs');
const path = require('path');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'dynamic-role-rbac-audit-report-v1.json');
const REQUEST_TIMEOUT_MS = 10_000;
const SCRIPT_TIMEOUT_MS = 290_000;
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

const ADMIN = { username: 'admin', password: 'admin123' };
const ROLE_CODE = `audit_role_${RUN_ID}`;
const USERNAME = `dyn_role_user_${RUN_ID}`;
const PASSWORD = 'Audit12345';

const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  roleCode: ROLE_CODE,
  username: USERNAME,
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

async function login(username, password, expectedStatuses = [200]) {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    data: { username, password },
  });
  expectStatus(response, expectedStatuses, `login:${username}`);
  if (response.status !== 200) {
    return { response, token: null, refreshToken: null, user: null };
  }
  const data = dataOf(response);
  expect(Boolean(data?.token), `login:${username} missing token`, response.json);
  expect(Boolean(data?.refreshToken), `login:${username} missing refresh token`, response.json);
  expect(Boolean(data?.user?.role), `login:${username} missing user role`, response.json);
  return { response, token: data.token, refreshToken: data.refreshToken, user: data.user };
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

  try {
    const admin = await login(ADMIN.username, ADMIN.password);
    recordStep({ step: 'admin-login', result: 'passed' });

    const permissionsResponse = await apiFetch('/roles/permissions', {}, admin.token);
    expectStatus(permissionsResponse, [200], 'list permissions');
    const permissionCodes = (dataOf(permissionsResponse) || []).map((item) => item.code);
    for (const code of ['dashboard.read', 'customers.read', 'orders.read', 'procurement.read', 'procurement.suppliers.read', 'team.write']) {
      expect(permissionCodes.includes(code), `permission registry missing ${code}`, permissionCodes);
    }
    recordStep({ step: 'permission-registry-readback', count: permissionCodes.length, result: 'passed' });

    const createRoleResponse = await apiFetch('/roles', {
      method: 'POST',
      data: {
        code: ROLE_CODE,
        name: `审计动态角色 ${RUN_ID}`,
        description: 'Created by dynamic-role-rbac-audit-v1',
        isActive: true,
        dataScopes: ['own_customers'],
        permissions: ['dashboard.read', 'customers.read', 'orders.read'],
      },
    }, admin.token);
    expectStatus(createRoleResponse, [201], 'create custom role');
    const createdRole = dataOf(createRoleResponse);
    expect(createdRole?.code === ROLE_CODE, 'created role code mismatch', createdRole);
    expect(createdRole.permissions.includes('customers.read'), 'created role missing customers.read', createdRole);
    recordStep({ step: 'create-custom-role', permissions: createdRole.permissions, result: 'passed' });

    const createUserResponse = await apiFetch('/team', {
      method: 'POST',
      data: {
        username: USERNAME,
        password: PASSWORD,
        email: `${USERNAME}@example.com`,
        role: ROLE_CODE,
        segment: 'direct',
      },
    }, admin.token);
    expectStatus(createUserResponse, [201], 'create custom-role user');
    const createdUser = dataOf(createUserResponse);
    expect(createdUser?.role === ROLE_CODE, 'created user role mismatch', createdUser);
    recordStep({ step: 'create-custom-role-user', userId: createdUser.id, result: 'passed' });

    const teamResponse = await apiFetch('/team', {}, admin.token);
    expectStatus(teamResponse, [200], 'team list readback');
    const teamMembers = dataOf(teamResponse) || [];
    expect(teamMembers.some((item) => item.username === USERNAME && item.role === ROLE_CODE), 'custom-role user missing from team list', teamMembers);
    recordStep({ step: 'team-list-custom-role-readback', result: 'passed' });

    const customLogin = await login(USERNAME, PASSWORD);
    expect(customLogin.user.role === ROLE_CODE, 'custom user login role mismatch', customLogin.user);
    expect(customLogin.user.permissions.includes('customers.read'), 'login response missing dynamic permissions', customLogin.user);
    expect(!customLogin.user.permissions.includes('procurement.read'), 'login response unexpectedly includes procurement.read before grant', customLogin.user);
    recordStep({ step: 'custom-role-login-permissions', permissions: customLogin.user.permissions, result: 'passed' });

    await assertEndpoint('custom-dashboard-before-update', '/dashboard', customLogin.token, [200]);
    await assertEndpoint('custom-customers-before-update', '/customers?pageSize=1', customLogin.token, [200]);
    await assertEndpoint('custom-orders-before-update', '/orders?pageSize=1', customLogin.token, [200]);
    await assertEndpoint('custom-procurement-denied-before-update', '/procurement/suppliers?pageSize=1', customLogin.token, [403]);
    await assertEndpoint('custom-warehouse-denied', '/warehouses', customLogin.token, [403]);
    await assertEndpoint('custom-finance-denied', '/finance/summary', customLogin.token, [403]);
    await assertEndpoint('custom-team-denied', '/team', customLogin.token, [403]);

    const updateRoleResponse = await apiFetch(`/roles/${ROLE_CODE}`, {
      method: 'PUT',
      data: {
        name: `审计动态角色 ${RUN_ID}`,
        description: 'Grant procurement supplier read during dynamic-role audit',
        isActive: true,
        dataScopes: ['own_customers'],
        permissions: ['dashboard.read', 'customers.read', 'orders.read', 'procurement.read', 'procurement.suppliers.read'],
      },
    }, admin.token);
    expectStatus(updateRoleResponse, [200], 'grant procurement supplier read to custom role');
    recordStep({ step: 'update-custom-role-permissions', permissions: dataOf(updateRoleResponse).permissions, result: 'passed' });

    const customRelogin = await login(USERNAME, PASSWORD);
    expect(customRelogin.user.permissions.includes('procurement.read'), 'updated login response missing procurement.read', customRelogin.user);
    expect(customRelogin.user.permissions.includes('procurement.suppliers.read'), 'updated login response missing procurement.suppliers.read', customRelogin.user);
    await assertEndpoint('custom-procurement-allowed-after-update', '/procurement/suppliers?pageSize=1', customRelogin.token, [200]);

    const disableRoleResponse = await apiFetch(`/roles/${ROLE_CODE}`, {
      method: 'PUT',
      data: {
        name: `审计动态角色 ${RUN_ID}`,
        description: 'Disabled by dynamic-role audit',
        isActive: false,
        dataScopes: ['own_customers'],
        permissions: ['dashboard.read', 'customers.read', 'orders.read', 'procurement.read', 'procurement.suppliers.read'],
      },
    }, admin.token);
    expectStatus(disableRoleResponse, [200], 'disable custom role');
    recordStep({ step: 'disable-custom-role', result: 'passed' });

    await login(USERNAME, PASSWORD, [403]);
    recordStep({ step: 'disabled-role-login-denied', result: 'passed' });

    await assertEndpoint('disabled-role-old-token-dashboard-denied', '/dashboard', customRelogin.token, [403]);
    await assertEndpoint('disabled-role-old-token-me-denied', '/auth/me', customRelogin.token, [403]);
    const refreshResponse = await apiFetch('/auth/refresh', {
      method: 'POST',
      data: { refreshToken: customRelogin.refreshToken },
    });
    expectStatus(refreshResponse, [403], 'disabled role refresh denied');
    recordStep({ step: 'disabled-role-refresh-denied', result: 'passed' });

    report.status = 'passed';
  } catch (error) {
    fail('dynamic-role-rbac-audit', error);
  } finally {
    if (scriptTimer) clearTimeout(scriptTimer);
    await saveReport();
  }

  if (report.status !== 'passed') {
    console.error(report.failure?.message || 'Dynamic role RBAC audit failed');
    process.exit(1);
  }

  console.log(`Dynamic role RBAC audit passed. Report: ${REPORT_PATH}`);
}

main();
