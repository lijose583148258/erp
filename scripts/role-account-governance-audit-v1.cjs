/**
 * Account and fixed-role governance audit.
 *
 * This verifies the current system capability:
 * - admin can create a user
 * - admin can reassign one of the fixed roles
 * - route access changes after re-login
 * - inactive users cannot log in
 *
 * It intentionally does not claim dynamic RBAC exists.
 */
const fs = require('fs');
const path = require('path');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'role-account-governance-audit-report-v1.json');
const REQUEST_TIMEOUT_MS = 8000;
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

const DATA = {
  username: `rbac_audit_${RUN_ID}`,
  password: `Rbac${RUN_ID}!`,
  email: `rbac-${RUN_ID}@ailao.test`,
};

const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  data: DATA,
  status: 'running',
  steps: [],
  findings: [],
};

function recordStep(entry) {
  report.steps.push({ at: new Date().toISOString(), ...entry });
}

function writeReport() {
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
}

async function apiFetch(endpoint, options = {}, token = '') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Timeout after ${REQUEST_TIMEOUT_MS}ms`)), REQUEST_TIMEOUT_MS);
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
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text.slice(0, 300) };
    }
    return { ok: response.ok, status: response.status, json };
  } finally {
    clearTimeout(timeout);
  }
}

async function login(username, password) {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    data: { username, password },
  });
  if (!response.ok || !response.json?.data?.token) {
    throw new Error(`login failed for ${username}: ${response.status} ${JSON.stringify(response.json)}`);
  }
  return response.json.data;
}

async function expectStatus(label, endpoint, token, expectedStatuses) {
  const response = await apiFetch(endpoint, {}, token);
  if (!expectedStatuses.includes(response.status)) {
    throw new Error(`${label}: expected ${expectedStatuses.join('/')} got ${response.status} ${JSON.stringify(response.json)}`);
  }
  recordStep({ step: label, endpoint, expectedStatuses, actualStatus: response.status, result: 'passed' });
  return response;
}

async function updateUser(adminToken, userId, payload) {
  const response = await apiFetch(`/team/${userId}`, {
    method: 'PUT',
    data: payload,
  }, adminToken);
  if (!response.ok) {
    throw new Error(`update user failed: ${response.status} ${JSON.stringify(response.json)}`);
  }
  return response.json.data;
}

async function auditRoleAccess(role, token) {
  if (role === 'sales') {
    await expectStatus('sales-dashboard-allowed', '/dashboard', token, [200]);
    await expectStatus('sales-orders-allowed', '/orders?pageSize=1', token, [200]);
    await expectStatus('sales-procurement-suppliers-denied', '/procurement/suppliers?pageSize=1', token, [403]);
    await expectStatus('sales-warehouse-denied', '/warehouses', token, [403]);
  }

  if (role === 'warehouse') {
    await expectStatus('warehouse-dashboard-allowed', '/dashboard', token, [200]);
    await expectStatus('warehouse-procurement-suppliers-allowed', '/procurement/suppliers?pageSize=1', token, [200]);
    await expectStatus('warehouse-warehouses-allowed', '/warehouses', token, [200]);
    await expectStatus('warehouse-orders-denied', '/orders?pageSize=1', token, [403]);
  }

  if (role === 'finance') {
    await expectStatus('finance-dashboard-allowed', '/dashboard', token, [200]);
    await expectStatus('finance-finance-workspace-allowed', '/finance/workspace', token, [200]);
    await expectStatus('finance-procurement-suppliers-allowed', '/procurement/suppliers?pageSize=1', token, [200]);
    await expectStatus('finance-shipping-denied', '/shipping?pageSize=1', token, [403]);
    await expectStatus('finance-warehouse-denied', '/warehouses', token, [403]);
  }
}

async function run() {
  try {
    const admin = await login('admin', 'admin123');
    recordStep({ step: 'login-admin', result: 'passed', adminUserId: admin.user.id });

    const createResponse = await apiFetch('/team', {
      method: 'POST',
      data: {
        username: DATA.username,
        password: DATA.password,
        email: DATA.email,
        role: 'sales',
        segment: 'direct',
      },
    }, admin.token);

    if (!createResponse.ok || !createResponse.json?.data?.id) {
      throw new Error(`create audit user failed: ${createResponse.status} ${JSON.stringify(createResponse.json)}`);
    }

    const userId = createResponse.json.data.id;
    recordStep({
      step: 'admin-create-user-sales',
      result: 'passed',
      userId,
      role: createResponse.json.data.role,
      segment: createResponse.json.data.segment,
    });

    const salesUser = await login(DATA.username, DATA.password);
    recordStep({ step: 'login-created-sales-user', result: 'passed', role: salesUser.user.role, segment: salesUser.user.segment });
    await auditRoleAccess('sales', salesUser.token);

    const warehouseUserData = await updateUser(admin.token, userId, { role: 'warehouse', isActive: true });
    recordStep({ step: 'admin-update-user-to-warehouse', result: 'passed', userId, role: warehouseUserData.role });
    const warehouseUser = await login(DATA.username, DATA.password);
    recordStep({ step: 'login-updated-warehouse-user', result: 'passed', role: warehouseUser.user.role });
    await auditRoleAccess('warehouse', warehouseUser.token);

    const financeUserData = await updateUser(admin.token, userId, { role: 'finance', isActive: true });
    recordStep({ step: 'admin-update-user-to-finance', result: 'passed', userId, role: financeUserData.role });
    const financeUser = await login(DATA.username, DATA.password);
    recordStep({ step: 'login-updated-finance-user', result: 'passed', role: financeUser.user.role });
    await auditRoleAccess('finance', financeUser.token);

    const disabledUserData = await updateUser(admin.token, userId, { isActive: false });
    recordStep({ step: 'admin-disable-user', result: 'passed', userId, isActive: disabledUserData.isActive });
    const disabledLogin = await apiFetch('/auth/login', {
      method: 'POST',
      data: { username: DATA.username, password: DATA.password },
    });
    if (disabledLogin.status !== 401) {
      throw new Error(`disabled user should not login, got ${disabledLogin.status}`);
    }
    recordStep({ step: 'disabled-user-login-denied', result: 'passed', status: disabledLogin.status });

    report.status = report.findings.length ? 'findings' : 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error.message || error);
  } finally {
    writeReport();
  }

  if (report.status === 'failed') {
    console.error(report.error);
    process.exit(1);
  }

  console.log(JSON.stringify({
    status: report.status,
    steps: report.steps.length,
    findings: report.findings.length,
    reportPath: REPORT_PATH,
  }, null, 2));
}

run();
