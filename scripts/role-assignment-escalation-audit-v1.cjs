/**
 * Role assignment escalation audit.
 *
 * Proves that team.write is not enough to assign privileged roles.
 * A custom team operator can create/update ordinary sales users, but cannot
 * assign admin/finance/warehouse roles without authorization.roles.manage.
 */
const fs = require('fs');
const path = require('path');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'role-assignment-escalation-audit-report-v1.json');
const REQUEST_TIMEOUT_MS = 10_000;
const SCRIPT_TIMEOUT_MS = 290_000;
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

const ADMIN = { username: 'admin', password: 'admin123' };
const ROLE_CODE = `team_writer_no_auth_${RUN_ID}`;
const DELEGATED_ROLE_CODE = `delegated_role_admin_${RUN_ID}`;
const OPERATOR = {
  username: `team_writer_${RUN_ID}`,
  password: 'Audit12345',
};
const ORDINARY_USER = {
  username: `ordinary_sales_${RUN_ID}`,
  password: 'Audit12345',
};
const REGISTER_DENIED_USER = {
  username: `reg_fin_${RUN_ID}`,
  password: 'Audit12345',
};

const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  status: 'running',
  steps: [],
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
      },
      body: options.data === undefined ? undefined : JSON.stringify(options.data),
      signal: controller.signal,
    });
    const text = await response.text();
    return { status: response.status, ok: response.ok, json: parseJson(text) };
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
    label,
    role: data.user?.role,
    permissions: data.user?.permissions || [],
    result: 'passed',
  });
  return data;
}

async function createRole(adminToken) {
  const response = await apiFetch('/roles', {
    method: 'POST',
    data: {
      code: ROLE_CODE,
      name: `团队资料管理员无授权 ${RUN_ID}`,
      description: 'Created by role-assignment-escalation-audit-v1',
      isActive: true,
      dataScopes: ['team_customers'],
      permissions: ['dashboard.read', 'team.read', 'team.write'],
    },
  }, adminToken);
  expectStatus(response, [201], 'create team-write-only role');
  const role = dataOf(response);
  expect(role?.permissions?.includes('team.write'), 'custom role missing team.write', role);
  expect(!role.permissions.includes('authorization.roles.manage'), 'custom role must not include authorization.roles.manage', role);
  recordStep({ step: 'create-team-write-only-role', result: 'passed', roleCode: ROLE_CODE });
  return role;
}

async function createDelegatedRoleAdmin(adminToken) {
  const response = await apiFetch('/roles', {
    method: 'POST',
    data: {
      code: DELEGATED_ROLE_CODE,
      name: `受限角色管理员 ${RUN_ID}`,
      description: 'Must not grant permissions or scopes beyond its own ceiling',
      isActive: true,
      dataScopes: ['team_customers'],
      permissions: ['dashboard.read', 'team.read', 'authorization.roles.manage'],
    },
  }, adminToken);
  expectStatus(response, [201], 'create delegated role administrator');
  return dataOf(response);
}

async function createMember(token, payload, expectedStatuses, label) {
  const response = await apiFetch('/team', {
    method: 'POST',
    data: payload,
  }, token);
  expectStatus(response, expectedStatuses, label);
  recordStep({ step: label, result: 'passed', actualStatus: response.status, role: payload.role || 'sales' });
  return response;
}

