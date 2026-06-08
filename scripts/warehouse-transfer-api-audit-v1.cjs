const fs = require('fs');
const path = require('path');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const runtimeDbPath = process.env.AILAODA_RUNTIME_DB_PATH || 'D:/AilaoDaRuntime/stable.db';
const runtimeDatabaseUrl = `file:${runtimeDbPath.replace(/\\/g, '/')}`;
process.env.DATABASE_URL = runtimeDatabaseUrl;

const { PrismaClient } = require('../backend/node_modules/@prisma/client');

const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'warehouse-transfer-api-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: runtimeDatabaseUrl,
    },
  },
});

const DATA = {
  productName: `WH-XFER-RESIN-${RUN_ID}`,
  batchNo: `WH-XFER-BATCH-${RUN_ID}`,
  initialQuantity: 100,
  transferQuantity: 30,
  inboundSourceRef: `WH-XFER-INBOUND-${RUN_ID}`,
  inboundReason: 'inventory_surplus',
  requestId: `WH-XFER-${RUN_ID}`,
  blockedRequestId: `WH-XFER-BLOCK-${RUN_ID}`,
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
  const main = warehouses.find((item) => String(item.code) === 'WH-MAIN');
  if (!main) throw new Error('WH-MAIN warehouse not found');
  const locations = main.locations || [];
  const raw = locations.find((item) => String(item.code) === 'LOC-RAW');
  const wip = locations.find((item) => String(item.code) === 'LOC-WIP');
  if (!raw) throw new Error('LOC-RAW location not found');
  if (!wip) throw new Error('LOC-WIP location not found');
  return { raw, wip };
}

async function getBalances(token) {
  const response = await expectOk('list stock balances', apiFetch(`/warehouses/stock-balances?productName=${encodeURIComponent(DATA.productName)}&pageSize=100`, {}, token));
  return unwrapList(response).filter((item) => String(item.batchNo) === DATA.batchNo);
}

function findBalance(rows, locationId) {
  return rows.find((item) => Number(item.locationId) === Number(locationId));
}

async function countEntries(sourceRef) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS count
     FROM stock_entries
     WHERE source_type = 'warehouse_transfer'
       AND source_ref = ?
       AND status = 'posted'`,
    sourceRef,
  );
  return Number(rows[0]?.count || 0);
}

async function countMovements(sourceRef) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(m.id) AS count
     FROM stock_entries e
     JOIN stock_movements m ON m.entry_id = e.id
     WHERE e.source_type = 'warehouse_transfer'
       AND e.source_ref = ?
       AND e.status = 'posted'`,
    sourceRef,
  );
  return Number(rows[0]?.count || 0);
}

