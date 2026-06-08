const fs = require('fs');
const path = require('path');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'receipt-tolerance-api-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9qsKQAAAAASUVORK5CYII=';

const DATA = {
  supplierName: `TOL-SUP-${RUN_ID}`,
  customerName: `TOL-CUS-${RUN_ID}`,
  allowProduct: `TOL-ALLOW-RAW-${RUN_ID}`,
  blockProduct: `TOL-BLOCK-RAW-${RUN_ID}`,
  manualProduct: `TOL-MANUAL-RAW-${RUN_ID}`,
  warnProduct: `TOL-WARN-FG-${RUN_ID}`,
  warnBatchNo: `TOL-WARN-BATCH-${RUN_ID}`,
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

async function createSupplier(token, suffix) {
  const response = await expectOk(`create supplier ${suffix}`, apiFetch('/procurement/suppliers', {
    method: 'POST',
    data: {
      name: `${DATA.supplierName}-${suffix}`,
      nameZh: `${DATA.supplierName}-${suffix}`,
      nameEn: `Supplier ${suffix} ${RUN_ID}`,
      nameVi: `Nha cung cap ${suffix} ${RUN_ID}`,
      category: 'Raw Materials',
      contact: `Buyer ${RUN_ID.slice(-4)}`,
      riskLevel: 'low',
      addresses: [{
        type: 'legal',
        label: 'legal',
        countryCode: 'VN',
        city: 'Hanoi',
        fullAddress: `Tolerance supplier ${suffix} address`,
      }],
      contacts: [{
        name: `Buyer ${RUN_ID.slice(-4)}`,
        phone: `09${RUN_ID.slice(-8)}`,
        language: 'zh',
        isPrimary: true,
      }],
    },
  }, token));
  if (!response.json?.data?.id) throw new Error(`supplier id missing for ${suffix}`);
  return response.json.data;
}

async function createCustomer(token) {
  const response = await expectOk('create customer', apiFetch('/customers', {
    method: 'POST',
    data: {
      nameZh: DATA.customerName,
      nameEn: `Customer ${RUN_ID}`,
      nameVi: `Khach hang ${RUN_ID}`,
      licenseNumber: `TOL-LIC-${RUN_ID}`,
      creditLimit: 1000000,
      riskLevel: 'low',
      segment: 'direct',
      poolState: 'private',
      contactName: `Contact ${RUN_ID.slice(-4)}`,
      contactPhone: `09${RUN_ID.slice(-8)}`,
      addresses: [{
        type: 'shipping',
        label: 'shipping',
        countryCode: 'VN',
        city: 'Ho Chi Minh',
        fullAddress: 'Tolerance shipment customer address',
      }],
      contacts: [{
        name: `Contact ${RUN_ID.slice(-4)}`,
        phone: `09${RUN_ID.slice(-8)}`,
        language: 'zh',
        isPrimary: true,
      }],
    },
  }, token));
  if (!response.json?.data?.id) throw new Error('customer id missing');
  return response.json.data;
}

async function createToleranceRule(token, data) {
  const response = await expectOk(`create tolerance rule ${data.name}`, apiFetch('/receipt-discrepancies/tolerance-rules', {
    method: 'POST',
    data,
  }, token));
  if (!response.json?.data?.id) throw new Error(`tolerance rule id missing for ${data.name}`);
  return response.json.data;
}

async function createApprovedPurchaseOrder(token, supplierId, productName, quantity) {
  const createOrder = await expectOk(`create purchase order ${productName}`, apiFetch('/procurement/orders', {
    method: 'POST',
    data: {
      supplierId: Number(supplierId),
      item: productName,
      quantity,
      unit: 'kg',
      price: 12,
      eta: '2026-05-30',
    },
  }, token));
  const order = createOrder.json.data;
  await expectOk(`approve purchase order ${productName}`, apiFetch(`/procurement/orders/${order.id}/status`, {
    method: 'PATCH',
    data: { status: 'approved' },
  }, token));
  return order;
}

async function createPurchaseReceipt(token, orderId, data) {
  return apiFetch(`/procurement/orders/${orderId}/receipts`, {
    method: 'POST',
    data,
  }, token);
}

async function readPurchaseReceipts(token, orderId) {
  const response = await expectOk(`read purchase receipts ${orderId}`, apiFetch(`/procurement/orders/${orderId}/receipts`, {}, token));
  return response.json.data;
}

async function readDiscrepancyCases(token, query) {
  const params = new URLSearchParams(query);
  const response = await expectOk('read discrepancy cases', apiFetch(`/receipt-discrepancies?${params.toString()}`, {}, token));
  return unwrapList(response);
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
      sourceRef: `RECEIPT-TOLERANCE-STOCK-SEED-${RUN_ID}-${batchNo}`,
      reason: 'receipt_tolerance_audit_seed',
      note: `receipt tolerance audit ${RUN_ID}`,
    },
  }, token));
  return response.json.data;
}

