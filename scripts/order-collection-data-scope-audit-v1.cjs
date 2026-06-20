/**
 * Order and collection data-scope audit.
 *
 * This proves custom roles do not only pass menu permission checks. They must
 * also receive correctly scoped order, payment, and collection data.
 */
const fs = require('fs');
const path = require('path');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'order-collection-data-scope-audit-report-v1.json');
const REQUEST_TIMEOUT_MS = 10_000;
const SCRIPT_TIMEOUT_MS = 290_000;
const RUN_ID = `${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}_${process.pid}_${Math.random().toString(36).slice(2, 7)}`;

const ADMIN = { username: 'admin', password: 'admin123' };
const PASSWORD = 'Audit12345';

const DATA = {
  ownRoleCode: `oc_own_${RUN_ID}`.slice(0, 48),
  teamRoleCode: `oc_team_${RUN_ID}`.slice(0, 48),
  noneRoleCode: `oc_none_${RUN_ID}`.slice(0, 48),
  ownUsername: `oc_own_user_${RUN_ID}`.slice(0, 48),
  teamUsername: `oc_team_user_${RUN_ID}`.slice(0, 48),
  noneUsername: `oc_none_user_${RUN_ID}`.slice(0, 48),
  ownedCustomerName: `OC-OWN-CUSTOMER-${RUN_ID}`,
  directPublicCustomerName: `OC-DIRECT-PUBLIC-${RUN_ID}`,
  channelPublicCustomerName: `OC-CHANNEL-PUBLIC-${RUN_ID}`,
  ownedProductName: `OC-OWN-PRODUCT-${RUN_ID}`,
  directProductName: `OC-DIRECT-PRODUCT-${RUN_ID}`,
  channelProductName: `OC-CHANNEL-PRODUCT-${RUN_ID}`,
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

function listOf(response) {
  const data = dataOf(response);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
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
  return { token: data.token, user: data.user, response };
}

async function createRole(token, { code, name, dataScopes, permissions }) {
  const response = await apiFetch('/roles', {
    method: 'POST',
    data: {
      code,
      name,
      description: `Created by order-collection-data-scope-audit-v1 ${RUN_ID}`,
      isActive: true,
      dataScopes,
      permissions,
    },
  }, token);
  expectStatus(response, [201], `create role ${code}`);
  return dataOf(response);
}

async function updateRole(token, code, { name, dataScopes, permissions }) {
  const response = await apiFetch(`/roles/${code}`, {
    method: 'PUT',
    data: {
      name,
      description: `Updated by order-collection-data-scope-audit-v1 ${RUN_ID}`,
      isActive: true,
      dataScopes,
      permissions,
    },
  }, token);
  expectStatus(response, [200], `update role ${code}`);
  return dataOf(response);
}

async function createTeamMember(token, { username, role, segment }) {
  const response = await apiFetch('/team', {
    method: 'POST',
    data: {
      username,
      password: PASSWORD,
      email: `${username}@example.com`,
      role,
      segment,
    },
  }, token);
  expectStatus(response, [201], `create user ${username}`);
  return dataOf(response);
}

async function createCustomer(token, payload) {
  const response = await apiFetch('/customers', { method: 'POST', data: payload }, token);
  expectStatus(response, [201], `create customer ${payload.nameZh || payload.name}`);
  return dataOf(response);
}

async function createOrder(token, customerId, productName) {
  const response = await apiFetch('/orders', {
    method: 'POST',
    data: {
      customerId: Number(customerId),
      items: [{
        productName,
        specification: 'scope-audit',
        quantity: 2,
        unit: 'kg',
        unitPrice: 120,
      }],
      paymentTerms: 30,
      notes: `order collection scope audit ${RUN_ID}`,
    },
  }, token);
  expectStatus(response, [201], `create order ${productName}`);
  return dataOf(response);
}

async function recordPayment(token, orderId, amount, note) {
  const response = await apiFetch(`/orders/${orderId}/payment`, {
    method: 'POST',
    data: {
      amount,
      method: 'cash',
      payerName: 'scope-audit',
      note,
    },
  }, token);
  expectStatus(response, [200], `record payment ${orderId}`);
  return dataOf(response);
}

async function searchOrders(token, orderNo) {
  const response = await apiFetch(`/orders?search=${encodeURIComponent(orderNo)}&pageSize=20`, {}, token);
  expectStatus(response, [200], `search order ${orderNo}`);
  return listOf(response);
}

async function getOrder(token, orderId, expectedStatuses = [200]) {
  const response = await apiFetch(`/orders/${orderId}`, {}, token);
  expectStatus(response, expectedStatuses, `get order ${orderId}`);
  return response;
}

async function getCollectionLedger(token, customerId) {
  const response = await apiFetch(`/collections/ledger?customerId=${customerId}&pageSize=20`, {}, token);
  expectStatus(response, [200], `collection ledger ${customerId}`);
  return listOf(response);
}

function containsOrder(rows, orderNo) {
  return rows.some((row) => row.orderNo === orderNo);
}

function containsLedgerOrder(rows, orderNo) {
  return rows.some((row) => row.orderNo === orderNo);
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
    recordStep({ step: 'admin-login', result: 'passed', adminUserId: admin.user.id });

    const ownPermissions = [
      'dashboard.read',
      'customers.read',
      'customers.create',
      'orders.read',
      'orders.create',
      'orders.payment.record',
      'collections.read',
    ];
    await createRole(admin.token, {
      code: DATA.ownRoleCode,
      name: `OC own ${RUN_ID}`.slice(0, 80),
      dataScopes: ['own_customers'],
      permissions: ownPermissions,
    });
    await createRole(admin.token, {
      code: DATA.teamRoleCode,
      name: `OC team ${RUN_ID}`.slice(0, 80),
      dataScopes: ['team_customers'],
      permissions: ['dashboard.read', 'customers.read', 'orders.read', 'collections.read'],
    });
    await createRole(admin.token, {
      code: DATA.noneRoleCode,
      name: `OC none ${RUN_ID}`.slice(0, 80),
      dataScopes: [],
      permissions: ['dashboard.read', 'orders.read', 'collections.read'],
    });
    recordStep({ step: 'create-custom-roles', result: 'passed' });

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
      step: 'create-custom-users',
      result: 'passed',
      ownUserId: ownUser.id,
      teamUserId: teamUser.id,
      noneUserId: noneUser.id,
    });

    const ownLogin = await login(DATA.ownUsername, PASSWORD);
    const teamLogin = await login(DATA.teamUsername, PASSWORD);
    const noneLogin = await login(DATA.noneUsername, PASSWORD);
    recordStep({
      step: 'login-custom-users',
      result: 'passed',
      ownPermissions: ownLogin.user.permissions,
      teamPermissions: teamLogin.user.permissions,
      nonePermissions: noneLogin.user.permissions,
    });

    const ownedCustomer = await createCustomer(ownLogin.token, {
      nameZh: DATA.ownedCustomerName,
      nameEn: `Owned customer ${RUN_ID}`,
      licenseNumber: `OC-OWN-${RUN_ID}`,
      creditLimit: 100000,
      riskLevel: 'low',
      segment: 'direct',
      contactName: 'Own contact',
      contactPhone: '0900000000',
      contactEmail: `oc-own-${RUN_ID}@example.com`,
    });
    const directCustomer = await createCustomer(admin.token, {
      nameZh: DATA.directPublicCustomerName,
      nameEn: `Direct public customer ${RUN_ID}`,
      licenseNumber: `OC-DIRECT-${RUN_ID}`,
      creditLimit: 100000,
      riskLevel: 'low',
      segment: 'direct',
      poolState: 'public',
    });
    const channelCustomer = await createCustomer(admin.token, {
      nameZh: DATA.channelPublicCustomerName,
      nameEn: `Channel public customer ${RUN_ID}`,
      licenseNumber: `OC-CHANNEL-${RUN_ID}`,
      creditLimit: 100000,
      riskLevel: 'low',
      segment: 'channel',
      poolState: 'public',
    });
    recordStep({
      step: 'create-customers',
      result: 'passed',
      ownedCustomerId: ownedCustomer.id,
      directCustomerId: directCustomer.id,
      channelCustomerId: channelCustomer.id,
    });

    const ownedOrder = await createOrder(ownLogin.token, ownedCustomer.id, DATA.ownedProductName);
    const directOrder = await createOrder(admin.token, directCustomer.id, DATA.directProductName);
    const channelOrder = await createOrder(admin.token, channelCustomer.id, DATA.channelProductName);
    await recordPayment(ownLogin.token, ownedOrder.id, 10, `own payment ${RUN_ID}`);
    await recordPayment(admin.token, directOrder.id, 11, `direct payment ${RUN_ID}`);
    await recordPayment(admin.token, channelOrder.id, 12, `channel payment ${RUN_ID}`);
    report.created = {
      ownedOrderId: ownedOrder.id,
      ownedOrderNo: ownedOrder.orderNo,
      directOrderId: directOrder.id,
      directOrderNo: directOrder.orderNo,
      channelOrderId: channelOrder.id,
      channelOrderNo: channelOrder.orderNo,
    };
    recordStep({ step: 'create-orders-and-payments', result: 'passed', ...report.created });

    const ownOwnedRows = await searchOrders(ownLogin.token, ownedOrder.orderNo);
    const ownDirectRows = await searchOrders(ownLogin.token, directOrder.orderNo);
    expect(containsOrder(ownOwnedRows, ownedOrder.orderNo), 'own scope cannot see own order');
    expect(!containsOrder(ownDirectRows, directOrder.orderNo), 'own scope should not see direct public order');
    await getOrder(ownLogin.token, directOrder.id, [404]);
    recordStep({ step: 'verify-own-order-scope', result: 'passed' });

    const updateWithoutPermission = await apiFetch(`/orders/${ownedOrder.id}`, {
      method: 'PUT',
      data: { notes: `should be denied ${RUN_ID}` },
    }, ownLogin.token);
    expectStatus(updateWithoutPermission, [403], 'own create/payment role must not update order');
    recordStep({ step: 'verify-order-create-update-permission-split', result: 'passed' });

    const teamDirectRows = await searchOrders(teamLogin.token, directOrder.orderNo);
    const teamChannelRows = await searchOrders(teamLogin.token, channelOrder.orderNo);
    expect(containsOrder(teamDirectRows, directOrder.orderNo), 'team scope cannot see direct order');
    expect(!containsOrder(teamChannelRows, channelOrder.orderNo), 'team direct scope should not see channel order');
    await getOrder(teamLogin.token, channelOrder.id, [404]);
    recordStep({ step: 'verify-team-order-scope', result: 'passed' });

    const noneStats = await apiFetch('/orders/stats', {}, noneLogin.token);
    expectStatus(noneStats, [200], 'none scope order stats');
    expect(Number(dataOf(noneStats)?.total || 0) === 0, 'orders.read without dataScopes should see zero orders', noneStats.json);
    const noneSummary = await apiFetch('/collections/summary', {}, noneLogin.token);
    expectStatus(noneSummary, [200], 'none scope collection summary');
    expect(Number(dataOf(noneSummary)?.totalOrders || 0) === 0, 'collections.read without dataScopes should see zero orders', noneSummary.json);
    recordStep({ step: 'verify-no-data-scope-orders-and-collections', result: 'passed' });

    const ownLedgerOwn = await getCollectionLedger(ownLogin.token, ownedCustomer.id);
    const ownLedgerDirect = await getCollectionLedger(ownLogin.token, directCustomer.id);
    expect(containsLedgerOrder(ownLedgerOwn, ownedOrder.orderNo), 'own scope cannot see own payment ledger');
    expect(!containsLedgerOrder(ownLedgerDirect, directOrder.orderNo), 'own scope should not see direct public payment ledger');
    const teamLedgerDirect = await getCollectionLedger(teamLogin.token, directCustomer.id);
    const teamLedgerChannel = await getCollectionLedger(teamLogin.token, channelCustomer.id);
    expect(containsLedgerOrder(teamLedgerDirect, directOrder.orderNo), 'team scope cannot see direct payment ledger');
    expect(!containsLedgerOrder(teamLedgerChannel, channelOrder.orderNo), 'team direct scope should not see channel payment ledger');
    recordStep({ step: 'verify-collection-ledger-scope', result: 'passed' });

    await updateRole(admin.token, DATA.ownRoleCode, {
      name: `OC own ${RUN_ID}`.slice(0, 80),
      dataScopes: ['own_customers'],
      permissions: [...ownPermissions, 'orders.update'],
    });
    const ownRelogin = await login(DATA.ownUsername, PASSWORD);
    expect(ownRelogin.user.permissions.includes('orders.update'), 'updated role login missing orders.update', ownRelogin.user);
    const updateOwned = await apiFetch(`/orders/${ownedOrder.id}`, {
      method: 'PUT',
      data: { notes: `updated by own scope ${RUN_ID}` },
    }, ownRelogin.token);
    expectStatus(updateOwned, [200], 'own role update after grant');
    expect(String(dataOf(updateOwned)?.notes || '').includes(RUN_ID), 'updated order notes did not read back', updateOwned.json);
    recordStep({ step: 'verify-order-update-after-grant', result: 'passed' });

    report.status = 'passed';
  } catch (error) {
    fail('order-collection-data-scope-audit', error);
  } finally {
    if (scriptTimer) clearTimeout(scriptTimer);
    await saveReport();
  }

  if (report.status !== 'passed') {
    console.error(report.failure?.message || 'Order collection data-scope audit failed');
    process.exit(1);
  }

  console.log(`Order collection data-scope audit passed. Report: ${REPORT_PATH}`);
}

main();
