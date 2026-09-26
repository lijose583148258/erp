const fs = require('fs');
const path = require('path');
const { ensureReleasedMaterial } = require('./lib/material-audit-fixture.cjs');

const baseUrl = String(process.env.APP_URL || 'http://127.0.0.1:5001/').replace(/\/$/, '');
const username = String(process.env.AILAODA_LOAD_USERNAME || process.env.WAREHOUSE_AUDIT_USERNAME || '').trim();
const passwordFile = String(process.env.AILAODA_LOAD_PASSWORD_FILE || process.env.WAREHOUSE_AUDIT_PASSWORD_FILE || '').trim();
const password = passwordFile
  ? fs.readFileSync(path.resolve(passwordFile), 'utf8').trim()
  : String(process.env.WAREHOUSE_AUDIT_PASSWORD || '').trim();
const reportPath = path.resolve(process.env.WAREHOUSE_ADJUSTMENT_REPORT_PATH
  || path.join(process.cwd(), 'output', 'audit', 'warehouse-adjustment-concurrency-audit-v1.json'));
const runId = `${Date.now()}-${process.pid}`;

const report = {
  name: 'Warehouse Adjustment Concurrency Audit',
  version: '1.0',
  status: 'failed',
  baseUrl,
  startedAt: new Date().toISOString(),
  steps: [],
};

const record = (name, status, details = {}) => report.steps.push({ name, status, ...details });

const request = async (endpoint, options = {}) => {
  const response = await fetch(`${baseUrl}/api/v1${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.data === undefined ? undefined : JSON.stringify(options.data),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 500) }; }
  return { status: response.status, ok: response.ok, json };
};

const expectStatus = (label, response, expected) => {
  if (response.status !== expected) {
    throw new Error(`${label}: expected HTTP ${expected}, received ${response.status} ${JSON.stringify(response.json)}`);
  }
  record(label, 'passed', { httpStatus: response.status });
  return response.json?.data;
};

const listData = response => Array.isArray(response.json?.data)
  ? response.json.data
  : Array.isArray(response.json?.data?.items) ? response.json.data.items : [];

const main = async () => {
  if (!username || !password) throw new Error('Warehouse audit credentials are required.');
  const login = await request('/auth/login', { method: 'POST', data: { username, password } });
  const loginData = expectStatus('login', login, 200);
  const token = loginData?.accessToken || loginData?.token || login.json?.accessToken || login.json?.token;
  if (!token) throw new Error('Login returned no access token.');

  const warehousesResponse = await request('/warehouses', { token });
  expectStatus('list-warehouses', warehousesResponse, 200);
  const warehouses = listData(warehousesResponse);
  const location = warehouses.flatMap(warehouse => warehouse.locations || [])[0];
  if (!location?.id) throw new Error('No writable warehouse location was returned.');

  const productName = `ADJUST-CONCURRENCY-${runId}`;
  const materialCode = `ADJUST-MAT-${runId}`;
  const batchNo = `BATCH-${runId}`;
  const material = await ensureReleasedMaterial({
    request: (endpoint, options = {}) => request(endpoint, { ...options, token }),
    code: materialCode,
    name: productName,
    unit: 'kg',
    category: 'raw_material',
  });
  record('create-released-material', 'passed', { materialId: Number(material.id), materialCode });
  const inbound = await request('/warehouses/stock-balances', {
    method: 'POST', token,
    data: {
      locationId: Number(location.id), materialId: Number(material.id), productName, batchNo, quantity: 100, unit: 'kg',
      sourceRef: `ADJUST-SEED-${runId}`, reason: 'concurrency_audit',
    },
  });
  const seeded = expectStatus('seed-stock', inbound, 201);
  if (!seeded?.id || Number(seeded.quantity) !== 100) throw new Error('Seed stock read-back mismatch.');

  const firstRequestId = `ADJUST-${runId}-A`;
  const firstPayload = { quantity: 80, expectedQuantity: 100, requestId: firstRequestId, note: 'first adjustment' };
  const first = await request(`/warehouses/stock-balances/${seeded.id}`, { method: 'PATCH', token, data: firstPayload });
  const firstData = expectStatus('first-adjustment', first, 200);
  if (Number(firstData?.quantity) !== 80) throw new Error(`First adjustment expected 80, received ${firstData?.quantity}`);

  const replay = await request(`/warehouses/stock-balances/${seeded.id}`, { method: 'PATCH', token, data: firstPayload });
  const replayData = expectStatus('exact-replay-idempotent', replay, 200);
  if (Number(replayData?.quantity) !== 80) throw new Error('Exact replay changed the balance.');

  const keyReuse = await request(`/warehouses/stock-balances/${seeded.id}`, {
    method: 'PATCH', token,
    data: { ...firstPayload, quantity: 70 },
  });
  expectStatus('reject-request-id-payload-mismatch', keyReuse, 409);

  const secondRequestId = `ADJUST-${runId}-B`;
  const second = await request(`/warehouses/stock-balances/${seeded.id}`, {
    method: 'PATCH', token,
    data: { quantity: 60, expectedQuantity: 80, requestId: secondRequestId, note: 'second adjustment' },
  });
  const secondData = expectStatus('second-independent-adjustment', second, 200);
  if (Number(secondData?.quantity) !== 60) throw new Error(`Second adjustment expected 60, received ${secondData?.quantity}`);

  const stale = await request(`/warehouses/stock-balances/${seeded.id}`, {
    method: 'PATCH', token,
    data: { quantity: 50, expectedQuantity: 80, requestId: `ADJUST-${runId}-STALE`, note: 'stale adjustment' },
  });
  expectStatus('reject-stale-expected-quantity', stale, 409);

  const balancesResponse = await request(`/warehouses/stock-balances?productName=${encodeURIComponent(productName)}&batchNo=${encodeURIComponent(batchNo)}&pageSize=20`, { token });
  expectStatus('read-back-balance', balancesResponse, 200);
  const balance = listData(balancesResponse).find(item => Number(item.id) === Number(seeded.id));
  if (Number(balance?.quantity) !== 60) throw new Error(`Final balance drifted: ${balance?.quantity}`);

  for (const requestId of [firstRequestId, secondRequestId]) {
    const sourceRef = `warehouse_adjustment:${requestId}`;
    const entriesResponse = await request(`/warehouses/stock-entries?sourceType=warehouse_adjustment&sourceRef=${encodeURIComponent(sourceRef)}&limit=10`, { token });
    expectStatus(`read-voucher-${requestId.endsWith('-A') ? 'A' : 'B'}`, entriesResponse, 200);
    const entries = listData(entriesResponse).filter(entry => entry.sourceRef === sourceRef);
    if (entries.length !== 1 || Number(entries[0].movementCount) !== 1) {
      throw new Error(`Voucher idempotency mismatch for ${sourceRef}: ${JSON.stringify(entries)}`);
    }
  }

  report.status = 'passed';
  report.finalQuantity = 60;
};

main().catch(error => {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Warehouse Adjustment Concurrency Audit: ${report.status.toUpperCase()}`);
  console.log(`Report: ${reportPath}`);
});
