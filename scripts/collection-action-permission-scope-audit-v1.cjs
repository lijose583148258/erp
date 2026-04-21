/**
 * Collection action permission + data-scope audit.
 *
 * This validates the high-risk collection center mutation chain after fixed
 * role checks were replaced with dynamic permissions:
 * - A scoped sales owner can create reminders, promises, and disputes only for
 *   owned/private orders.
 * - A role with action permissions but no data scope is blocked by controller
 *   scope guards.
 * - Finance-visible roles can sync overdue amounts, verify payment records,
 *   and manage customer/order holds.
 */
const fs = require('fs');
const path = require('path');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'collection-action-permission-scope-audit-report-v1.json');
const REQUEST_TIMEOUT_MS = 10_000;
const SCRIPT_TIMEOUT_MS = 290_000;
const RUN_ID = `${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}_${process.pid}_${Math.random().toString(36).slice(2, 7)}`;
const PASSWORD = 'Audit12345';
const ADMIN = { username: 'admin', password: 'admin123' };

const DATA = {
  customerName: `COLL-CUST-${RUN_ID}`,
  productName: `COLL-PRODUCT-${RUN_ID}`,
  roles: {
    own: `coll_own_${RUN_ID}`.slice(0, 48),
    none: `coll_none_${RUN_ID}`.slice(0, 48),
    finance: `coll_fin_${RUN_ID}`.slice(0, 48),
  },
  users: {
    own: `coll_owner_${RUN_ID}`.slice(0, 48),
    none: `coll_none_user_${RUN_ID}`.slice(0, 48),
    finance: `coll_fin_user_${RUN_ID}`.slice(0, 48),
  },
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

async function login(username, password) {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    data: { username, password },
  });
  expectStatus(response, [200], `login:${username}`);
  const data = dataOf(response);
  expect(Boolean(data?.token), `login:${username} missing token`, response.json);
  return { token: data.token, user: data.user };
}

async function createRole(token, { code, dataScopes, permissions }) {
  const response = await apiFetch('/roles', {
    method: 'POST',
    data: {
      code,
      name: code,
      description: `Created by collection-action-permission-scope-audit-v1 ${RUN_ID}`,
      isActive: true,
      dataScopes,
      permissions,
    },
  }, token);
  expectStatus(response, [201], `create role ${code}`);
  return dataOf(response);
}

