/**
 * Operations data-scope audit.
 *
 * Proves that procurement, warehouse, assets, and barter are not only protected
 * by menu permissions. Custom roles must also receive the right dataScopes
 * before real records are returned.
 */
const fs = require('fs');
const path = require('path');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'operations-data-scope-audit-report-v1.json');
const REQUEST_TIMEOUT_MS = 10_000;
const SCRIPT_TIMEOUT_MS = 290_000;
const RUN_ID = `${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}_${process.pid}_${Math.random().toString(36).slice(2, 7)}`;
const PASSWORD = 'Audit12345';

const DATA = {
  supplierName: `OPS-SUP-${RUN_ID}`,
  purchaseItem: `OPS-RAW-${RUN_ID}`,
  assetBatchNo: `OPS-BATCH-${RUN_ID}`,
  assetProduct: `OPS-ASSET-PRODUCT-${RUN_ID}`,
  barterCounterparty: `OPS-BARTER-${RUN_ID}`,
  roles: {
    procurementScope: `ops_proc_${RUN_ID}`.slice(0, 48),
    procurementNone: `ops_proc_none_${RUN_ID}`.slice(0, 48),
    warehouseScope: `ops_wh_${RUN_ID}`.slice(0, 48),
    warehouseNone: `ops_wh_none_${RUN_ID}`.slice(0, 48),
    assetScope: `ops_asset_${RUN_ID}`.slice(0, 48),
    assetNone: `ops_asset_none_${RUN_ID}`.slice(0, 48),
    barterScope: `ops_barter_${RUN_ID}`.slice(0, 48),
    barterNone: `ops_barter_none_${RUN_ID}`.slice(0, 48),
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
      description: `Created by operations-data-scope-audit-v1 ${RUN_ID}`,
      isActive: true,
      dataScopes,
      permissions,
    },
  }, token);
  expectStatus(response, [201], `create role ${code}`);
  return dataOf(response);
}

