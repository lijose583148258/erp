/**
 * Customer data-scope audit.
 *
 * Proves that dynamic role permissions and dataScopes affect the real
 * customer chain, not only the role-management screen.
 */
const fs = require('fs');
const path = require('path');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'customer-data-scope-audit-report-v1.json');
const REQUEST_TIMEOUT_MS = 10_000;
const SCRIPT_TIMEOUT_MS = 290_000;
const RUN_ID = `${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}_${process.pid}_${Math.random().toString(36).slice(2, 7)}`;

const ADMIN = { username: 'admin', password: 'admin123' };
const SALES = { username: 'sales', password: 'sales123' };

const DATA = {
  ownRoleCode: `scope_own_${RUN_ID}`.slice(0, 48),
  teamRoleCode: `scope_team_${RUN_ID}`.slice(0, 48),
  noneRoleCode: `scope_none_${RUN_ID}`.slice(0, 48),
  ownUsername: `scope_own_user_${RUN_ID}`.slice(0, 48),
  teamUsername: `scope_team_user_${RUN_ID}`.slice(0, 48),
  noneUsername: `scope_none_user_${RUN_ID}`.slice(0, 48),
  password: 'Audit12345',
  ownedName: `SCOPE-OWN-CUSTOMER-${RUN_ID}`,
  directPublicName: `SCOPE-DIRECT-PUBLIC-${RUN_ID}`,
  channelPublicName: `SCOPE-CHANNEL-PUBLIC-${RUN_ID}`,
  mixedPublicName: `SCOPE-MIXED-PUBLIC-${RUN_ID}`,
  otherPrivateName: `SCOPE-OTHER-PRIVATE-${RUN_ID}`,
};

const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  data: DATA,
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

function unwrapList(response) {
  const data = dataOf(response);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

function displayName(row) {
  return row?.nameZh || row?.nameEn || row?.nameVi || row?.name || '';
}

function listContains(rows, name) {
  return rows.some((row) => displayName(row) === name);
}

async function login(username, password, expectedStatuses = [200]) {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    data: { username, password },
  });
  expectStatus(response, expectedStatuses, `login:${username}`);
  if (response.status !== 200) return { token: null, user: null, response };
  const data = dataOf(response);
  expect(Boolean(data?.token), `login:${username} missing token`, response.json);
  expect(Boolean(data?.user?.role), `login:${username} missing role`, response.json);
  return { token: data.token, user: data.user, response };
}

async function createRole(token, { code, name, dataScopes, permissions }) {
  const response = await apiFetch('/roles', {
    method: 'POST',
    data: {
      code,
      name,
      description: `Created by customer-data-scope-audit-v1 ${RUN_ID}`,
      isActive: true,
      dataScopes,
      permissions,
    },
  }, token);
  expectStatus(response, [201], `create role ${code}`);
  return dataOf(response);
}

async function createTeamMember(token, { username, role, segment }) {
  const response = await apiFetch('/team', {
    method: 'POST',
    data: {
      username,
      password: DATA.password,
      email: `${username}@example.com`,
      role,
      segment,
    },
  }, token);
  expectStatus(response, [201], `create user ${username}`);
  return dataOf(response);
}

async function createCustomer(token, payload, expectedStatuses = [201]) {
  const response = await apiFetch('/customers', { method: 'POST', data: payload }, token);
  expectStatus(response, expectedStatuses, `create customer ${payload.nameZh || payload.name}`);
  return dataOf(response);
}

async function updateCustomer(token, id, payload, expectedStatuses = [200]) {
  const response = await apiFetch(`/customers/${id}`, { method: 'PUT', data: payload }, token);
  expectStatus(response, expectedStatuses, `update customer ${id}`);
  return dataOf(response);
}

async function searchCustomers(token, name) {
  const response = await apiFetch(`/customers?search=${encodeURIComponent(name)}&pageSize=20`, {}, token);
  expectStatus(response, [200], `search customer ${name}`);
  return unwrapList(response);
}

