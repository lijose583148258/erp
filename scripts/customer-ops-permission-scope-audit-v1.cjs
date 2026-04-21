/**
 * Customer operations permission + data-scope audit.
 *
 * This verifies the customer-facing operational chain after route-level
 * role whitelists were migrated to dynamic permissions:
 * - Contracts: read/write must require both permission and customer scope.
 * - Samples: create/status/list must respect customer or warehouse scope.
 * - RMA: create/list/resolve must respect customer or team scope.
 * - Shipping: write must require warehouse scope; receipt read may use
 *   customer, warehouse, or finance scope.
 */
const fs = require('fs');
const path = require('path');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'customer-ops-permission-scope-audit-report-v1.json');
const REQUEST_TIMEOUT_MS = 10_000;
const SCRIPT_TIMEOUT_MS = 290_000;
const RUN_ID = `${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}_${process.pid}_${Math.random().toString(36).slice(2, 7)}`;
const PASSWORD = 'Audit12345';
const ADMIN = { username: 'admin', password: 'admin123' };

const DATA = {
  customerName: `OPS-CUST-${RUN_ID}`,
  contractTitle: `OPS-CONTRACT-${RUN_ID}`,
  sampleProduct: `OPS-SAMPLE-${RUN_ID}`,
  rmaProduct: `OPS-RMA-${RUN_ID}`,
  shippingProduct: `OPS-SHIP-${RUN_ID}`,
  roles: {
    own: `custops_own_${RUN_ID}`.slice(0, 48),
    none: `custops_none_${RUN_ID}`.slice(0, 48),
    warehouse: `custops_wh_${RUN_ID}`.slice(0, 48),
    financeReceipt: `custops_fin_${RUN_ID}`.slice(0, 48),
    teamResolver: `custops_team_${RUN_ID}`.slice(0, 48),
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

function rowHasValue(rows, field, value) {
  return rows.some((row) => String(row?.[field] || '') === String(value));
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
      description: `Created by customer-ops-permission-scope-audit-v1 ${RUN_ID}`,
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
      nameEn: `Customer ${RUN_ID}`,
      nameVi: `Khach hang ${RUN_ID}`,
      licenseNumber: `LIC-CUSTOPS-${RUN_ID}`,
      creditLimit: 1000,
      riskLevel: 'low',
      segment: 'direct',
      contactName: 'Audit Contact',
      contactPhone: '0900000000',
      contactEmail: `custops-${RUN_ID}@example.com`,
      address: 'Audit Address',
      status: 'active',
    },
  }, token);
  expectStatus(response, [201], 'create scoped customer');
  const customer = dataOf(response);
  expect(Boolean(customer?.id), 'customer create returned no id', response.json);
  return customer;
}

async function createContract(token, customerId) {
  const response = await apiFetch('/contracts', {
    method: 'POST',
    data: {
      customerId,
      title: DATA.contractTitle,
      type: 'sales',
      totalAmount: 1234.56,
      currency: 'CNY',
      notes: `customer ops audit ${RUN_ID}`,
    },
  }, token);
  expectStatus(response, [201], 'create scoped contract');
  const contract = dataOf(response);
  expect(Boolean(contract?.id), 'contract create returned no id', response.json);
  return contract;
}

async function createSample(token, customerId) {
  const response = await apiFetch('/samples', {
    method: 'POST',
    data: {
      customerId,
      productName: DATA.sampleProduct,
      quantity: 2,
      unit: 'kg',
      shippingAddress: 'Audit sample address',
    },
  }, token);
  expectStatus(response, [201], 'create scoped sample');
  const sample = dataOf(response);
  expect(Boolean(sample?.id), 'sample create returned no id', response.json);
  return sample;
}

async function createRma(token, customerId) {
  const response = await apiFetch('/rma', {
    method: 'POST',
    data: {
      customerId,
      productName: DATA.rmaProduct,
      quantity: 1,
      unit: 'kg',
      reason: `customer ops audit ${RUN_ID}`,
    },
  }, token);
  expectStatus(response, [201], 'create scoped rma');
  const rma = dataOf(response);
  expect(Boolean(rma?.id), 'rma create returned no id', response.json);
  return rma;
}

async function createShipment(token, customerId) {
  const response = await apiFetch('/shipping', {
    method: 'POST',
    data: {
      customerId,
      productName: DATA.shippingProduct,
      quantity: 1,
      unit: 'kg',
      packageType: 'box',
      carrier: 'Audit Carrier',
    },
  }, token);
  expectStatus(response, [201], 'create scoped shipment');
  const shipment = dataOf(response);
  expect(Boolean(shipment?.id), 'shipment create returned no id', response.json);
  return shipment;
}