async function createTeamMember(token, { username, role, segment = 'mixed' }) {
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

async function createFixtureData(managerToken) {
  const supplierResponse = await apiFetch('/procurement/suppliers', {
    method: 'POST',
    data: {
      name: DATA.supplierName,
      nameZh: DATA.supplierName,
      nameEn: `Supplier ${RUN_ID}`,
      nameVi: `Nha cung cap ${RUN_ID}`,
      category: 'raw_material',
      rating: 4,
      leadTimeDays: 7,
      riskLevel: 'low',
      status: 'active',
      contact: `ops-${RUN_ID}@example.com`,
    },
  }, managerToken);
  expectStatus(supplierResponse, [201], 'create procurement supplier');
  const supplier = dataOf(supplierResponse);
  expect(Boolean(supplier?.id), 'supplier create returned no id', supplierResponse.json);

  const purchaseResponse = await apiFetch('/procurement/orders', {
    method: 'POST',
    data: {
      supplierId: Number(supplier.id),
      item: DATA.purchaseItem,
      quantity: 12,
      unit: 'kg',
      price: 18.5,
      eta: new Date(Date.now() + 86400_000).toISOString(),
      status: 'pending',
    },
  }, managerToken);
  expectStatus(purchaseResponse, [201], 'create purchase order');
  const purchaseOrder = dataOf(purchaseResponse);
  expect(Boolean(purchaseOrder?.id), 'purchase order create returned no id', purchaseResponse.json);

  const batchResponse = await apiFetch('/assets/batches', {
    method: 'POST',
    data: {
      batchNo: DATA.assetBatchNo,
      productName: DATA.assetProduct,
      productionDate: new Date().toISOString(),
      expiryDate: new Date(Date.now() + 30 * 86400_000).toISOString(),
      stockQuantity: 3,
      unit: 'kg',
      notes: `operations scope audit ${RUN_ID}`,
    },
  }, managerToken);
  expectStatus(batchResponse, [201], 'create asset batch');
  const batch = dataOf(batchResponse);
  expect(Boolean(batch?.id), 'asset batch create returned no id', batchResponse.json);

  const barterResponse = await apiFetch('/barter/agreements', {
    method: 'POST',
    data: {
      counterpartyType: 'other',
      counterpartyName: DATA.barterCounterparty,
      settlementMode: 'barter',
      currency: 'CNY',
      items: [
        {
          side: 'counterparty',
          itemName: `board-${RUN_ID}`,
          unit: 'm3',
          quantity: 2,
          unitPrice: 380,
          sourceDocument: `OPS-BARTER-IN-${RUN_ID}`,
        },
        {
          side: 'our',
          itemName: `glue-${RUN_ID}`,
          unit: 'kg',
          quantity: 4,
          unitPrice: 190,
          sourceDocument: `OPS-BARTER-OUT-${RUN_ID}`,
        },
      ],
    },
  }, managerToken);
  expectStatus(barterResponse, [201], 'create barter agreement');
  const barterAgreement = dataOf(barterResponse);
  expect(Boolean(barterAgreement?.id), 'barter agreement create returned no id', barterResponse.json);

  recordStep({
    step: 'create-fixtures',
    result: 'passed',
    supplierId: supplier.id,
    purchaseOrderId: purchaseOrder.id,
    batchId: batch.id,
    barterAgreementId: barterAgreement.id,
  });
}

async function makeScopedUsers(adminToken) {
  const roleSpecs = [
    { key: 'procurementScope', dataScopes: ['procurement_visible'], permissions: ['procurement.read'] },
    { key: 'procurementNone', dataScopes: [], permissions: ['procurement.read'] },
    { key: 'warehouseScope', dataScopes: ['warehouse_visible'], permissions: ['warehouse.read'] },
    { key: 'warehouseNone', dataScopes: [], permissions: ['warehouse.read'] },
    { key: 'assetScope', dataScopes: ['finance_visible'], permissions: ['assets.read'] },
    { key: 'assetNone', dataScopes: [], permissions: ['assets.read'] },
    { key: 'barterScope', dataScopes: ['finance_visible'], permissions: ['barter.read'] },
    { key: 'barterNone', dataScopes: [], permissions: ['barter.read'] },
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
      segment: 'mixed',
    });
    users[spec.key] = await login(username, PASSWORD);
  }

  recordStep({
    step: 'create-dynamic-scope-users',
    result: 'passed',
    users: Object.keys(users),
  });
  return users;
}

function containsSupplier(rows) {
  return rows.some((row) => [row.name, row.nameZh, row.supplierDisplayName].includes(DATA.supplierName));
}

function containsPurchaseOrder(rows) {
  return rows.some((row) => String(row.item || '') === DATA.purchaseItem);
}

function containsBatch(rows) {
  return rows.some((row) => String(row.batchNo || '') === DATA.assetBatchNo || String(row.productName || '') === DATA.assetProduct);
}

function containsBarter(rows) {
  return rows.some((row) => String(row.counterpartyName || '') === DATA.barterCounterparty);
}

async function verifyProcurementScope(users) {
  const scopedSuppliers = await apiFetch(`/procurement/suppliers?search=${encodeURIComponent(DATA.supplierName)}&pageSize=20`, {}, users.procurementScope.token);
  expectStatus(scopedSuppliers, [200], 'procurement scoped suppliers');
  expect(containsSupplier(listOf(scopedSuppliers)), 'procurement_visible role should read supplier fixture', scopedSuppliers.json);

  const noneSuppliers = await apiFetch(`/procurement/suppliers?search=${encodeURIComponent(DATA.supplierName)}&pageSize=20`, {}, users.procurementNone.token);
  expectStatus(noneSuppliers, [200], 'procurement no-scope suppliers');
  expect(!containsSupplier(listOf(noneSuppliers)), 'procurement.read without procurement_visible leaked supplier fixture', noneSuppliers.json);

  const scopedOrders = await apiFetch(`/procurement/orders?search=${encodeURIComponent(DATA.purchaseItem)}&pageSize=20`, {}, users.procurementScope.token);
  expectStatus(scopedOrders, [200], 'procurement scoped orders');
  expect(containsPurchaseOrder(listOf(scopedOrders)), 'procurement_visible role should read purchase order fixture', scopedOrders.json);

  const noneOrders = await apiFetch(`/procurement/orders?search=${encodeURIComponent(DATA.purchaseItem)}&pageSize=20`, {}, users.procurementNone.token);
  expectStatus(noneOrders, [200], 'procurement no-scope orders');
  expect(!containsPurchaseOrder(listOf(noneOrders)), 'procurement.read without procurement_visible leaked purchase order fixture', noneOrders.json);

  recordStep({ step: 'verify-procurement-data-scope', result: 'passed' });
}

