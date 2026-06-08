const fs = require('fs');
const path = require('path');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'partial-receipt-api-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9qsKQAAAAASUVORK5CYII=';

const DATA = {
  supplierName: `PART-SUP-${RUN_ID}`,
  customerName: `PART-CUS-${RUN_ID}`,
  purchaseItem: `PART-RAW-${RUN_ID}`,
  purchaseQuantity: 10,
  shipmentProduct: `PART-FG-${RUN_ID}`,
  shipmentBatchNo: `PART-FG-BATCH-${RUN_ID}`,
  stockQuantity: 16,
  shipmentQuantity: 10,
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
        label: 'legal',
        countryCode: 'VN',
        city: 'Hanoi',
        fullAddress: 'Partial receipt supplier address',
      }],
      contacts: [{
        name: `Buyer ${RUN_ID.slice(-4)}`,
        phone: `09${RUN_ID.slice(-8)}`,
        language: 'zh',
        isPrimary: true,
      }],
    },
  }, token));
  if (!response.json?.data?.id) throw new Error('supplier id missing');
  return response.json.data;
}

async function createCustomer(token) {
  const response = await expectOk('create customer', apiFetch('/customers', {
    method: 'POST',
    data: {
      nameZh: DATA.customerName,
      nameEn: `Customer ${RUN_ID}`,
      nameVi: `Khach hang ${RUN_ID}`,
      licenseNumber: `PART-LIC-${RUN_ID}`,
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
        fullAddress: 'Partial shipment customer address',
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
      sourceRef: `PARTIAL-RECEIPT-STOCK-SEED-${RUN_ID}-${batchNo}`,
      reason: 'partial_receipt_audit_seed',
      note: `partial-receipt audit ${RUN_ID}`,
    },
  }, token));
  return { location, balance: response.json.data };
}