async function makeUsers(adminToken) {
  const roleSpecs = [
    {
      key: 'own',
      dataScopes: ['own_customers'],
      permissions: [
        'customers.read',
        'customers.create',
        'contracts.read',
        'contracts.write',
        'samples.read',
        'samples.create',
        'samples.status.manage',
        'rma.read',
        'rma.write',
        'shipping.read',
        'shipping.receipts.read',
      ],
    },
    {
      key: 'none',
      dataScopes: [],
      permissions: [
        'contracts.read',
        'contracts.write',
        'samples.read',
        'samples.status.manage',
        'rma.read',
        'rma.resolve',
        'shipping.read',
        'shipping.write',
        'shipping.receipts.read',
      ],
    },
    {
      key: 'warehouse',
      dataScopes: ['warehouse_visible'],
      permissions: [
        'samples.read',
        'samples.status.manage',
        'shipping.read',
        'shipping.write',
        'shipping.receipts.read',
      ],
    },
    {
      key: 'financeReceipt',
      dataScopes: ['finance_visible'],
      permissions: ['shipping.receipts.read'],
    },
    {
      key: 'teamResolver',
      dataScopes: ['team_customers'],
      permissions: ['rma.read', 'rma.resolve'],
    },
  ];

  const users = {};
  for (const spec of roleSpecs) {
    const roleCode = DATA.roles[spec.key];
    const username = `${spec.key}_${RUN_ID}`.slice(0, 48);
    await createRole(adminToken, {
      code: roleCode,
      dataScopes: spec.dataScopes,
      permissions: spec.permissions,
    });
    await createTeamMember(adminToken, {
      username,
      role: roleCode,
      segment: 'direct',
    });
    users[spec.key] = await login(username, PASSWORD);
  }

  recordStep({ step: 'create-dynamic-users', result: 'passed', users: Object.keys(users) });
  return users;
}

async function verifyContracts(users, customer, contract) {
  const ownList = await apiFetch(`/contracts?customerId=${customer.id}&pageSize=20`, {}, users.own.token);
  expectStatus(ownList, [200], 'own contract list');
  expect(rowHasValue(listOf(ownList), 'contractNo', contract.contractNo), 'own scoped user should see contract fixture', ownList.json);

  const noneList = await apiFetch(`/contracts?customerId=${customer.id}&pageSize=20`, {}, users.none.token);
  expectStatus(noneList, [200], 'no-scope contract list');
  expect(!rowHasValue(listOf(noneList), 'contractNo', contract.contractNo), 'contracts.read without customer scope leaked contract fixture', noneList.json);

  const noneDetail = await apiFetch(`/contracts/${contract.id}`, {}, users.none.token);
  expectStatus(noneDetail, [404], 'no-scope contract detail');

  const noneCreate = await apiFetch('/contracts', {
    method: 'POST',
    data: {
      customerId: customer.id,
      title: `${DATA.contractTitle}-DENIED`,
      type: 'sales',
      totalAmount: 1,
      currency: 'CNY',
    },
  }, users.none.token);
  expectStatus(noneCreate, [403], 'no-scope contract create denied by customer scope');

  recordStep({ step: 'contracts-scope', result: 'passed', contractId: contract.id });
}

async function verifySamples(users, customer, sample) {
  const ownList = await apiFetch(`/samples?customerId=${customer.id}&pageSize=20`, {}, users.own.token);
  expectStatus(ownList, [200], 'own sample list');
  expect(rowHasValue(listOf(ownList), 'sampleNo', sample.sampleNo), 'own scoped user should see sample fixture', ownList.json);

  const noneList = await apiFetch(`/samples?customerId=${customer.id}&pageSize=20`, {}, users.none.token);
  expectStatus(noneList, [200], 'no-scope sample list');
  expect(!rowHasValue(listOf(noneList), 'sampleNo', sample.sampleNo), 'samples.read without scope leaked sample fixture', noneList.json);

  const warehouseStatus = await apiFetch(`/samples/${sample.id}/status`, {
    method: 'PATCH',
    data: { status: 'sent', trackingNo: `TRK-${RUN_ID}` },
  }, users.warehouse.token);
  expectStatus(warehouseStatus, [200], 'warehouse scoped sample status update');

  const noneStatus = await apiFetch(`/samples/${sample.id}/status`, {
    method: 'PATCH',
    data: { status: 'testing' },
  }, users.none.token);
  expectStatus(noneStatus, [403], 'no-scope sample status denied');

  recordStep({ step: 'samples-scope', result: 'passed', sampleId: sample.id });
}