async function verifyWarehouseScope(users) {
  const scopedWarehouses = await apiFetch('/warehouses', {}, users.warehouseScope.token);
  expectStatus(scopedWarehouses, [200], 'warehouse scoped list');
  expect(listOf(scopedWarehouses).length > 0, 'warehouse_visible role should read warehouse list', scopedWarehouses.json);

  const noneWarehouses = await apiFetch('/warehouses', {}, users.warehouseNone.token);
  expectStatus(noneWarehouses, [200], 'warehouse no-scope list');
  expect(listOf(noneWarehouses).length === 0, 'warehouse.read without warehouse_visible leaked warehouse list', noneWarehouses.json);

  recordStep({ step: 'verify-warehouse-data-scope', result: 'passed', visibleWarehouses: listOf(scopedWarehouses).length });
}

async function verifyAssetScope(users) {
  const scopedBatches = await apiFetch(`/assets/batches?keyword=${encodeURIComponent(DATA.assetBatchNo)}`, {}, users.assetScope.token);
  expectStatus(scopedBatches, [200], 'asset scoped batches');
  expect(containsBatch(listOf(scopedBatches)), 'finance_visible assets.read role should read product batch fixture', scopedBatches.json);

  const noneBatches = await apiFetch(`/assets/batches?keyword=${encodeURIComponent(DATA.assetBatchNo)}`, {}, users.assetNone.token);
  expectStatus(noneBatches, [200], 'asset no-scope batches');
  expect(!containsBatch(listOf(noneBatches)), 'assets.read without finance/warehouse scope leaked product batch fixture', noneBatches.json);

  recordStep({ step: 'verify-asset-data-scope', result: 'passed' });
}

async function verifyBarterScope(users) {
  const scopedAgreements = await apiFetch(`/barter/agreements?search=${encodeURIComponent(DATA.barterCounterparty)}&pageSize=20`, {}, users.barterScope.token);
  expectStatus(scopedAgreements, [200], 'barter scoped agreements');
  expect(containsBarter(listOf(scopedAgreements)), 'finance_visible barter.read role should read barter agreement fixture', scopedAgreements.json);

  const noneAgreements = await apiFetch(`/barter/agreements?search=${encodeURIComponent(DATA.barterCounterparty)}&pageSize=20`, {}, users.barterNone.token);
  expectStatus(noneAgreements, [200], 'barter no-scope agreements');
  expect(!containsBarter(listOf(noneAgreements)), 'barter.read without dataScopes leaked barter agreement fixture', noneAgreements.json);

  recordStep({ step: 'verify-barter-data-scope', result: 'passed' });
}

async function saveReport() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  report.endedAt = new Date().toISOString();
  report.durationMs = new Date(report.endedAt).getTime() - new Date(report.startedAt).getTime();
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
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
    const admin = await login('admin', 'admin123');
    const manager = await login('manager', 'manager123');
    recordStep({
      step: 'login-admin-manager',
      result: 'passed',
      adminUserId: admin.user.id,
      managerUserId: manager.user.id,
    });

    await createFixtureData(manager.token);
    const users = await makeScopedUsers(admin.token);
    await verifyProcurementScope(users);
    await verifyWarehouseScope(users);
    await verifyAssetScope(users);
    await verifyBarterScope(users);

    report.status = 'passed';
  } catch (error) {
    fail('main', error);
  } finally {
    if (scriptTimer) clearTimeout(scriptTimer);
    await saveReport();
  }

  if (report.status !== 'passed') {
    console.error(report.failure?.message || 'Operations data-scope audit failed');
    process.exit(1);
  }

  console.log(`Operations data-scope audit passed. Report: ${REPORT_PATH}`);
}

main();