async function readStockBalance(token, productName, batchNo, locationCode) {
  const response = await expectOk('read stock balance', apiFetch(
    `/warehouses/stock-balances?productName=${encodeURIComponent(productName)}&batchNo=${encodeURIComponent(batchNo)}&pageSize=100`,
    {},
    token,
  ));
  const rows = unwrapList(response).filter((item) => (
    String(item.productName) === String(productName)
    && String(item.batchNo) === String(batchNo)
    && String(item.locationCode || '') === String(locationCode)
  ));
  return rows.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

async function countStockEntries(token, sourceType, sourceRef) {
  const response = await expectOk('read stock entries', apiFetch(
    `/warehouses/stock-entries?sourceType=${encodeURIComponent(sourceType)}&sourceRef=${encodeURIComponent(sourceRef)}&limit=100`,
    {},
    token,
  ));
  return unwrapList(response).filter((entry) => (
    String(entry.sourceType) === sourceType && String(entry.sourceRef) === String(sourceRef)
  )).length;
}

async function runProcurementFlow(manager) {
  const supplier = await createSupplier(manager.token);
  recordStep({ step: 'procurement-create-supplier', result: 'passed', supplierId: supplier.id });

  const createOrder = await expectOk('create purchase order', apiFetch('/procurement/orders', {
    method: 'POST',
    data: {
      supplierId: Number(supplier.id),
      item: DATA.purchaseItem,
      quantity: DATA.purchaseQuantity,
      unit: 'kg',
      price: 12,
      eta: '2026-05-30',
    },
  }, manager.token));
  const order = createOrder.json.data;
  recordStep({ step: 'procurement-create-order', result: 'passed', orderId: order.id, status: order.status });

  const approveOrder = await expectOk('approve purchase order', apiFetch(`/procurement/orders/${order.id}/status`, {
    method: 'PATCH',
    data: { status: 'approved' },
  }, manager.token));
  assertEqual(approveOrder.json.data.status, 'approved', 'purchase order approve status');
  recordStep({ step: 'procurement-approve-order', result: 'passed', orderId: order.id });

  const mismatchReceipt = await apiFetch(`/procurement/orders/${order.id}/receipts`, {
    method: 'POST',
    data: { quantity: 3, acceptedQuantity: 2, rejectedQuantity: 0 },
  }, manager.token);
  assertEqual(mismatchReceipt.status, 400, 'mismatched receipt quantities must be blocked');

  const negativeReceipt = await apiFetch(`/procurement/orders/${order.id}/receipts`, {
    method: 'POST',
    data: { quantity: -1, acceptedQuantity: -1, rejectedQuantity: 0 },
  }, manager.token);
  assertEqual(negativeReceipt.status, 400, 'negative receipt quantity must be blocked');

  const zeroReceipt = await apiFetch(`/procurement/orders/${order.id}/receipts`, {
    method: 'POST',
    data: { quantity: 0, acceptedQuantity: 0, rejectedQuantity: 0 },
  }, manager.token);
  assertEqual(zeroReceipt.status, 400, 'zero receipt quantity must be blocked');

  const invalidDateReceipt = await apiFetch(`/procurement/orders/${order.id}/receipts`, {
    method: 'POST',
    data: {
      quantity: 1,
      acceptedQuantity: 1,
      rejectedQuantity: 0,
      receivedAt: 'not-a-date',
    },
  }, manager.token);
  assertEqual(invalidDateReceipt.status, 400, 'invalid receipt date must be blocked');

  const receiptsAfterInvalidInput = await expectOk('read receipts after invalid procurement inputs', apiFetch(
    `/procurement/orders/${order.id}/receipts`,
    {},
    manager.token,
  ));
  assertEqual(receiptsAfterInvalidInput.json.data.receipts.length, 0, 'invalid receipt inputs must not create receipt rows');
  assertNumber(
    receiptsAfterInvalidInput.json.data.receiptSummary.processedQuantity,
    0,
    'invalid receipt inputs must not change processed quantity',
  );
  recordStep({
    step: 'procurement-block-invalid-receipt-inputs',
    result: 'passed',
    statuses: {
      mismatch: mismatchReceipt.status,
      negative: negativeReceipt.status,
      zero: zeroReceipt.status,
      invalidDate: invalidDateReceipt.status,
    },
  });

  const receiptOne = await expectOk('create first purchase receipt', apiFetch(`/procurement/orders/${order.id}/receipts`, {
    method: 'POST',
    data: {
      quantity: 4,
      acceptedQuantity: 4,
      rejectedQuantity: 0,
      batchNo: `${DATA.purchaseItem}-B1`,
      note: 'first partial receipt',
    },
  }, manager.token));
  assertEqual(receiptOne.json.data.purchaseOrder.status, 'in_transit', 'first receipt purchase status');
  assertNumber(receiptOne.json.data.receiptSummary.remainingQuantity, 6, 'first receipt remaining quantity');
  recordStep({ step: 'procurement-first-partial-receipt', result: 'passed', orderId: order.id });

  const blockedLegacyReceive = await apiFetch(`/procurement/orders/${order.id}/status`, {
    method: 'PATCH',
    data: { status: 'received' },
  }, manager.token);
  assertEqual(blockedLegacyReceive.status, 409, 'legacy full receive after partial receipt must be blocked');
  recordStep({ step: 'procurement-block-legacy-full-receive', result: 'passed', status: blockedLegacyReceive.status });

  const receiptTwo = await expectOk('create second purchase receipt', apiFetch(`/procurement/orders/${order.id}/receipts`, {
    method: 'POST',
    data: {
      quantity: 6,
      acceptedQuantity: 5,
      rejectedQuantity: 1,
      batchNo: `${DATA.purchaseItem}-B2`,
      discrepancyReason: 'short accepted sample',
      note: 'second partial receipt with rejected quantity',
    },
  }, manager.token));
  assertEqual(receiptTwo.json.data.purchaseOrder.status, 'received', 'second receipt purchase status');
  assertNumber(receiptTwo.json.data.receiptSummary.acceptedQuantity, 9, 'purchase accepted quantity');
  assertNumber(receiptTwo.json.data.receiptSummary.rejectedQuantity, 1, 'purchase rejected quantity');
  assertNumber(receiptTwo.json.data.receiptSummary.remainingQuantity, 0, 'purchase remaining quantity');
  assertEqual(receiptTwo.json.data.receipts.length, 2, 'purchase receipt row count');
  recordStep({ step: 'procurement-second-partial-receipt', result: 'passed', orderId: order.id });

  const overReceipt = await apiFetch(`/procurement/orders/${order.id}/receipts`, {
    method: 'POST',
    data: { quantity: 1, acceptedQuantity: 1, rejectedQuantity: 0 },
  }, manager.token);
  assertEqual(overReceipt.status, 409, 'purchase over receipt must be blocked');
  recordStep({ step: 'procurement-block-over-receipt', result: 'passed', status: overReceipt.status });

  const batchOneBalance = await readStockBalance(manager.token, DATA.purchaseItem, `${DATA.purchaseItem}-B1`, 'LOC-RAW');
  const batchTwoBalance = await readStockBalance(manager.token, DATA.purchaseItem, `${DATA.purchaseItem}-B2`, 'LOC-RAW');
  assertNumber(batchOneBalance + batchTwoBalance, 9, 'purchase accepted stock quantity');

  const stockEntryRefs = receiptTwo.json.data.receipts
    .map((item) => item.stockEntryRef)
    .filter(Boolean);
  if (stockEntryRefs.length !== 2) {
    throw new Error(`expected 2 procurement stock entry refs, got ${stockEntryRefs.length}`);
  }
  for (const sourceRef of stockEntryRefs) {
    const count = await countStockEntries(manager.token, 'procurement_receipt', sourceRef);
    assertEqual(count, 1, `procurement stock entry count for ${sourceRef}`);
  }
  recordStep({
    step: 'procurement-verify-stock-and-ledger',
    result: 'passed',
    rawAcceptedQuantity: batchOneBalance + batchTwoBalance,
    stockEntryRefs,
  });

  return { supplierId: supplier.id, purchaseOrderId: order.id, stockEntryRefs };
}

async function runShippingFlow(manager, sales) {
  const customer = await createCustomer(sales.token);
  recordStep({ step: 'shipping-create-customer', result: 'passed', customerId: customer.id });

  await seedStock(manager.token, DATA.shipmentProduct, DATA.shipmentBatchNo, DATA.stockQuantity);
  const stockBefore = await readStockBalance(manager.token, DATA.shipmentProduct, DATA.shipmentBatchNo, 'LOC-FG');
  assertNumber(stockBefore, DATA.stockQuantity, 'seeded finished goods stock');
  recordStep({ step: 'shipping-seed-finished-goods', result: 'passed', stockBefore });

  const createOrder = await expectOk('create sales order', apiFetch('/orders', {
    method: 'POST',
    data: {
      customerId: Number(customer.id),
      items: [{
        productName: DATA.shipmentProduct,
        quantity: DATA.shipmentQuantity,
        unit: 'kg',
        unitPrice: 100,
      }],
      paymentTerms: 30,
      notes: `partial shipment audit ${RUN_ID}`,
    },
  }, sales.token));
  const order = createOrder.json.data;

  await expectOk('confirm sales order', apiFetch(`/orders/${order.id}/status`, {
    method: 'PATCH',
    data: { status: 'confirmed' },
  }, manager.token));
  recordStep({ step: 'shipping-create-confirm-order', result: 'passed', orderId: order.id });

  const createShipment = await expectOk('create shipment', apiFetch('/shipping', {
    method: 'POST',
    data: {
      customerId: Number(customer.id),
      orderId: Number(order.id),
      productName: DATA.shipmentProduct,
      quantity: DATA.shipmentQuantity,
      unit: 'kg',
      batchNo: DATA.shipmentBatchNo,
      carrier: `PART-CARRIER-${RUN_ID.slice(-4)}`,
      trackingNo: `PART-${RUN_ID}`,
    },
  }, manager.token));
  const shipment = createShipment.json.data;
  recordStep({ step: 'shipping-create-shipment', result: 'passed', shipmentId: shipment.id, shipmentNo: shipment.shipmentNo });

  const dispatchShipment = await expectOk('dispatch shipment', apiFetch(`/shipping/${shipment.id}/status`, {
    method: 'PATCH',
    data: { status: 'in_transit' },
  }, manager.token));
  assertEqual(dispatchShipment.json.data.status, 'in_transit', 'dispatch shipment status');
  const stockAfterDispatch = await readStockBalance(manager.token, DATA.shipmentProduct, DATA.shipmentBatchNo, 'LOC-FG');
  assertNumber(stockAfterDispatch, DATA.stockQuantity - DATA.shipmentQuantity, 'stock after dispatch');
  assertEqual(await countStockEntries(manager.token, 'shipping_issue', shipment.shipmentNo), 1, 'shipping issue entry count');
  recordStep({ step: 'shipping-dispatch-and-verify-stock', result: 'passed', stockAfterDispatch });

  const receiptOne = await expectOk('create first shipment receipt event', apiFetch(`/shipping/${shipment.id}/receipt-events`, {
    method: 'POST',
    data: {
      quantity: 4,
      acceptedQuantity: 4,
      rejectedQuantity: 0,
      fileName: `partial-receipt-1-${RUN_ID}.png`,
      mimeType: 'image/png',
      dataUrl: `data:image/png;base64,${PNG_1X1}`,
      note: 'first partial signed receipt',
    },
  }, manager.token));
  assertEqual(receiptOne.json.data.shipment.status, 'in_transit', 'first shipment receipt status');
  assertNumber(receiptOne.json.data.receiptSummary.remainingQuantity, 6, 'first shipment remaining quantity');
  recordStep({ step: 'shipping-first-partial-receipt', result: 'passed', shipmentId: shipment.id });

  const blockedFullReceipt = await apiFetch(`/shipping/${shipment.id}/receipt`, {
    method: 'POST',
    data: {
      fileName: `legacy-full-receipt-${RUN_ID}.png`,
      mimeType: 'image/png',
      dataUrl: `data:image/png;base64,${PNG_1X1}`,
    },
  }, manager.token);
  assertEqual(blockedFullReceipt.status, 409, 'legacy full receipt after partial event must be blocked');
  recordStep({ step: 'shipping-block-legacy-full-receipt', result: 'passed', status: blockedFullReceipt.status });

  const receiptTwo = await expectOk('create second shipment receipt event', apiFetch(`/shipping/${shipment.id}/receipt-events`, {
    method: 'POST',
    data: {
      quantity: 6,
      acceptedQuantity: 6,
      rejectedQuantity: 0,
      fileName: `partial-receipt-2-${RUN_ID}.png`,
      mimeType: 'image/png',
      dataUrl: `data:image/png;base64,${PNG_1X1}`,
      note: 'second partial signed receipt',
    },
  }, manager.token));
  assertEqual(receiptTwo.json.data.shipment.status, 'delivered', 'second shipment receipt status');
  assertNumber(receiptTwo.json.data.receiptSummary.remainingQuantity, 0, 'shipment remaining quantity');
  assertEqual(receiptTwo.json.data.receipts.length, 2, 'shipment receipt row count');
  recordStep({ step: 'shipping-second-partial-receipt', result: 'passed', shipmentId: shipment.id });

  const overReceipt = await apiFetch(`/shipping/${shipment.id}/receipt-events`, {
    method: 'POST',
    data: { quantity: 1, acceptedQuantity: 1, rejectedQuantity: 0 },
  }, manager.token);
  assertEqual(overReceipt.status, 409, 'shipment over receipt must be blocked');

  const finalStock = await readStockBalance(manager.token, DATA.shipmentProduct, DATA.shipmentBatchNo, 'LOC-FG');
  assertNumber(finalStock, DATA.stockQuantity - DATA.shipmentQuantity, 'stock after partial receipts must not double deduct');
  assertEqual(await countStockEntries(manager.token, 'shipping_issue', shipment.shipmentNo), 1, 'shipping issue stays idempotent');

  const orderReadback = await expectOk('read sales order', apiFetch(`/orders/${order.id}`, {}, manager.token));
  assertEqual(orderReadback.json.data.status, 'delivered', 'order status after full partial shipment receipts');
  recordStep({
    step: 'shipping-verify-final-readback',
    result: 'passed',
    finalStock,
    orderStatus: orderReadback.json.data.status,
  });

  return { customerId: customer.id, orderId: order.id, shipmentId: shipment.id, shipmentNo: shipment.shipmentNo };
}

async function run() {
  try {
    const manager = await login('manager', 'manager123');
    const sales = await login('sales', 'sales123');
    recordStep({ step: 'login-users', result: 'passed', managerId: manager.user.id, salesId: sales.user.id });

    report.procurement = await runProcurementFlow(manager);
    report.shipping = await runShippingFlow(manager, sales);
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
    console.error(report.error || 'partial receipt api audit failed');
    process.exit(1);
  }

  console.log(`Partial receipt API audit passed. Report: ${REPORT_PATH}`);
}

run();
