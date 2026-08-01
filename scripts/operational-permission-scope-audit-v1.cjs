/**
 * Operational permission + data-scope audit.
 *
 * Covers production, receipt discrepancies, and adjustments after fixed role
 * route guards were migrated to dynamic permissions.
 */
const fs = require('fs');
const path = require('path');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'operational-permission-scope-audit-report-v1.json');
const REQUEST_TIMEOUT_MS = 10_000;
const SCRIPT_TIMEOUT_MS = 290_000;
const RUN_ID = `${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}_${process.pid}_${Math.random().toString(36).slice(2, 7)}`;
const PASSWORD = 'Audit12345';
const ADMIN = { username: 'admin', password: 'admin123' };

const DATA = {
  productName: `OPS-PROD-${RUN_ID}`,
  roles: {
    none: `op_none_${RUN_ID}`.slice(0, 48),
    warehouse: `op_wh_${RUN_ID}`.slice(0, 48),
    finance: `op_fin_${RUN_ID}`.slice(0, 48),
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
      description: `Created by operational-permission-scope-audit-v1 ${RUN_ID}`,
      isActive: true,
      dataScopes,
      permissions,
    },
  }, token);
  expectStatus(response, [201], `create role ${code}`);
  return dataOf(response);
}

async function createTeamMember(token, { username, role }) {
  const response = await apiFetch('/team', {
    method: 'POST',
    data: {
      username,
      password: PASSWORD,
      email: `${username}@example.com`,
      role,
      segment: 'mixed',
    },
  }, token);
  expectStatus(response, [201], `create user ${username}`);
  return dataOf(response);
}

async function makeUsers(adminToken) {
  const roleSpecs = [
    {
      key: 'none',
      dataScopes: [],
      permissions: [
        'production.read',
        'production.write',
        'discrepancies.read',
        'discrepancies.write',
        'discrepancies.rules.manage',
        'adjustments.read',
        'adjustments.write',
        'adjustments.apply',
        'adjustments.reverse',
      ],
    },
    {
      key: 'warehouse',
      dataScopes: ['warehouse_visible'],
      permissions: [
        'production.read',
        'production.write',
        'discrepancies.read',
        'discrepancies.write',
        'adjustments.read',
        'adjustments.write',
        'adjustments.apply',
        'adjustments.reverse',
      ],
    },
    {
      key: 'finance',
      dataScopes: ['finance_visible'],
      permissions: [
        'production.read',
        'discrepancies.read',
        'adjustments.read',
        'adjustments.write',
        'adjustments.apply',
        'adjustments.reverse',
      ],
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
    await createTeamMember(adminToken, { username, role: roleCode });
    users[spec.key] = await login(username, PASSWORD);
  }
  recordStep({ step: 'create-dynamic-operational-users', result: 'passed', users: Object.keys(users) });
  return users;
}

function bomPayload() {
  return {
    productName: DATA.productName,
    version: 'v1',
    bomType: 'chemical_formula',
    formulationMode: 'percentage',
    outputUnit: 'kg',
    shelfLifeDays: 365,
    standardBatchSize: 100,
    batchSizeUnit: 'kg',
    items: [
      {
        materialCode: `MAT-${RUN_ID}`,
        ingredientRole: 'main_resin',
        dosageMode: 'percentage',
        percentage: 100,
        quantityPerUnit: 1,
        unit: 'kg',
      },
    ],
  };
}

async function verifyProduction(users) {
  const noneSummary = await apiFetch('/production/summary', {}, users.none.token);
  expectStatus(noneSummary, [403], 'production.read without operational scope denied');

  const warehouseSummary = await apiFetch('/production/summary', {}, users.warehouse.token);
  expectStatus(warehouseSummary, [200], 'warehouse production summary');

  const financeSummary = await apiFetch('/production/summary', {}, users.finance.token);
  expectStatus(financeSummary, [200], 'finance production summary');

  const noneCreate = await apiFetch('/production/boms', { method: 'POST', data: bomPayload() }, users.none.token);
  expectStatus(noneCreate, [403], 'production.write without warehouse scope denied');

  const warehouseCreate = await apiFetch('/production/boms', { method: 'POST', data: bomPayload() }, users.warehouse.token);
  expectStatus(warehouseCreate, [201], 'warehouse production bom create');
  expect(Boolean(dataOf(warehouseCreate)?.id), 'warehouse bom create returned no id', warehouseCreate.json);

  recordStep({ step: 'production-scope', result: 'passed', bomId: dataOf(warehouseCreate).id });
}

async function verifyDiscrepancies(users) {
  const noneCases = await apiFetch('/receipt-discrepancies?pageSize=1', {}, users.none.token);
  expectStatus(noneCases, [403], 'discrepancies.read without operational scope denied');

  const warehouseCases = await apiFetch('/receipt-discrepancies?pageSize=1', {}, users.warehouse.token);
  expectStatus(warehouseCases, [200], 'warehouse discrepancy list');

  const financeCases = await apiFetch('/receipt-discrepancies?pageSize=1', {}, users.finance.token);
  expectStatus(financeCases, [200], 'finance discrepancy list');

  const noneRule = await apiFetch('/receipt-discrepancies/tolerance-rules', {
    method: 'POST',
    data: {
      name: `No scope rule ${RUN_ID}`,
      quantityTolerancePercent: 1,
      status: 'active',
    },
  }, users.none.token);
  expectStatus(noneRule, [403], 'tolerance rule manage denied for non-admin dynamic role');

  recordStep({ step: 'discrepancies-scope', result: 'passed' });
}

async function verifyAdjustments(users) {
  const noneSummary = await apiFetch('/adjustments/summary', {}, users.none.token);
  expectStatus(noneSummary, [200], 'adjustment no-scope summary returns empty view');
  const noneRecent = dataOf(noneSummary)?.recentAdjustments || [];
  expect(Array.isArray(noneRecent) && noneRecent.length === 0, 'adjustments.read without data scope should not return recent adjustments', noneSummary.json);

  const financeSummary = await apiFetch('/adjustments/summary', {}, users.finance.token);
  expectStatus(financeSummary, [200], 'finance adjustment summary');

  const warehouseSummary = await apiFetch('/adjustments/summary', {}, users.warehouse.token);
  expectStatus(warehouseSummary, [200], 'warehouse adjustment summary');

  const noneCreate = await apiFetch('/adjustments', {
    method: 'POST',
    data: {
      domain: 'inventory',
      targetType: 'productBatch',
      batchId: 1,
      quantityDelta: 1,
      reason: `no scope denied ${RUN_ID}`,
      status: 'pending',
    },
  }, users.none.token);
  expectStatus(noneCreate, [403], 'adjustment write without data scope denied');

  recordStep({ step: 'adjustments-scope', result: 'passed' });
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
    await verifyProduction(users);
    await verifyDiscrepancies(users);
    await verifyAdjustments(users);
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
    console.log(`operational-permission-scope-audit-v1 passed: ${REPORT_PATH}`);
  })
  .catch((error) => {
    console.error('operational-permission-scope-audit-v1 failed:', error.message);
    if (error.details) {
      console.error(JSON.stringify(error.details, null, 2));
    }
    process.exit(1);
  });
