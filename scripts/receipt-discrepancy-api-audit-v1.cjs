const fs = require('fs');
const path = require('path');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'receipt-discrepancy-api-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9qsKQAAAAASUVORK5CYII=';

const DATA = {
  supplierName: `DISC-SUP-${RUN_ID}`,
  customerName: `DISC-CUS-${RUN_ID}`,
  purchaseItem: `DISC-RAW-${RUN_ID}`,
  shipmentProduct: `DISC-FG-${RUN_ID}`,
  shipmentBatchNo: `DISC-FG-BATCH-${RUN_ID}`,
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

function assertEqual(actual, expected, message) {
  if (String(actual) !== String(expected)) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertNumber(actual, expected, message) {
  if (Math.abs(Number(actual) - Number(expected)) > 0.000001) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
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
  return response.json.data;
}

async function createSupplier(token) {
  const response = await expectOk('create supplier', apiFetch('/procurement/suppliers', {
    method: 'POST',
    data: {
      name: DATA.supplierName,
      nameZh: DATA.supplierName,
      nameEn: `Supplier ${RUN_ID}`,
      nameVi: `Nha cung cap ${RUN_ID}`,
      category: 'Raw Materials',
      contact: `Buyer ${RUN_ID.slice(-4)}`,
      riskLevel: 'low',
      addresses: [{
        type: 'legal',
        countryCode: 'VN',
        city: 'Hanoi',
        fullAddress: 'Receipt discrepancy supplier address',
      }],
      contacts: [{
        name: `Buyer ${RUN_ID.slice(-4)}`,
        phone: `09${RUN_ID.slice(-8)}`,
        language: 'zh',
        isPrimary: true,
      }],
    },
  }, token));
  return response.json.data;
}

async function createCustomer(token) {
  const response = await expectOk('create customer', apiFetch('/customers', {
    method: 'POST',
    data: {
      nameZh: DATA.customerName,
      nameEn: `Customer ${RUN_ID}`,
      nameVi: `Khach hang ${RUN_ID}`,
      licenseNumber: `DISC-LIC-${RUN_ID}`,
      creditLimit: 1000000,
      riskLevel: 'low',
      segment: 'direct',
      poolState: 'private',
      contactName: `Contact ${RUN_ID.slice(-4)}`,
      contactPhone: `09${RUN_ID.slice(-8)}`,
      addresses: [{
        type: 'shipping',
        countryCode: 'VN',
        city: 'Ho Chi Minh',
        fullAddress: 'Receipt discrepancy customer address',
      }],
      contacts: [{
        name: `Contact ${RUN_ID.slice(-4)}`,
        phone: `09${RUN_ID.slice(-8)}`,
        language: 'zh',
        isPrimary: true,
      }],
    },
  }, token));
  return response.json.data;
}

async function resolveLocation(token, locationCode) {
  const response = await expectOk('list warehouses', apiFetch('/warehouses', {}, token));
  for (const warehouse of unwrapList(response)) {
    const location = (warehouse.locations || []).find((item) => String(item.code) === locationCode);
    if (location) return location;
  }
  throw new Error(`location ${locationCode} not found`);
}

async function seedStock(token, productName, batchNo, quantity) {
  const location = await resolveLocation(token, 'LOC-FG');
  const response = await expectOk('seed finished goods stock', apiFetch('/warehouses/stock-balances', {
    method: 'POST',
    data: {
      locationId: Number(location.id),
      productName,
      batchNo,
      quantity,
      unit: 'kg',
      sourceRef: `RECEIPT-DISCREPANCY-STOCK-SEED-${RUN_ID}-${batchNo}`,
      reason: 'receipt_discrepancy_audit_seed',
      note: `receipt discrepancy audit ${RUN_ID}`,
    },
  }, token));
  return response.json.data;
}

async function readDiscrepancyCases(token, query) {
  const params = new URLSearchParams(query);
  const response = await expectOk('read discrepancy cases', apiFetch(`/receipt-discrepancies?${params.toString()}`, {}, token));
  return unwrapList(response);
}

async function resolveDiscrepancyCase(token, caseId, resolution) {
  const response = await expectOk('resolve discrepancy case', apiFetch(`/receipt-discrepancies/${caseId}/resolve`, {
    method: 'PATCH',
    data: {
      status: 'resolved',
      resolution,
      actionRef: `ACT-${RUN_ID}`,
      note: 'audit resolved',
    },
  }, token));
  return response.json.data;
}

async function runProcurementDiscrepancy(manager) {
  const supplier = await createSupplier(manager.token);
  const createOrder = await expectOk('create purchase order', apiFetch('/procurement/orders', {
    method: 'POST',
    data: {
      supplierId: Number(supplier.id),
      item: DATA.purchaseItem,
      quantity: 5,
      unit: 'kg',
      price: 16,
      eta: '2026-05-30',
    },
  }, manager.token));
  const order = createOrder.json.data;
  await expectOk('approve purchase order', apiFetch(`/procurement/orders/${order.id}/status`, {
    method: 'PATCH',
    data: { status: 'approved' },
  }, manager.token));

  const receipt = await expectOk('create purchase rejected receipt', apiFetch(`/procurement/orders/${order.id}/receipts`, {
    method: 'POST',
    data: {
      quantity: 5,
      acceptedQuantity: 3,
      rejectedQuantity: 2,
      batchNo: `${DATA.purchaseItem}-B1`,
      discrepancyReason: '到货短少/拒收，需要供应商补发或索赔',
      note: 'procurement discrepancy audit',
    },
  }, manager.token));
  assertNumber(receipt.json.data.receiptSummary.rejectedQuantity, 2, 'purchase rejected quantity');
  if (!receipt.json.data.discrepancyCase?.caseNo) {
    throw new Error('purchase discrepancy case missing in create response');
  }

  const sourceRef = receipt.json.data.discrepancyCase.sourceRef;
  const cases = await readDiscrepancyCases(manager.token, {
    sourceType: 'purchase_receipt',
    sourceRef,
  });
  assertEqual(cases.length, 1, 'purchase discrepancy case count');
  assertEqual(cases[0].status, 'pending', 'purchase discrepancy status');
  assertEqual(cases[0].relatedModule, 'procurement', 'purchase discrepancy module');
  assertNumber(cases[0].quantity, 2, 'purchase discrepancy case quantity');

  const resolved = await resolveDiscrepancyCase(manager.token, cases[0].id, '供应商确认补发或索赔，先关闭测试异常');
  assertEqual(resolved.status, 'resolved', 'purchase discrepancy resolved status');
  recordStep({
    step: 'procurement-discrepancy-case',
    result: 'passed',
    orderId: order.id,
    sourceRef,
    caseNo: cases[0].caseNo,
  });
  return { orderId: order.id, sourceRef, caseId: cases[0].id };
}

async function runShippingDiscrepancy(manager, sales) {
  const customer = await createCustomer(sales.token);
  await seedStock(manager.token, DATA.shipmentProduct, DATA.shipmentBatchNo, 8);

  const createOrder = await expectOk('create sales order', apiFetch('/orders', {
    method: 'POST',
    data: {
      customerId: Number(customer.id),
      items: [{
        productName: DATA.shipmentProduct,
        quantity: 5,
        unit: 'kg',
        unitPrice: 88,
      }],
      paymentTerms: 30,
      notes: `receipt discrepancy audit ${RUN_ID}`,
    },
  }, sales.token));
  const order = createOrder.json.data;
  await expectOk('confirm sales order', apiFetch(`/orders/${order.id}/status`, {
    method: 'PATCH',
    data: { status: 'confirmed' },
  }, manager.token));

  const createShipment = await expectOk('create shipment', apiFetch('/shipping', {
    method: 'POST',
    data: {
      customerId: Number(customer.id),
      orderId: Number(order.id),
      productName: DATA.shipmentProduct,
      quantity: 5,
      unit: 'kg',
      batchNo: DATA.shipmentBatchNo,
      carrier: `DISC-CARRIER-${RUN_ID.slice(-4)}`,
      trackingNo: `DISC-${RUN_ID}`,
    },
  }, manager.token));
  const shipment = createShipment.json.data;
  await expectOk('dispatch shipment', apiFetch(`/shipping/${shipment.id}/status`, {
    method: 'PATCH',
    data: { status: 'in_transit' },
  }, manager.token));

  const receipt = await expectOk('create shipment rejected receipt event', apiFetch(`/shipping/${shipment.id}/receipt-events`, {
    method: 'POST',
    data: {
      quantity: 5,
      acceptedQuantity: 3,
      rejectedQuantity: 2,
      fileName: `discrepancy-receipt-${RUN_ID}.png`,
      mimeType: 'image/png',
      dataUrl: `data:image/png;base64,${PNG_1X1}`,
      discrepancyReason: '客户签收异常，需要补发、退换或售后处理',
      note: 'shipping discrepancy audit',
    },
  }, manager.token));
  assertEqual(receipt.json.data.shipment.status, 'exception', 'shipment status after rejected receipt');
  assertNumber(receipt.json.data.receiptSummary.rejectedQuantity, 2, 'shipment rejected quantity');
  if (!receipt.json.data.discrepancyCase?.caseNo) {
    throw new Error('shipping discrepancy case missing in create response');
  }

  const sourceRef = receipt.json.data.discrepancyCase.sourceRef;
  const cases = await readDiscrepancyCases(manager.token, {
    sourceType: 'shipment_receipt',
    sourceRef,
  });
  assertEqual(cases.length, 1, 'shipping discrepancy case count');
  assertEqual(cases[0].status, 'pending', 'shipping discrepancy status');
  assertEqual(cases[0].relatedModule, 'shipping', 'shipping discrepancy module');
  assertNumber(cases[0].quantity, 2, 'shipping discrepancy case quantity');

  const resolved = await resolveDiscrepancyCase(manager.token, cases[0].id, '客户签收异常已转售后/补发评审，先关闭测试异常');
  assertEqual(resolved.status, 'resolved', 'shipping discrepancy resolved status');
  recordStep({
    step: 'shipping-discrepancy-case',
    result: 'passed',
    shipmentId: shipment.id,
    sourceRef,
    caseNo: cases[0].caseNo,
  });
  return { orderId: order.id, shipmentId: shipment.id, sourceRef, caseId: cases[0].id };
}

async function run() {
  try {
    const manager = await login('manager', 'manager123');
    const sales = await login('sales', 'sales123');
    recordStep({ step: 'login-users', result: 'passed', managerId: manager.user.id, salesId: sales.user.id });

    report.procurement = await runProcurementDiscrepancy(manager);
    report.shipping = await runShippingDiscrepancy(manager, sales);
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
    console.error(report.error || 'receipt discrepancy api audit failed');
    process.exit(1);
  }

  console.log(`Receipt discrepancy API audit passed. Report: ${REPORT_PATH}`);
}

run();