async function verifyRma(users, customer, rma) {
  const ownList = await apiFetch(`/rma?customerId=${customer.id}&pageSize=20`, {}, users.own.token);
  expectStatus(ownList, [200], 'own rma list');
  expect(rowHasValue(listOf(ownList), 'rmaNo', rma.rmaNo), 'own scoped user should see rma fixture', ownList.json);

  const noneList = await apiFetch(`/rma?customerId=${customer.id}&pageSize=20`, {}, users.none.token);
  expectStatus(noneList, [200], 'no-scope rma list');
  expect(!rowHasValue(listOf(noneList), 'rmaNo', rma.rmaNo), 'rma.read without scope leaked rma fixture', noneList.json);

  const noneResolve = await apiFetch(`/rma/${rma.id}/resolve`, {
    method: 'PATCH',
    data: { status: 'approved', resolution: 'denied scope should fail', refundAmount: 0 },
  }, users.none.token);
  expectStatus(noneResolve, [403], 'no-scope rma resolve denied');

  const teamResolve = await apiFetch(`/rma/${rma.id}/resolve`, {
    method: 'PATCH',
    data: { status: 'approved', resolution: `team resolved ${RUN_ID}`, refundAmount: 0 },
  }, users.teamResolver.token);
  expectStatus(teamResolve, [200], 'team scoped rma resolve');

  recordStep({ step: 'rma-scope', result: 'passed', rmaId: rma.id });
}

async function verifyShipping(users, customer, shipment) {
  const ownList = await apiFetch(`/shipping?customerId=${customer.id}&pageSize=20`, {}, users.own.token);
  expectStatus(ownList, [200], 'own shipping list');
  expect(rowHasValue(listOf(ownList), 'shipmentNo', shipment.shipmentNo), 'own scoped user should see shipment fixture', ownList.json);

  const noneList = await apiFetch(`/shipping?customerId=${customer.id}&pageSize=20`, {}, users.none.token);
  expectStatus(noneList, [200], 'no-scope shipping list');
  expect(!rowHasValue(listOf(noneList), 'shipmentNo', shipment.shipmentNo), 'shipping.read without scope leaked shipment fixture', noneList.json);

  const noneCreate = await apiFetch('/shipping', {
    method: 'POST',
    data: {
      customerId: customer.id,
      productName: `${DATA.shippingProduct}-DENIED`,
      quantity: 1,
      unit: 'kg',
    },
  }, users.none.token);
  expectStatus(noneCreate, [403], 'shipping.write without warehouse scope denied');

  const ownReceipts = await apiFetch(`/shipping/${shipment.id}/receipts`, {}, users.own.token);
  expectStatus(ownReceipts, [200], 'own receipt read');
  expect(dataOf(ownReceipts)?.shipment?.shipmentNo === shipment.shipmentNo, 'own receipt readback mismatch', ownReceipts.json);

  const financeReceipts = await apiFetch(`/shipping/${shipment.id}/receipts`, {}, users.financeReceipt.token);
  expectStatus(financeReceipts, [200], 'finance receipt read');
  expect(dataOf(financeReceipts)?.shipment?.shipmentNo === shipment.shipmentNo, 'finance receipt readback mismatch', financeReceipts.json);

  const noneReceipts = await apiFetch(`/shipping/${shipment.id}/receipts`, {}, users.none.token);
  expectStatus(noneReceipts, [404], 'no-scope receipt read hidden');

  recordStep({ step: 'shipping-scope', result: 'passed', shipmentId: shipment.id });
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
    const users = await makeUsers(admin.token);

    const customer = await createCustomer(users.own.token);
    const contract = await createContract(users.own.token, customer.id);
    const sample = await createSample(users.own.token, customer.id);
    const rma = await createRma(users.own.token, customer.id);
    const shipment = await createShipment(users.warehouse.token, customer.id);
    recordStep({
      step: 'create-fixtures',
      result: 'passed',
      customerId: customer.id,
      contractId: contract.id,
      sampleId: sample.id,
      rmaId: rma.id,
      shipmentId: shipment.id,
    });

    await verifyContracts(users, customer, contract);
    await verifySamples(users, customer, sample);
    await verifyRma(users, customer, rma);
    await verifyShipping(users, customer, shipment);

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
    console.log(`customer-ops-permission-scope-audit-v1 passed: ${REPORT_PATH}`);
  })
  .catch((error) => {
    console.error('customer-ops-permission-scope-audit-v1 failed:', error.message);
    if (error.details) {
      console.error(JSON.stringify(error.details, null, 2));
    }
    process.exit(1);
  });