async function runAllowTolerance(manager) {
  const supplier = await createSupplier(manager.token, 'ALLOW');
  const rule = await createToleranceRule(manager.token, {
    name: `Allow purchase tolerance ${RUN_ID}`,
    sourceType: 'purchase_receipt',
    discrepancyType: 'short_shipped',
    counterpartyType: 'supplier',
    productName: DATA.allowProduct,
    quantityTolerancePercent: 30,
    quantityToleranceAbs: 0,
    actionWithinTolerance: 'allow',
    actionOutsideTolerance: 'manual_review',
    severityWithinTolerance: 'low',
    severityOutsideTolerance: 'normal',
    priority: 10,
    note: 'API audit allow rule',
  });
  const order = await createApprovedPurchaseOrder(manager.token, supplier.id, DATA.allowProduct, 10);
  const receipt = await expectOk('create allow purchase receipt', createPurchaseReceipt(manager.token, order.id, {
    quantity: 10,
    acceptedQuantity: 8,
    rejectedQuantity: 2,
    batchNo: `${DATA.allowProduct}-B1`,
    discrepancyType: 'short_shipped',
    discrepancyReason: 'allow tolerance test',
    note: 'allow tolerance audit',
  }));
  const discrepancyCase = receipt.json.data.discrepancyCase;
  assertEqual(discrepancyCase.status, 'resolved', 'allow tolerance should auto resolve');
  assertEqual(discrepancyCase.toleranceAction, 'allow', 'allow tolerance action');
  assertEqual(discrepancyCase.withinTolerance, true, 'allow tolerance within flag');
  assertEqual(discrepancyCase.toleranceRuleId, rule.id, 'allow tolerance rule id');
  assertNumber(discrepancyCase.varianceRate, 20, 'allow variance rate');
  recordStep({
    step: 'purchase-allow-tolerance',
    result: 'passed',
    orderId: order.id,
    ruleNo: rule.ruleNo,
    caseNo: discrepancyCase.caseNo,
  });
}

async function runBlockTolerance(manager) {
  const supplier = await createSupplier(manager.token, 'BLOCK');
  const rule = await createToleranceRule(manager.token, {
    name: `Block purchase tolerance ${RUN_ID}`,
    sourceType: 'purchase_receipt',
    discrepancyType: 'short_shipped',
    counterpartyType: 'supplier',
    productName: DATA.blockProduct,
    quantityTolerancePercent: 5,
    quantityToleranceAbs: 0,
    actionWithinTolerance: 'warn',
    actionOutsideTolerance: 'block',
    severityWithinTolerance: 'low',
    severityOutsideTolerance: 'high',
    priority: 10,
    note: 'API audit block rule',
  });
  const order = await createApprovedPurchaseOrder(manager.token, supplier.id, DATA.blockProduct, 10);
  const blocked = await createPurchaseReceipt(manager.token, order.id, {
    quantity: 10,
    acceptedQuantity: 8,
    rejectedQuantity: 2,
    batchNo: `${DATA.blockProduct}-B1`,
    discrepancyType: 'short_shipped',
    discrepancyReason: 'block tolerance test',
    note: 'block tolerance audit',
  });
  assertEqual(blocked.status, 409, 'block tolerance should reject receipt');
  const readback = await readPurchaseReceipts(manager.token, order.id);
  assertEqual(readback.receipts.length, 0, 'blocked receipt must not persist purchase receipt rows');
  assertNumber(readback.receiptSummary.processedQuantity, 0, 'blocked receipt must not change processed quantity');
  const cases = await readDiscrepancyCases(manager.token, {
    relatedModule: 'procurement',
    relatedId: order.id,
  });
  assertEqual(cases.length, 0, 'blocked receipt must not create discrepancy case');
  recordStep({
    step: 'purchase-block-tolerance',
    result: 'passed',
    orderId: order.id,
    ruleNo: rule.ruleNo,
    blockedStatus: blocked.status,
  });
}

async function runManualDefault(manager) {
  const supplier = await createSupplier(manager.token, 'MANUAL');
  const order = await createApprovedPurchaseOrder(manager.token, supplier.id, DATA.manualProduct, 10);
  const receipt = await expectOk('create manual purchase receipt', createPurchaseReceipt(manager.token, order.id, {
    quantity: 10,
    acceptedQuantity: 9,
    rejectedQuantity: 1,
    batchNo: `${DATA.manualProduct}-B1`,
    discrepancyType: 'short_shipped',
    discrepancyReason: 'manual default test',
    note: 'manual default tolerance audit',
  }));
  const discrepancyCase = receipt.json.data.discrepancyCase;
  assertEqual(discrepancyCase.status, 'pending', 'manual default should stay pending');
  assertEqual(discrepancyCase.toleranceAction, 'manual_review', 'manual default action');
  assertEqual(discrepancyCase.withinTolerance, false, 'manual default within flag');
  recordStep({
    step: 'purchase-manual-default-tolerance',
    result: 'passed',
    orderId: order.id,
    caseNo: discrepancyCase.caseNo,
  });
}