async function updateMember(token, userId, payload, expectedStatuses, label) {
  const response = await apiFetch(`/team/${userId}`, {
    method: 'PUT',
    data: payload,
  }, token);
  expectStatus(response, expectedStatuses, label);
  recordStep({ step: label, result: 'passed', actualStatus: response.status, payload });
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
    const admin = await login(ADMIN, 'admin');
    await createRole(admin.token);
    const delegatedRole = await createDelegatedRoleAdmin(admin.token);

    const operatorResponse = await createMember(admin.token, {
      username: OPERATOR.username,
      password: OPERATOR.password,
      role: ROLE_CODE,
      segment: 'mixed',
    }, [201], 'admin-create-team-write-only-operator');
    const operatorUser = dataOf(operatorResponse);
    expect(operatorUser?.role === ROLE_CODE, 'operator role mismatch', operatorUser);

    const operator = await login(OPERATOR, 'team-write-only-operator');
    expect(operator.user.permissions.includes('team.write'), 'operator missing team.write', operator.user);
    expect(!operator.user.permissions.includes('authorization.roles.manage'), 'operator unexpectedly has role management permission', operator.user);

    await createMember(operator.token, {
      username: `${ORDINARY_USER.username}_admin_denied`,
      password: ORDINARY_USER.password,
      role: 'admin',
      segment: 'mixed',
    }, [403], 'team-writer-cannot-create-admin-user');

    const ordinaryResponse = await createMember(operator.token, {
      username: ORDINARY_USER.username,
      password: ORDINARY_USER.password,
      segment: 'direct',
    }, [201], 'team-writer-can-create-default-sales-user');
    const ordinary = dataOf(ordinaryResponse);
    expect(ordinary?.role === 'sales', 'ordinary user should default to sales', ordinary);

    await updateMember(operator.token, ordinary.id, {
      email: `${ORDINARY_USER.username}@example.com`,
    }, [200], 'team-writer-can-update-profile-fields');

    await updateMember(operator.token, ordinary.id, {
      role: 'finance',
    }, [403], 'team-writer-cannot-promote-user-to-finance');

    const registerAttempt = await apiFetch('/auth/register', {
      method: 'POST',
      data: {
        username: REGISTER_DENIED_USER.username,
        password: REGISTER_DENIED_USER.password,
        role: 'finance',
        segment: 'mixed',
      },
    }, operator.token);
    expectStatus(registerAttempt, [403], 'team-writer-cannot-register-finance-user');
    recordStep({ step: 'team-writer-cannot-register-finance-user', result: 'passed', actualStatus: registerAttempt.status });

    const delegatedUserResponse = await createMember(admin.token, {
      username: `delegated_role_admin_${RUN_ID}`,
      password: OPERATOR.password,
      role: DELEGATED_ROLE_CODE,
      segment: 'mixed',
    }, [201], 'admin-create-delegated-role-administrator');
    expect(dataOf(delegatedUserResponse)?.role === DELEGATED_ROLE_CODE, 'delegated role administrator role mismatch');
    const delegated = await login({
      username: `delegated_role_admin_${RUN_ID}`,
      password: OPERATOR.password,
    }, 'delegated-role-administrator');

    const selfEscalation = await apiFetch(`/roles/${DELEGATED_ROLE_CODE}`, {
      method: 'PUT',
      data: {
        name: delegatedRole.name,
        description: delegatedRole.description,
        isActive: true,
        dataScopes: delegatedRole.dataScopes,
        permissions: [...delegatedRole.permissions, 'warehouse.ledger.read'],
      },
    }, delegated.token);
    expectStatus(selfEscalation, [403], 'delegated-role-admin-cannot-self-grant-ledger');
    recordStep({ step: 'delegated-role-admin-cannot-self-grant-ledger', result: 'passed', actualStatus: selfEscalation.status });

    const scopeEscalation = await apiFetch(`/roles/${DELEGATED_ROLE_CODE}`, {
      method: 'PUT',
      data: {
        name: delegatedRole.name,
        description: delegatedRole.description,
        isActive: true,
        dataScopes: ['all'],
        permissions: delegatedRole.permissions,
      },
    }, delegated.token);
    expectStatus(scopeEscalation, [403], 'delegated-role-admin-cannot-self-grant-all-scope');
    recordStep({ step: 'delegated-role-admin-cannot-self-grant-all-scope', result: 'passed', actualStatus: scopeEscalation.status });

    const adminRoleEscalation = await apiFetch('/roles/admin', {
      method: 'PUT',
      data: {
        name: 'admin',
        isActive: true,
        dataScopes: delegatedRole.dataScopes,
        permissions: delegatedRole.permissions,
      },
    }, delegated.token);
    expectStatus(adminRoleEscalation, [403], 'delegated-role-admin-cannot-modify-admin-role');
    recordStep({ step: 'delegated-role-admin-cannot-modify-admin-role', result: 'passed', actualStatus: adminRoleEscalation.status });

    report.status = 'passed';
  } catch (error) {
    fail('role-assignment-escalation-audit', error);
  } finally {
    if (scriptTimer) clearTimeout(scriptTimer);
    await saveReport();
  }

  if (report.status !== 'passed') {
    console.error(report.failure?.message || 'Role assignment escalation audit failed');
    process.exit(1);
  }

  console.log(`Role assignment escalation audit passed. Report: ${REPORT_PATH}`);
}

main();
