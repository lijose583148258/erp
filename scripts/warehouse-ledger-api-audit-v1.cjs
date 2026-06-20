const fs = require('fs');
const path = require('path');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'warehouse-ledger-api-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

const DATA = {
  productName: `WH-LEDGER-RESIN-${RUN_ID}`,
  batchNo: `WH-LEDGER-BATCH-${RUN_ID}`,
  initialQuantity: 55,
  transferQuantity: 15,
  inboundSourceRef: `WH-LEDGER-INBOUND-${RUN_ID}`,
  inboundReason: 'inventory_surplus',
  requestId: `WH-LEDGER-${RUN_ID}`,
};

const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  data: DATA,
  steps: [],
  status: 'running',
};

function recordStep(entry) {
  report.steps.push({ at: new Date().toISOString(), ...entry });
}

async function apiFetch(endpoint, options = {}, token = '') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Timeout after 15000ms for ${endpoint}`)), 15000);
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
      json = { raw: text };
    }
    return { ok: response.ok, status: response.status, json };
  } finally {
    clearTimeout(timeout);
  }
}

function unwrapData(response) {
  return response?.json?.data ?? null;
}

function unwrapList(response) {
  const data = unwrapData(response);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

async function expectOk(label, promise) {
  const response = await promise;
  if (!response.ok) {
    throw new Error(`${label} failed: ${response.status} ${JSON.stringify(response.json)}`);
  }
  return response;
}

async function login(username, password) {
  const response = await expectOk(`login ${username}`, apiFetch('/auth/login', {
    method: 'POST',
    data: { username, password },
  }));
  const data = unwrapData(response);
  if (!data?.token) throw new Error(`login ${username} returned no token`);
  return data;
}

async function getLocations(token) {
  const response = await expectOk('list warehouses', apiFetch('/warehouses', {}, token));
  const warehouses = unwrapList(response);
  const main = warehouses.find(item => String(item.code) === 'WH-MAIN');
  if (!main) throw new Error('WH-MAIN warehouse not found');
  const raw = (main.locations || []).find(item => String(item.code) === 'LOC-RAW');
  const wip = (main.locations || []).find(item => String(item.code) === 'LOC-WIP');
  if (!raw) throw new Error('LOC-RAW location not found');
  if (!wip) throw new Error('LOC-WIP location not found');
  return { raw, wip };
}

function findTransferEntry(entries) {
  return entries.find(entry => {
    if (entry.sourceType !== 'warehouse_transfer') return false;
    if (entry.sourceRef !== `warehouse_transfer:${DATA.requestId}`) return false;
    const movements = Array.isArray(entry.movements) ? entry.movements : [];
    return movements.some(item => item.productName === DATA.productName && item.quantityDelta < 0)
      && movements.some(item => item.productName === DATA.productName && item.quantityDelta > 0);
  });
}

function assertLedgerEntry(entry, raw, wip) {
  if (!entry) throw new Error('transfer ledger entry not found');
  const movements = entry.movements || [];
  if (movements.length !== 2) {
    throw new Error(`expected 2 movement lines, got ${movements.length}: ${JSON.stringify(entry)}`);
  }
  const outbound = movements.find(item => Number(item.quantityDelta || 0) < 0);
  const inbound = movements.find(item => Number(item.quantityDelta || 0) > 0);
  if (!outbound || !inbound) throw new Error(`missing inbound/outbound movement: ${JSON.stringify(entry)}`);
  if (Number(outbound.locationId) !== Number(raw.id)) throw new Error(`outbound location mismatch: ${JSON.stringify(outbound)}`);
  if (Number(inbound.locationId) !== Number(wip.id)) throw new Error(`inbound location mismatch: ${JSON.stringify(inbound)}`);
  if (Math.abs(Math.abs(Number(outbound.quantityDelta)) - DATA.transferQuantity) > 0.000001) {
    throw new Error(`outbound quantity mismatch: ${JSON.stringify(outbound)}`);
  }
  if (Math.abs(Number(inbound.quantityDelta) - DATA.transferQuantity) > 0.000001) {
    throw new Error(`inbound quantity mismatch: ${JSON.stringify(inbound)}`);
  }
  if (!outbound.locationName || !inbound.locationName || !outbound.warehouseName || !inbound.warehouseName) {
    throw new Error(`movement location/warehouse display fields missing: ${JSON.stringify(entry)}`);
  }
}

async function run() {
  try {
    const warehouse = await login('warehouse', 'warehouse123');
    recordStep({ step: 'login-warehouse', result: 'passed' });

    const { raw, wip } = await getLocations(warehouse.token);
    report.locations = { raw: raw.id, wip: wip.id };
    recordStep({ step: 'load-default-locations', result: 'passed', raw: raw.code, wip: wip.code });

    const seed = await expectOk('seed stock for ledger', apiFetch('/warehouses/stock-balances', {
      method: 'POST',
      data: {
        locationId: Number(raw.id),
        productName: DATA.productName,
        batchNo: DATA.batchNo,
        quantity: DATA.initialQuantity,
        unit: 'kg',
        sourceRef: DATA.inboundSourceRef,
        reason: DATA.inboundReason,
        note: `warehouse ledger audit ${RUN_ID}`,
      },
    }, warehouse.token));
    const sourceBalance = unwrapData(seed);
    if (!sourceBalance?.id) throw new Error('seed stock returned no balance id');
    recordStep({ step: 'seed-source-stock', result: 'passed', stockBalanceId: sourceBalance.id });

    await expectOk('transfer stock for ledger', apiFetch(`/warehouses/stock-balances/${sourceBalance.id}/transfer`, {
      method: 'POST',
      data: {
        toLocationId: Number(wip.id),
        quantity: DATA.transferQuantity,
        requestId: DATA.requestId,
        note: `warehouse ledger transfer ${RUN_ID}`,
      },
    }, warehouse.token));
    recordStep({ step: 'post-transfer', result: 'passed', requestId: DATA.requestId });

    const byProduct = await expectOk('query ledger by product/batch', apiFetch(
      `/warehouses/stock-entries?sourceType=warehouse_transfer&productName=${encodeURIComponent(DATA.productName)}&batchNo=${encodeURIComponent(DATA.batchNo)}&limit=20`,
      {},
      warehouse.token,
    ));
    const productEntries = unwrapList(byProduct);
    const productEntry = findTransferEntry(productEntries);
    assertLedgerEntry(productEntry, raw, wip);
    recordStep({ step: 'query-ledger-by-product-batch', result: 'passed', entryNo: productEntry.entryNo });

    const byDestination = await expectOk('query ledger by destination location', apiFetch(
      `/warehouses/stock-entries?sourceType=warehouse_transfer&locationId=${Number(wip.id)}&productName=${encodeURIComponent(DATA.productName)}&limit=20`,
      {},
      warehouse.token,
    ));
    const destinationEntry = findTransferEntry(unwrapList(byDestination));
    assertLedgerEntry(destinationEntry, raw, wip);
    recordStep({ step: 'query-ledger-by-location', result: 'passed', locationId: wip.id });

    const bySourceRef = await expectOk('query ledger by source ref', apiFetch(
      `/warehouses/stock-entries?sourceType=warehouse_transfer&sourceRef=${encodeURIComponent(`warehouse_transfer:${DATA.requestId}`)}&limit=20`,
      {},
      warehouse.token,
    ));
    const sourceRefEntry = findTransferEntry(unwrapList(bySourceRef));
    assertLedgerEntry(sourceRefEntry, raw, wip);
    recordStep({ step: 'query-ledger-by-source-ref', result: 'passed', sourceRef: sourceRefEntry.sourceRef });

    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.failure = {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    };
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  console.log(JSON.stringify({
    status: report.status,
    steps: report.steps.length,
    reportPath: REPORT_PATH,
    failure: report.failure || null,
  }, null, 2));
}

run();