async function runWarnShipmentTolerance(manager, sales) {
  const customer = await createCustomer(sales.token);
  const rule = await createToleranceRule(manager.token, {
    name: `Warn shipment tolerance ${RUN_ID}`,
    sourceType: 'shipment_receipt',
    discrepancyType: 'customer_short_signed',
    counterpartyType: 'customer',
    productName: DATA.warnProduct,
    quantityTolerancePercent: 30,
    quantityToleranceAbs: 0,
    actionWithinTolerance: 'warn',
    actionOutsideTolerance: 'manual_review',
    severityWithinTolerance: 'low',
    severityOutsideTolerance: 'normal',
    priority: 10,
    note: 'API audit warn rule',
  });
  await seedStock(manager.token, DATA.warnProduct, DATA.warnBatchNo, 12);

  const createOrder = await expectOk('create sales order for warn shipment', apiFetch('/orders', {
    method: 'POST',
    data: {
      customerId: Number(customer.id),
      items: [{
        productName: DATA.warnProduct,
        quantity: 10,
        unit: 'kg',
        unitPrice: 100,
      }],
      paymentTerms: 30,
      notes: `receipt tolerance audit ${RUN_ID}`,
    },
  }, sales.token));
  const order = createOrder.json.data;
  await expectOk('confirm sales order for warn shipment', apiFetch(`/orders/${order.id}/status`, {
    method: 'PATCH',
    data: { status: 'confirmed' },
  }, manager.token));

  const createShipment = await expectOk('create warn shipment', apiFetch('/shipping', {
    method: 'POST',
    data: {
      customerId: Number(customer.id),
      orderId: Number(order.id),
      productName: DATA.warnProduct,
      quantity: 10,
      unit: 'kg',
      batchNo: DATA.warnBatchNo,
      carrier: `TOL-CARRIER-${RUN_ID.slice(-4)}`,
      trackingNo: `TOL-${RUN_ID}`,
    },
  }, manager.token));
  const shipment = createShipment.json.data;
  await expectOk('dispatch warn shipment', apiFetch(`/shipping/${shipment.id}/status`, {
    method: 'PATCH',
    data: { status: 'in_transit' },
  }, manager.token));

  const receipt = await expectOk('create warn shipment receipt event', apiFetch(`/shipping/${shipment.id}/receipt-events`, {
    method: 'POST',
    data: {
      quantity: 10,
      acceptedQuantity: 8,
      rejectedQuantity: 2,
      discrepancyType: 'customer_short_signed',
      fileName: `warn-receipt-${RUN_ID}.png`,
      mimeType: 'image/png',
      dataUrl: `data:image/png;base64,${PNG_1X1}`,
      discrepancyReason: 'warn tolerance test',
      note: 'warn tolerance audit',
    },
  }, manager.token));
  const discrepancyCase = receipt.json.data.discrepancyCase;
  assertEqual(receipt.json.data.shipment.status, 'exception', 'warn shipment should enter exception');
  assertEqual(discrepancyCase.status, 'pending', 'warn tolerance should stay pending');
  assertEqual(discrepancyCase.toleranceAction, 'warn', 'warn tolerance action');
  assertEqual(discrepancyCase.withinTolerance, true, 'warn tolerance within flag');
  assertEqual(discrepancyCase.toleranceRuleId, rule.id, 'warn tolerance rule id');
  assertNumber(discrepancyCase.varianceRate, 20, 'warn variance rate');
  recordStep({
    step: 'shipment-warn-tolerance',
    result: 'passed',
    shipmentId: shipment.id,
    ruleNo: rule.ruleNo,
    caseNo: discrepancyCase.caseNo,
  });
}

async function run() {
  try {
    const manager = await login('manager', 'manager123');
    const sales = await login('sales', 'sales123');
    recordStep({ step: 'login-users', result: 'passed', managerId: manager.user.id, salesId: sales.user.id });

    await runAllowTolerance(manager);
    await runBlockTolerance(manager);
    await runManualDefault(manager);
    await runWarnShipmentTolerance(manager, sales);
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
    console.error(report.error || 'receipt tolerance api audit failed');
    process.exit(1);
  }

  console.log(`Receipt tolerance API audit passed. Report: ${REPORT_PATH}`);
}

run();