async function createTeamMember(token, { username, role, segment = 'direct' }) {
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

async function createCustomer(token) {
  const response = await apiFetch('/customers', {
    method: 'POST',
    data: {
      nameZh: DATA.customerName,
      nameEn: `Collection Customer ${RUN_ID}`,
      nameVi: `Khach hang collection ${RUN_ID}`,
      licenseNumber: `LIC-COLL-${RUN_ID}`,
      creditLimit: 100000,
      riskLevel: 'low',
      segment: 'direct',
      contactName: 'Collection Audit Contact',
      contactPhone: '0900000000',
      contactEmail: `collection-${RUN_ID}@example.com`,
      address: 'Collection audit address',
      status: 'active',
    },
  }, token);
  expectStatus(response, [201], 'create collection customer');
  const customer = dataOf(response);
  expect(Boolean(customer?.id), 'customer create returned no id', response.json);
  return customer;
}

async function createOrder(token, customerId) {
  const response = await apiFetch('/orders', {
    method: 'POST',
    data: {
      customerId: Number(customerId),
      items: [{
        productName: DATA.productName,
        specification: 'collection-action-audit',
        quantity: 3,
        unit: 'kg',
        unitPrice: 100,
      }],
      paymentTerms: 30,
      notes: `collection action audit ${RUN_ID}`,
    },
  }, token);
  expectStatus(response, [201], 'create collection order');
  const order = dataOf(response);
  expect(Boolean(order?.id), 'order create returned no id', response.json);
  return order;
}

async function recordPayment(token, orderId) {
  const response = await apiFetch(`/orders/${orderId}/payment`, {
    method: 'POST',
    data: {
      amount: 120,
      method: 'cash',
      payerName: 'collection-action-audit',
      note: `pending payment ${RUN_ID}`,
    },
  }, token);
  expectStatus(response, [200], 'record pending payment');
}

async function getPaymentIdFromLedger(token, customerId, orderId) {
  const response = await apiFetch(`/collections/ledger?customerId=${customerId}&pageSize=20`, {}, token);
  expectStatus(response, [200], 'ledger readback after payment');
  const row = listOf(response).find(item => Number(item.orderId) === Number(orderId) && Number(item.amount) === 120);
  expect(Boolean(row?.id), 'ledger did not expose pending payment id', response.json);
  return row.id;
}

async function getOrder(token, orderId) {
  const response = await apiFetch(`/orders/${orderId}`, {}, token);
  expectStatus(response, [200], `get order ${orderId}`);
  return dataOf(response);
}

async function expectEndpoint(label, endpoint, options, token, statuses) {
  const response = await apiFetch(endpoint, options, token);
  expectStatus(response, statuses, label);
  recordStep({
    step: 'endpoint-assert',
    label,
    endpoint,
    expected: statuses,
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
    recordStep({ step: 'admin-login', result: 'passed', adminUserId: admin.user.id });

    const permissionsResponse = await apiFetch('/roles/permissions', {}, admin.token);
    expectStatus(permissionsResponse, [200], 'list permission definitions');
    const permissionCodes = (dataOf(permissionsResponse) || []).map(item => item.code);
    for (const code of [
      'collections.sync',
      'collections.reminder.write',
      'collections.promise.write',
      'collections.dispute.write',
      'collections.hold.manage',
      'orders.payment.verify',
    ]) {
      expect(permissionCodes.includes(code), `permission registry missing ${code}`, permissionCodes);
    }
    recordStep({ step: 'permission-registry-readback', result: 'passed' });

    await createRole(admin.token, {
      code: DATA.roles.own,
      dataScopes: ['own_customers'],
      permissions: [
        'dashboard.read',
        'customers.read',
        'customers.create',
        'orders.read',
        'orders.create',
        'orders.payment.record',
        'collections.read',
        'collections.reminder.write',
        'collections.promise.write',
        'collections.dispute.write',
      ],
    });
    await createRole(admin.token, {
      code: DATA.roles.none,
      dataScopes: [],
      permissions: [
        'dashboard.read',
        'collections.read',
        'collections.sync',
        'collections.reminder.write',
        'collections.promise.write',
        'collections.dispute.write',
        'collections.hold.manage',
        'orders.payment.verify',
      ],
    });
    await createRole(admin.token, {
      code: DATA.roles.finance,
      dataScopes: ['finance_visible'],
      permissions: [
        'dashboard.read',
        'orders.read',
        'orders.payment.verify',
        'collections.read',
        'collections.sync',
        'collections.reminder.write',
        'collections.promise.write',
        'collections.dispute.write',
        'collections.hold.manage',
      ],
    });
    recordStep({ step: 'roles-created', result: 'passed' });

    await createTeamMember(admin.token, { username: DATA.users.own, role: DATA.roles.own });
    await createTeamMember(admin.token, { username: DATA.users.none, role: DATA.roles.none });
    await createTeamMember(admin.token, { username: DATA.users.finance, role: DATA.roles.finance });
    recordStep({ step: 'users-created', result: 'passed' });

    const own = await login(DATA.users.own, PASSWORD);
    const none = await login(DATA.users.none, PASSWORD);
    const finance = await login(DATA.users.finance, PASSWORD);
    recordStep({ step: 'custom-users-login', result: 'passed' });

    const customer = await createCustomer(own.token);
    const order = await createOrder(own.token, customer.id);
    await recordPayment(own.token, order.id);
    const paymentId = await getPaymentIdFromLedger(own.token, customer.id, order.id);
    recordStep({ step: 'seed-business-chain', result: 'passed', customerId: customer.id, orderId: order.id, paymentId });

    await expectEndpoint('no-scope cannot sync overdue', '/collections/sync-overdue', { method: 'POST' }, none.token, [403]);
    await expectEndpoint('finance can sync overdue', '/collections/sync-overdue', { method: 'POST' }, finance.token, [200]);

    await expectEndpoint('no-scope cannot verify payment', `/collections/payments/${paymentId}/verify`, { method: 'POST' }, none.token, [403]);
    await expectEndpoint('finance can verify payment', `/collections/payments/${paymentId}/verify`, { method: 'POST' }, finance.token, [200]);
    const orderAfterPayment = await getOrder(own.token, order.id);
    expect(Number(orderAfterPayment?.paidAmount) >= 120, 'verified payment did not update order paidAmount', orderAfterPayment);
    expect(['partial', 'paid'].includes(orderAfterPayment?.paymentStatus), 'verified payment did not update paymentStatus', orderAfterPayment);
    recordStep({ step: 'payment-verify-readback', result: 'passed', paidAmount: orderAfterPayment.paidAmount, paymentStatus: orderAfterPayment.paymentStatus });

    await expectEndpoint('no-scope cannot set customer hold', `/collections/customers/${customer.id}/hold`, {
      method: 'POST',
      data: { type: 'credit', reason: `blocked no scope ${RUN_ID}` },
    }, none.token, [403]);
    await expectEndpoint('finance can set customer hold', `/collections/customers/${customer.id}/hold`, {
      method: 'POST',
      data: { type: 'credit', reason: `finance hold ${RUN_ID}` },
    }, finance.token, [200]);
    await expectEndpoint('finance can release customer hold', `/collections/customers/${customer.id}/hold`, {
      method: 'DELETE',
      data: { type: 'credit' },
    }, finance.token, [200]);

    await expectEndpoint('no-scope cannot set order hold', `/collections/orders/${order.id}/shipment-hold`, {
      method: 'POST',
      data: { reason: `blocked no scope ${RUN_ID}` },
    }, none.token, [403]);
    await expectEndpoint('finance can set order hold', `/collections/orders/${order.id}/shipment-hold`, {
      method: 'POST',
      data: { reason: `finance order hold ${RUN_ID}` },
    }, finance.token, [200]);
    await expectEndpoint('finance can release order hold', `/collections/orders/${order.id}/shipment-hold`, {
      method: 'DELETE',
    }, finance.token, [200]);

    await expectEndpoint('owner can create reminder', `/collections/orders/${order.id}/remind`, { method: 'POST' }, own.token, [200]);
    await expectEndpoint('owner can create batch reminder', '/collections/orders/remind-batch', {
      method: 'POST',
      data: { orderIds: [order.id] },
    }, own.token, [200]);
    await expectEndpoint('no-scope cannot create reminder', `/collections/orders/${order.id}/remind`, { method: 'POST' }, none.token, [403]);

    const noScopePromise = await expectEndpoint('no-scope cannot create promise', '/collections/promises', {
      method: 'POST',
      data: {
        customerId: customer.id,
        orderId: order.id,
        promisedAmount: 80,
        promisedAt: new Date(Date.now() + 86_400_000).toISOString(),
        channel: 'phone',
        note: `blocked promise ${RUN_ID}`,
      },
    }, none.token, [403]);
    expect(noScopePromise.status === 403, 'no-scope promise unexpectedly passed', noScopePromise.json);

    const promiseResponse = await expectEndpoint('owner can create promise', '/collections/promises', {
      method: 'POST',
      data: {
        customerId: customer.id,
        orderId: order.id,
        promisedAmount: 80,
        promisedAt: new Date(Date.now() + 86_400_000).toISOString(),
        channel: 'phone',
        contactName: 'Collection Contact',
        contactPhone: '0900000001',
        note: `owner promise ${RUN_ID}`,
      },
    }, own.token, [201]);
    const promise = dataOf(promiseResponse);
    expect(Boolean(promise?.id), 'promise create returned no id', promiseResponse.json);
    await expectEndpoint('no-scope cannot update promise', `/collections/promises/${promise.id}/status`, {
      method: 'PATCH',
      data: { status: 'kept' },
    }, none.token, [403]);
    await expectEndpoint('owner can update promise', `/collections/promises/${promise.id}/status`, {
      method: 'PATCH',
      data: { status: 'kept' },
    }, own.token, [200]);

    await expectEndpoint('no-scope cannot create dispute', '/collections/disputes', {
      method: 'POST',
      data: {
        customerId: customer.id,
        orderId: order.id,
        disputedAmount: 30,
        reasonCategory: 'price',
        reason: `blocked dispute ${RUN_ID}`,
      },
    }, none.token, [403]);
    const disputeResponse = await expectEndpoint('owner can create dispute', '/collections/disputes', {
      method: 'POST',
      data: {
        customerId: customer.id,
        orderId: order.id,
        disputedAmount: 30,
        reasonCategory: 'price',
        reason: `owner dispute ${RUN_ID}`,
        note: 'dispute should create a scoped collection record',
      },
    }, own.token, [201]);
    const dispute = dataOf(disputeResponse);
    expect(Boolean(dispute?.id), 'dispute create returned no id', disputeResponse.json);
    await expectEndpoint('no-scope cannot update dispute', `/collections/disputes/${dispute.id}/status`, {
      method: 'PATCH',
      data: { status: 'reviewing' },
    }, none.token, [403]);
    await expectEndpoint('owner can update dispute', `/collections/disputes/${dispute.id}/status`, {
      method: 'PATCH',
      data: { status: 'resolved' },
    }, own.token, [200]);

    const promisesResponse = await apiFetch('/collections/promises', {}, own.token);
    expectStatus(promisesResponse, [200], 'promises readback');
    expect(listOf(promisesResponse).some(item => Number(item.id) === Number(promise.id)), 'created promise missing from scoped readback', promisesResponse.json);
    const disputesResponse = await apiFetch('/collections/disputes', {}, own.token);
    expectStatus(disputesResponse, [200], 'disputes readback');
    expect(listOf(disputesResponse).some(item => Number(item.id) === Number(dispute.id)), 'created dispute missing from scoped readback', disputesResponse.json);
    recordStep({ step: 'collection-record-readback', result: 'passed', promiseId: promise.id, disputeId: dispute.id });

    report.status = 'passed';
  } catch (error) {
    fail('main', error);
    throw error;
  } finally {
    clearTimeout(scriptTimer);
    await saveReport();
  }
}

main()
  .then(() => {
    console.log(`Collection action permission scope audit passed. Report: ${REPORT_PATH}`);
  })
  .catch((error) => {
    console.error(error?.stack || error);
    console.error(`Report: ${REPORT_PATH}`);
    process.exit(1);
  });
