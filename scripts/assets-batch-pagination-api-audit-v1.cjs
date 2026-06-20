const fs = require('fs');
const path = require('path');

const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/?$/, '/');
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'audit');
const REPORT_PATH = path.join(OUTPUT_DIR, 'assets-batch-pagination-api-audit-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const REQUEST_TIMEOUT_MS = 10_000;

const DATA = {
  prefix: `ABP-${RUN_ID}`,
  productPrefix: `资产批次分页-${RUN_ID}`,
  pageSize: 10,
  healthyCount: 22,
};

const report = {
  name: 'Assets Batch Pagination API Audit',
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  data: DATA,
  status: 'running',
  steps: [],
};

function recordStep(entry) {
  report.steps.push({ at: new Date().toISOString(), ...entry });
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
  } finally {
    clearTimeout(timer);
  }
}

async function login(username, password) {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    data: { username, password },
  });
  expect(response.ok, `login failed for ${username}`, { status: response.status, json: response.json });
  return response.json.data;
}

function daysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function listOf(response) {
  return Array.isArray(response.json?.data) ? response.json.data : [];
}

function metaOf(response) {
  return response.json?.meta || {};
}

async function createBatch(token, index, overrides = {}) {
  const batchNo = `${DATA.prefix}-${String(index).padStart(3, '0')}`;
  const payload = {
    batchNo,
    productName: `${DATA.productPrefix}-${String(index).padStart(3, '0')}`,
    productionDate: daysFromNow(-2),
    expiryDate: daysFromNow(60 + index),
    storageTemp: '15-25C',
    isColdChain: false,
    stockQuantity: 0,
    unit: 'kg',
    notes: `pagination audit ${RUN_ID}`,
    ...overrides,
  };
  const response = await apiFetch('/assets/batches', { method: 'POST', data: payload }, token);
  expect(response.ok, `create batch failed ${batchNo}`, { status: response.status, json: response.json });
  return response.json.data;
}

async function queryBatches(token, params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  const response = await apiFetch(`/assets/batches?${query.toString()}`, {}, token);
  expect(response.ok, 'batch query failed', { status: response.status, json: response.json, params });
  return response;
}

async function run() {
  try {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const auth = await login('admin', 'admin123');
    const token = auth.token;
    recordStep({ step: 'login-admin', status: 'passed', userId: auth.user?.id });

    for (let index = 1; index <= DATA.healthyCount; index += 1) {
      await createBatch(token, index);
    }
    await createBatch(token, 999, {
      productName: `${DATA.productPrefix}-expired`,
      productionDate: daysFromNow(-120),
      expiryDate: daysFromNow(-30),
    });
    recordStep({ step: 'seed-batches', status: 'passed', healthyCount: DATA.healthyCount, expiredCount: 1 });

    const page1 = await queryBatches(token, { keyword: DATA.prefix, page: 1, pageSize: DATA.pageSize });
    const page2 = await queryBatches(token, { keyword: DATA.prefix, page: 2, pageSize: DATA.pageSize });
    const page1Rows = listOf(page1);
    const page2Rows = listOf(page2);
    const page1Meta = metaOf(page1);
    const page2Meta = metaOf(page2);
    expect(page1Rows.length === DATA.pageSize, 'page 1 size mismatch', { rows: page1Rows.length, meta: page1Meta });
    expect(page2Rows.length === DATA.pageSize, 'page 2 size mismatch', { rows: page2Rows.length, meta: page2Meta });
    expect(page1Meta.total === DATA.healthyCount + 1, 'page 1 total mismatch', page1Meta);
    expect(page1Meta.totalPages === 3, 'page 1 totalPages mismatch', page1Meta);
    expect(page1Meta.hasNextPage === true && page1Meta.hasPrevPage === false, 'page 1 flags mismatch', page1Meta);
    expect(page2Meta.hasNextPage === true && page2Meta.hasPrevPage === true, 'page 2 flags mismatch', page2Meta);
    const page1Ids = new Set(page1Rows.map(row => row.id));
    expect(page2Rows.every(row => !page1Ids.has(row.id)), 'page 1 and page 2 overlapped', { page1Rows, page2Rows });
    recordStep({ step: 'verify-pagination-meta-and-non-overlap', status: 'passed', page1Meta, page2Meta });

    const exact = await queryBatches(token, { keyword: `${DATA.prefix}-001`, page: 1, pageSize: DATA.pageSize });
    expect(metaOf(exact).total === 1, 'exact keyword total mismatch', { meta: metaOf(exact), rows: listOf(exact) });
    expect(listOf(exact)[0]?.batchNo === `${DATA.prefix}-001`, 'exact keyword row mismatch', listOf(exact));
    recordStep({ step: 'verify-keyword-search', status: 'passed', meta: metaOf(exact) });

    const expired = await queryBatches(token, { keyword: DATA.prefix, status: 'expired', page: 1, pageSize: DATA.pageSize });
    expect(metaOf(expired).total === 1, 'expired status total mismatch', { meta: metaOf(expired), rows: listOf(expired) });
    expect(listOf(expired)[0]?.status === 'expired', 'expired row status mismatch', listOf(expired));
    const healthy = await queryBatches(token, { keyword: DATA.prefix, status: 'healthy', page: 1, pageSize: DATA.pageSize });
    expect(metaOf(healthy).total === DATA.healthyCount, 'healthy status total mismatch', { meta: metaOf(healthy) });
    expect(listOf(healthy).every(row => row.status === 'healthy'), 'healthy page contains non-healthy row', listOf(healthy));
    recordStep({ step: 'verify-status-server-filter', status: 'passed', expiredMeta: metaOf(expired), healthyMeta: metaOf(healthy) });

    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = error instanceof Error ? error.message : String(error);
    if (error?.details) report.errorDetails = error.details;
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ status: report.status, report: REPORT_PATH, steps: report.steps.length }, null, 2));
  }
}

void run();