async function run() {
  try {
    const warehouse = await login('warehouse', 'warehouse123');
    recordStep({ step: 'login-warehouse', result: 'passed', userId: warehouse.user?.id });

    const { raw, wip } = await getLocations(warehouse.token);
    report.locations = { raw: raw.id, wip: wip.id };
    recordStep({ step: 'load-default-locations', result: 'passed', raw: raw.code, wip: wip.code });

    const inbound = await expectOk('seed raw stock', apiFetch('/warehouses/stock-balances', {
      method: 'POST',
      data: {
        locationId: Number(raw.id),
        productName: DATA.productName,
        batchNo: DATA.batchNo,
        quantity: DATA.initialQuantity,
        unit: 'kg',
        sourceRef: DATA.inboundSourceRef,
        reason: DATA.inboundReason,
        note: `warehouse transfer audit ${RUN_ID}`,
      },
    }, warehouse.token));
    const sourceBalance = unwrapData(inbound);
    if (!sourceBalance?.id) throw new Error('seed raw stock returned no stock balance id');
    recordStep({ step: 'seed-raw-stock', result: 'passed', stockBalanceId: sourceBalance.id });

    const transfer = await expectOk('transfer stock raw to wip', apiFetch(`/warehouses/stock-balances/${sourceBalance.id}/transfer`, {
      method: 'POST',
      data: {
        toLocationId: Number(wip.id),
        quantity: DATA.transferQuantity,
        requestId: DATA.requestId,
        note: `warehouse transfer audit ${RUN_ID}`,
      },
    }, warehouse.token));
    const transferData = unwrapData(transfer);
    if (String(transferData?.sourceRef) !== `warehouse_transfer:${DATA.requestId}`) {
      throw new Error(`transfer sourceRef mismatch: ${JSON.stringify(transferData)}`);
    }
    recordStep({ step: 'transfer-stock', result: 'passed', sourceRef: transferData.sourceRef });

    const duplicateTransfer = await expectOk('repeat transfer with same requestId', apiFetch(`/warehouses/stock-balances/${sourceBalance.id}/transfer`, {
      method: 'POST',
      data: {
        toLocationId: Number(wip.id),
        quantity: DATA.transferQuantity,
        requestId: DATA.requestId,
        note: `warehouse transfer retry ${RUN_ID}`,
      },
    }, warehouse.token));
    const duplicateData = unwrapData(duplicateTransfer);
    if (String(duplicateData?.sourceRef) !== transferData.sourceRef) {
      throw new Error('repeat transfer did not return the same sourceRef');
    }
    recordStep({ step: 'repeat-transfer-idempotent', result: 'passed', sourceRef: duplicateData.sourceRef });

    const balances = await getBalances(warehouse.token);
    const rawBalance = findBalance(balances, raw.id);
    const wipBalance = findBalance(balances, wip.id);
    const expectedRaw = DATA.initialQuantity - DATA.transferQuantity;
    const expectedWip = DATA.transferQuantity;
    if (!rawBalance || Math.abs(Number(rawBalance.quantity || 0) - expectedRaw) > 0.000001) {
      throw new Error(`raw balance mismatch: ${JSON.stringify({ rawBalance, expectedRaw, balances })}`);
    }
    if (!wipBalance || Math.abs(Number(wipBalance.quantity || 0) - expectedWip) > 0.000001) {
      throw new Error(`wip balance mismatch: ${JSON.stringify({ wipBalance, expectedWip, balances })}`);
    }
    recordStep({ step: 'verify-transfer-readback', result: 'passed', rawQuantity: rawBalance.quantity, wipQuantity: wipBalance.quantity });

    const entryCount = await countEntries(transferData.sourceRef);
    const movementCount = await countMovements(transferData.sourceRef);
    if (entryCount !== 1 || movementCount !== 2) {
      throw new Error(`transfer voucher mismatch: ${JSON.stringify({ entryCount, movementCount })}`);
    }
    recordStep({ step: 'verify-transfer-voucher-idempotency', result: 'passed', entryCount, movementCount });

    const overTransfer = await apiFetch(`/warehouses/stock-balances/${sourceBalance.id}/transfer`, {
      method: 'POST',
      data: {
        toLocationId: Number(wip.id),
        quantity: DATA.initialQuantity * 100,
        requestId: DATA.blockedRequestId,
        note: `warehouse transfer overage audit ${RUN_ID}`,
      },
    }, warehouse.token);
    if (overTransfer.status !== 409) {
      throw new Error(`over transfer expected 409, got ${overTransfer.status} ${JSON.stringify(overTransfer.json)}`);
    }
    const blockedEntryCount = await countEntries(`warehouse_transfer:${DATA.blockedRequestId}`);
    if (blockedEntryCount !== 0) {
      throw new Error(`blocked over transfer still created stock entry: ${blockedEntryCount}`);
    }
    recordStep({ step: 'block-over-transfer-without-side-effect', result: 'passed', status: overTransfer.status });

    const sameLocation = await apiFetch(`/warehouses/stock-balances/${sourceBalance.id}/transfer`, {
      method: 'POST',
      data: {
        toLocationId: Number(raw.id),
        quantity: 1,
        requestId: `WH-XFER-SAME-${RUN_ID}`,
      },
    }, warehouse.token);
    if (sameLocation.status !== 400) {
      throw new Error(`same location transfer expected 400, got ${sameLocation.status} ${JSON.stringify(sameLocation.json)}`);
    }
    recordStep({ step: 'block-same-location-transfer', result: 'passed', status: sameLocation.status });

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
    await prisma.$disconnect();
  }

  console.log(JSON.stringify({
    status: report.status,
    steps: report.steps.length,
    reportPath: REPORT_PATH,
    failure: report.failure || null,
  }, null, 2));
}

run();