async function getStats(token) {
  const response = await apiFetch('/customers/stats', {}, token);
  expectStatus(response, [200], 'customer stats');
  return dataOf(response);
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
    const sales = await login(SALES.username, SALES.password);
    recordStep({
      step: 'login-built-in-users',
      result: 'passed',
      adminUserId: admin.user.id,
      salesUserId: sales.user.id,
    });

    await createRole(admin.token, {
      code: DATA.ownRoleCode,
      name: `Own scope ${RUN_ID}`.slice(0, 80),
      dataScopes: ['own_customers'],
      permissions: ['dashboard.read', 'customers.read', 'customers.create'],
    });
    await createRole(admin.token, {
      code: DATA.teamRoleCode,
      name: `Team scope ${RUN_ID}`.slice(0, 80),
      dataScopes: ['team_customers'],
      permissions: ['dashboard.read', 'customers.read'],
    });
    await createRole(admin.token, {
      code: DATA.noneRoleCode,
      name: `No scope ${RUN_ID}`.slice(0, 80),
      dataScopes: [],
      permissions: ['dashboard.read', 'customers.read'],
    });
    recordStep({ step: 'create-dynamic-roles', result: 'passed' });

    const ownUser = await createTeamMember(admin.token, {
      username: DATA.ownUsername,
      role: DATA.ownRoleCode,
      segment: 'direct',
    });
    const teamUser = await createTeamMember(admin.token, {
      username: DATA.teamUsername,
      role: DATA.teamRoleCode,
      segment: 'direct',
    });
    const noneUser = await createTeamMember(admin.token, {
      username: DATA.noneUsername,
      role: DATA.noneRoleCode,
      segment: 'direct',
    });
    recordStep({
      step: 'create-dynamic-role-users',
      result: 'passed',
      ownUserId: ownUser.id,
      teamUserId: teamUser.id,
      noneUserId: noneUser.id,
    });

    const ownLogin = await login(DATA.ownUsername, DATA.password);
    const teamLogin = await login(DATA.teamUsername, DATA.password);
    const noneLogin = await login(DATA.noneUsername, DATA.password);
    expect(ownLogin.user.permissions.includes('customers.create'), 'own role login missing customers.create', ownLogin.user);
    expect(!ownLogin.user.permissions.includes('customers.update'), 'own role should not have customers.update before grant', ownLogin.user);
    recordStep({
      step: 'login-dynamic-role-users',
      result: 'passed',
      ownPermissions: ownLogin.user.permissions,
      teamPermissions: teamLogin.user.permissions,
      nonePermissions: noneLogin.user.permissions,
    });

    const ownedCustomer = await createCustomer(ownLogin.token, {
      nameZh: DATA.ownedName,
      nameEn: `Owned ${RUN_ID}`,
      licenseNumber: `LIC-OWN-${RUN_ID}`,
      creditLimit: 1000,
      riskLevel: 'low',
      segment: 'direct',
      contactName: 'Own Contact',
      contactPhone: '0900000000',
      contactEmail: `own-${RUN_ID}@example.com`,
      addresses: [{
        type: 'legal',
        label: 'Legal',
        countryCode: 'VN',
        fullAddress: `Owned address ${RUN_ID}`,
        isPrimary: true,
      }],
    });
    expect(Number(ownedCustomer.salespersonId) === Number(ownUser.id), 'custom own role did not auto-own created private customer', ownedCustomer);
    recordStep({ step: 'custom-own-role-create-customer', result: 'passed', customerId: ownedCustomer.id });

    const updateWithoutPermission = await apiFetch(`/customers/${ownedCustomer.id}`, {
      method: 'PUT',
      data: { notes: 'should be forbidden before customers.update grant' },
    }, ownLogin.token);
    expectStatus(updateWithoutPermission, [403], 'create-only role must not update');
    recordStep({ step: 'customers-create-update-permission-split', result: 'passed', updateStatus: updateWithoutPermission.status });

    const directPublicCustomer = await createCustomer(admin.token, {
      nameZh: DATA.directPublicName,
      nameEn: `Direct public ${RUN_ID}`,
      licenseNumber: `LIC-DP-${RUN_ID}`,
      creditLimit: 2000,
      riskLevel: 'low',
      segment: 'direct',
      poolState: 'public',
    });
    const channelPublicCustomer = await createCustomer(admin.token, {
      nameZh: DATA.channelPublicName,
      nameEn: `Channel public ${RUN_ID}`,
      licenseNumber: `LIC-CP-${RUN_ID}`,
      creditLimit: 3000,
      riskLevel: 'low',
      segment: 'channel',
      poolState: 'public',
    });
    const mixedPublicCustomer = await createCustomer(admin.token, {
      nameZh: DATA.mixedPublicName,
      nameEn: `Mixed public ${RUN_ID}`,
      licenseNumber: `LIC-MP-${RUN_ID}`,
      creditLimit: 4000,
      riskLevel: 'low',
      segment: 'mixed',
      poolState: 'public',
    });
    const otherPrivateCustomer = await createCustomer(admin.token, {
      nameZh: DATA.otherPrivateName,
      nameEn: `Other private ${RUN_ID}`,
      licenseNumber: `LIC-OP-${RUN_ID}`,
      creditLimit: 5000,
      riskLevel: 'medium',
      segment: 'direct',
      poolState: 'private',
      salespersonId: Number(sales.user.id),
    });
    report.created = {
      ownedCustomerId: ownedCustomer.id,
      directPublicCustomerId: directPublicCustomer.id,
      channelPublicCustomerId: channelPublicCustomer.id,
      mixedPublicCustomerId: mixedPublicCustomer.id,
      otherPrivateCustomerId: otherPrivateCustomer.id,
    };
    recordStep({ step: 'create-scope-fixtures', result: 'passed', ...report.created });

    const ownSeesOwn = await searchCustomers(ownLogin.token, DATA.ownedName);
    const ownSeesDirectPublic = await searchCustomers(ownLogin.token, DATA.directPublicName);
    const ownSeesOtherPrivate = await searchCustomers(ownLogin.token, DATA.otherPrivateName);
    expect(listContains(ownSeesOwn, DATA.ownedName), 'own_customers role cannot see self-owned customer');
    expect(!listContains(ownSeesDirectPublic, DATA.directPublicName), 'own_customers role should not see public customers by scope alone');
    expect(!listContains(ownSeesOtherPrivate, DATA.otherPrivateName), 'own_customers role should not see another private customer');
    recordStep({
      step: 'verify-own-customer-scope',
      result: 'passed',
      ownVisible: true,
      directPublicHidden: true,
      otherPrivateHidden: true,
    });

    const teamSeesDirectPublic = await searchCustomers(teamLogin.token, DATA.directPublicName);
    const teamSeesMixedPublic = await searchCustomers(teamLogin.token, DATA.mixedPublicName);
    const teamSeesChannelPublic = await searchCustomers(teamLogin.token, DATA.channelPublicName);
    expect(listContains(teamSeesDirectPublic, DATA.directPublicName), 'team_customers direct role cannot see direct customer');
    expect(listContains(teamSeesMixedPublic, DATA.mixedPublicName), 'team_customers direct role cannot see mixed customer');
    expect(!listContains(teamSeesChannelPublic, DATA.channelPublicName), 'team_customers direct role should not see channel customer');
    recordStep({
      step: 'verify-team-customer-scope',
      result: 'passed',
      directVisible: true,
      mixedVisible: true,
      channelHidden: true,
    });

    const noneList = await searchCustomers(noneLogin.token, DATA.directPublicName);
    const noneStats = await getStats(noneLogin.token);
    expect(!listContains(noneList, DATA.directPublicName), 'customers.read without dataScopes should not see customers');
    expect(Number(noneStats.totalCustomers || 0) === 0, 'customers.read without dataScopes should return zero scoped stats', noneStats);
    recordStep({
      step: 'verify-no-data-scope-denies-customer-data',
      result: 'passed',
      noneStats,
    });

    const ownOtherDetail = await apiFetch(`/customers/${otherPrivateCustomer.id}`, {}, ownLogin.token);
    expectStatus(ownOtherDetail, [404], 'own role detail for another private customer');
    const teamChannelDetail = await apiFetch(`/customers/${channelPublicCustomer.id}`, {}, teamLogin.token);
    expectStatus(teamChannelDetail, [404], 'team role detail for channel customer');
    recordStep({
      step: 'verify-detail-scope',
      result: 'passed',
      ownOtherDetailStatus: ownOtherDetail.status,
      teamChannelDetailStatus: teamChannelDetail.status,
    });

    const grantUpdate = await apiFetch(`/roles/${DATA.ownRoleCode}`, {
      method: 'PUT',
      data: {
        name: `Own scope ${RUN_ID}`.slice(0, 80),
        description: `Grant customers.update ${RUN_ID}`,
        isActive: true,
        dataScopes: ['own_customers'],
        permissions: ['dashboard.read', 'customers.read', 'customers.create', 'customers.update'],
      },
    }, admin.token);
    expectStatus(grantUpdate, [200], 'grant customers.update to own role');
    const ownRelogin = await login(DATA.ownUsername, DATA.password);
    expect(ownRelogin.user.permissions.includes('customers.update'), 'updated own role login missing customers.update', ownRelogin.user);
    const updatedOwned = await updateCustomer(ownRelogin.token, ownedCustomer.id, {
      notes: `updated by dynamic own scope ${RUN_ID}`,
    });
    expect(String(updatedOwned.notes || '').includes(RUN_ID), 'own role update readback did not preserve notes', updatedOwned);
    recordStep({ step: 'verify-custom-own-update-after-grant', result: 'passed' });

    report.status = 'passed';
  } catch (error) {
    fail('customer-data-scope-audit', error);
  } finally {
    if (scriptTimer) clearTimeout(scriptTimer);
    await saveReport();
  }

  if (report.status !== 'passed') {
    console.error(report.failure?.message || 'Customer data-scope audit failed');
    process.exit(1);
  }

  console.log(`Customer data-scope audit passed. Report: ${REPORT_PATH}`);
}

main();
