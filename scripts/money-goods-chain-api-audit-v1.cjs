const fs = require('fs');
const path = require('path');
const { ensureUiAuditAccounts } = require('./lib/ui-audit-user.cjs');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'money-goods-chain-api-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

const DATA = {
  supplierName: `MGC-SUP-${RUN_ID}`,
  customerName: `MGC-CUS-${RUN_ID}`,
  productName: `MGC-FG-GUARD-${RUN_ID}`,
  batchNo: `MGC-BATCH-${RUN_ID}`,
  rawQuantity: 10,
  fgQuantity: 10,
  shipQuantity: 4,
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
  const response = await fetch(`${APP_URL}api${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.data ? JSON.stringify(options.data) : undefined,
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { ok: response.ok, status: response.status, json };
}

function unwrapList(payload) {
  const data = payload?.json?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

async function login(username, password) {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    data: { username, password },
  });
  if (!response.ok) throw new Error(`login failed for ${username}: ${response.status}`);
  return response.json.data;
}

async function resolveLocation(token, locationCode) {
  const response = await apiFetch('/warehouses', {}, token);
  if (!response.ok) throw new Error(`warehouse list failed: ${response.status}`);
  const warehouses = unwrapList(response);
  for (const warehouse of warehouses) {
    const location = (warehouse.locations || []).find((item) => String(item.code) === locationCode);
    if (location) return location;
  }
  throw new Error(`location ${locationCode} not found`);
}

async function seedStock(token, locationCode, quantity) {
  const location = await resolveLocation(token, locationCode);
  const response = await apiFetch('/warehouses/stock-balances', {
    method: 'POST',
    data: {
      locationId: Number(location.id),
      productName: DATA.productName,
      batchNo: DATA.batchNo,
      quantity,
      unit: 'kg',
      sourceRef: `MGC-STOCK-SEED-${RUN_ID}-${locationCode}`,
      reason: `money_goods_chain_seed_${locationCode.toLowerCase()}`,
      note: `money-goods-chain-audit ${RUN_ID} ${locationCode}`,
    },
  }, token);
  if (!response.ok) throw new Error(`seed ${locationCode} stock failed: ${response.status} ${JSON.stringify(response.json)}`);
  return { location, balance: response.json?.data };
}

async function readBalance(token, locationCode) {
  const response = await apiFetch(
    `/warehouses/stock-balances?productName=${encodeURIComponent(DATA.productName)}&batchNo=${encodeURIComponent(DATA.batchNo)}&pageSize=100`,
    {},
    token,
  );
  if (!response.ok) throw new Error(`stock balance readback failed: ${response.status}`);
  const row = unwrapList(response).find((item) => String(item.locationCode || '') === locationCode);
  return Number(row?.quantity || 0);
}

async function countStockEntries(token, sourceType, sourceRef) {
  const response = await apiFetch(
    `/warehouses/stock-entries?sourceType=${encodeURIComponent(sourceType)}&sourceRef=${encodeURIComponent(sourceRef)}&limit=100`,
    {},
    token,
  );
  if (!response.ok) throw new Error(`stock entry readback failed: ${response.status}`);
  return unwrapList(response).filter((entry) => (
    String(entry.sourceType) === sourceType && String(entry.sourceRef) === String(sourceRef)
  )).length;
}

async function createSupplier(token) {
  const response = await apiFetch('/procurement/suppliers', {
    method: 'POST',
    data: {
      name: DATA.supplierName,
      nameZh: DATA.supplierName,
      category: 'Raw Materials',
      contact: `MGC-${RUN_ID.slice(-4)}`,
      addresses: [{
        label: 'registered',
        countryCode: 'VN',
        city: 'Hanoi',
        fullAddress: 'Money goods chain supplier address',
      }],
    },
  }, token);
  if (!response.ok) throw new Error(`create supplier failed: ${response.status} ${JSON.stringify(response.json)}`);
  return response.json.data;
}

async function createCustomer(token) {
  const response = await apiFetch('/customers', {
    method: 'POST',
    data: {
      nameZh: DATA.customerName,
      nameEn: `Money Goods Customer ${RUN_ID}`,
      licenseNumber: `MGC-LIC-${RUN_ID}`,
      creditLimit: 1000000,
      riskLevel: 'low',
      segment: 'direct',
      poolState: 'private',
      contactName: `MGC Contact ${RUN_ID.slice(-4)}`,
      contactPhone: `09${RUN_ID.slice(-8)}`,
      addresses: [{
        type: 'shipping',
        label: 'shipping',
        countryCode: 'VN',
        city: 'Ho Chi Minh',
        fullAddress: 'Money goods chain shipping address',
      }],
    },
  }, token);
  if (!response.ok) throw new Error(`create customer failed: ${response.status} ${JSON.stringify(response.json)}`);
  return response.json.data;
}

async function createSalesOrder(token, customerId) {
  const response = await apiFetch('/orders', {
    method: 'POST',
    data: {
      customerId: Number(customerId),
      items: [{
        productName: DATA.productName,
        quantity: DATA.shipQuantity,
        unit: 'kg',
        unitPrice: 100,
      }],
      paymentTerms: 30,
      notes: `money-goods-chain-audit ${RUN_ID}`,
    },
  }, token);
  if (!response.ok) throw new Error(`create order failed: ${response.status} ${JSON.stringify(response.json)}`);
  return response.json.data;
}

async function run() {
  try {
    const accounts = await ensureUiAuditAccounts('money_goods_chain', ['manager', 'sales']);
    const manager = await login(accounts.manager.username, accounts.manager.password);
    const sales = await login(accounts.sales.username, accounts.sales.password);
    recordStep({ step: 'login', result: 'passed', managerId: manager.user.id, salesId: sales.user.id });

    const supplier = await createSupplier(manager.token);
    recordStep({ step: 'create-supplier', result: 'passed', supplierId: supplier.id });

    const invalidReceivedPO = await apiFetch('/procurement/orders', {
      method: 'POST',
      data: {
        supplierId: Number(supplier.id),
        item: `MGC-RAW-${RUN_ID}`,
        quantity: 5,
        unit: 'kg',
        price: 12,
        eta: '2026-05-30',
        status: 'received',
      },
    }, manager.token);
    if (invalidReceivedPO.status !== 409) {
      throw new Error(`create purchase order as received expected 409, got ${invalidReceivedPO.status}`);
    }
    recordStep({ step: 'block-direct-received-purchase-order', result: 'passed', status: invalidReceivedPO.status });

    const customer = await createCustomer(sales.token);
    const order = await createSalesOrder(sales.token, customer.id);
    const confirmOrder = await apiFetch(`/orders/${order.id}/status`, {
      method: 'PATCH',
      data: { status: 'confirmed' },
    }, manager.token);
    if (!confirmOrder.ok) throw new Error(`confirm order failed: ${confirmOrder.status}`);
    recordStep({ step: 'create-confirm-sales-order', result: 'passed', orderId: order.id });

    await seedStock(manager.token, 'LOC-RAW', DATA.rawQuantity);
    const rawBefore = await readBalance(manager.token, 'LOC-RAW');
    recordStep({ step: 'seed-raw-only-stock', result: 'passed', rawBefore });

    const createShipment = await apiFetch('/shipping', {
      method: 'POST',
      data: {
        customerId: Number(customer.id),
        orderId: Number(order.id),
        productName: DATA.productName,
        quantity: DATA.shipQuantity,
        unit: 'kg',
        batchNo: DATA.batchNo,
        carrier: `MGC-CARRIER-${RUN_ID.slice(-4)}`,
        trackingNo: `MGC-${RUN_ID}`,
      },
    }, manager.token);
    if (!createShipment.ok) throw new Error(`create shipment failed: ${createShipment.status} ${JSON.stringify(createShipment.json)}`);
    const shipment = createShipment.json.data;
    recordStep({ step: 'create-shipment', result: 'passed', shipmentId: shipment.id, shipmentNo: shipment.shipmentNo });

    const blockedDispatch = await apiFetch(`/shipping/${shipment.id}/status`, {
      method: 'PATCH',
      data: { status: 'in_transit' },
    }, manager.token);
    if (blockedDispatch.status !== 409) {
      throw new Error(`dispatch with raw-only stock expected 409, got ${blockedDispatch.status}`);
    }
    const rawAfterBlocked = await readBalance(manager.token, 'LOC-RAW');
    const entriesAfterBlocked = await countStockEntries(manager.token, 'shipping_issue', shipment.shipmentNo);
    if (rawAfterBlocked !== rawBefore) throw new Error(`raw stock changed after blocked dispatch: ${rawBefore} -> ${rawAfterBlocked}`);
    if (entriesAfterBlocked !== 0) throw new Error(`blocked dispatch created shipping issue entries: ${entriesAfterBlocked}`);
    recordStep({
      step: 'block-shipping-from-raw-location',
      result: 'passed',
      status: blockedDispatch.status,
      rawBefore,
      rawAfterBlocked,
      entriesAfterBlocked,
    });

    await seedStock(manager.token, 'LOC-FG', DATA.fgQuantity);
    const fgBefore = await readBalance(manager.token, 'LOC-FG');
    const dispatch = await apiFetch(`/shipping/${shipment.id}/status`, {
      method: 'PATCH',
      data: { status: 'in_transit' },
    }, manager.token);
    if (!dispatch.ok) throw new Error(`dispatch from FG failed: ${dispatch.status} ${JSON.stringify(dispatch.json)}`);
    const fgAfterDispatch = await readBalance(manager.token, 'LOC-FG');
    const rawAfterDispatch = await readBalance(manager.token, 'LOC-RAW');
    const entryCount = await countStockEntries(manager.token, 'shipping_issue', shipment.shipmentNo);
    if (fgAfterDispatch !== fgBefore - DATA.shipQuantity) {
      throw new Error(`FG stock did not deduct correctly: ${fgBefore} -> ${fgAfterDispatch}`);
    }
    if (rawAfterDispatch !== rawBefore) {
      throw new Error(`raw stock changed after FG dispatch: ${rawBefore} -> ${rawAfterDispatch}`);
    }
    if (entryCount !== 1) {
      throw new Error(`shipping issue entry count expected 1, got ${entryCount}`);
    }
    recordStep({
      step: 'dispatch-from-finished-goods-only',
      result: 'passed',
      fgBefore,
      fgAfterDispatch,
      rawAfterDispatch,
      entryCount,
    });

    const duplicateDispatches = await Promise.all([
      apiFetch(`/shipping/${shipment.id}/status`, { method: 'PATCH', data: { status: 'in_transit' } }, manager.token),
      apiFetch(`/shipping/${shipment.id}/status`, { method: 'PATCH', data: { status: 'in_transit' } }, manager.token),
    ]);
    const entryCountAfterDuplicate = await countStockEntries(manager.token, 'shipping_issue', shipment.shipmentNo);
    const fgAfterDuplicate = await readBalance(manager.token, 'LOC-FG');
    if (entryCountAfterDuplicate !== 1) {
      throw new Error(`duplicate dispatch created extra issue entries: ${entryCountAfterDuplicate}`);
    }
    if (fgAfterDuplicate !== fgAfterDispatch) {
      throw new Error(`duplicate dispatch changed FG stock: ${fgAfterDispatch} -> ${fgAfterDuplicate}`);
    }
    recordStep({
      step: 'verify-duplicate-dispatch-idempotency',
      result: 'passed',
      statuses: duplicateDispatches.map((item) => item.status),
      entryCountAfterDuplicate,
      fgAfterDuplicate,
    });

    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error.message || error);
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  }

  if (report.status !== 'passed') {
    console.error(report.error || 'money goods chain audit failed');
    process.exit(1);
  }

  console.log(`Money goods chain API audit passed. Report: ${REPORT_PATH}`);
}

run();
