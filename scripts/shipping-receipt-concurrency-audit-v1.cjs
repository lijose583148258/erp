/**
 * Shipping receipt concurrency audit.
 *
 * Covers:
 * 1. Two partial receipt events racing against the same remaining quantity.
 * 2. Legacy full receipt upload racing against the partial receipt endpoint.
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('../backend/node_modules/@prisma/client');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'file:D:/AilaoDaRuntime/stable.db';

const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'shipping-receipt-concurrency-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9qsKQAAAAASUVORK5CYII=';
const prisma = new PrismaClient();

const report = {
  name: 'shipping-receipt-concurrency-audit-v1',
  appUrl: APP_URL,
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  status: 'running',
  steps: [],
  findings: [],
};

function recordStep(step, result, details = {}) {
  report.steps.push({
    at: new Date().toISOString(),
    step,
    result,
    ...details,
  });
}

function fail(message, details = {}) {
  const error = new Error(message);
  error.details = details;
  throw error;
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

async function expectOk(label, promise) {
  const response = await promise;
  if (!response.ok) {
    fail(`${label} failed: ${response.status}`, { response: response.json });
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

async function createCustomer(token, label) {
  const response = await expectOk(`create customer ${label}`, apiFetch('/customers', {
    method: 'POST',
    data: {
      nameZh: `签收并发客户-${label}-${RUN_ID}`,
      nameEn: `Shipping Race Customer ${label} ${RUN_ID}`,
      nameVi: `Khach giao hang ${label} ${RUN_ID}`,
      licenseNumber: `SHIP-RACE-LIC-${label}-${RUN_ID}`,
      creditLimit: 1000000,
      riskLevel: 'low',
      segment: 'direct',
      poolState: 'private',
      contactName: `Ship Contact ${RUN_ID.slice(-4)}`,
      contactPhone: `09${RUN_ID.slice(-8)}`,
      addresses: [{
        type: 'shipping',
        label: '发货地址',
        countryCode: 'VN',
        city: 'Ho Chi Minh',
        fullAddress: 'Shipping receipt concurrency audit address',
      }],
      contacts: [{
        name: `Ship Contact ${RUN_ID.slice(-4)}`,
        phone: `09${RUN_ID.slice(-8)}`,
        language: 'zh',
        isPrimary: true,
      }],
    },
  }, token));
  const customer = response.json?.data;
  if (!customer?.id) fail('Create customer returned empty id', { response: response.json });
  return customer;
}

async function resolveLocation(token, locationCode) {
  const response = await expectOk('list warehouses', apiFetch('/warehouses', {}, token));
  for (const warehouse of unwrapList(response)) {
    const location = (warehouse.locations || []).find(item => String(item.code) === locationCode);
    if (location) return location;
  }
  fail(`Location not found: ${locationCode}`);
}

async function seedFinishedGoods(token, productName, batchNo, quantity) {
  const location = await resolveLocation(token, 'LOC-FG');
  const response = await expectOk(`seed stock ${productName}`, apiFetch('/warehouses/stock-balances', {
    method: 'POST',
    data: {
      locationId: Number(location.id),
      productName,
      batchNo,
      quantity,
      unit: 'kg',
      sourceRef: `SHIPPING-RECEIPT-CONCURRENCY-STOCK-SEED-${RUN_ID}-${batchNo}`,
      reason: 'shipping_receipt_concurrency_seed',
      note: `shipping receipt concurrency audit ${RUN_ID}`,
    },
  }, token));
  return { location, balance: response.json?.data };
}

async function readStockBalance(token, productName, batchNo) {
  const response = await expectOk('read stock balance', apiFetch(
    `/warehouses/stock-balances?productName=${encodeURIComponent(productName)}&batchNo=${encodeURIComponent(batchNo)}&pageSize=100`,
    {},
    token,
  ));
  return unwrapList(response)
    .filter(item => String(item.productName) === productName && String(item.batchNo) === batchNo && String(item.locationCode || '') === 'LOC-FG')
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

async function createConfirmedOrder(createToken, statusToken, customerId, productName, quantity, label) {
  const createOrder = await expectOk(`create order ${label}`, apiFetch('/orders', {
    method: 'POST',
    data: {
      customerId: Number(customerId),
      items: [{
        productName,
        quantity,
        unit: 'kg',
        unitPrice: 100,
      }],
      paymentTerms: 30,
      notes: `shipping receipt concurrency ${label} ${RUN_ID}`,
    },
  }, createToken));
  const order = createOrder.json?.data;
  if (!order?.id) fail('Create order returned empty id', { response: createOrder.json });

  await expectOk(`confirm order ${label}`, apiFetch(`/orders/${order.id}/status`, {
    method: 'PATCH',
    data: { status: 'confirmed' },
  }, statusToken));
  return order;
}

async function createDispatchedShipment(token, customerId, orderId, productName, batchNo, quantity, label) {
  const createShipment = await expectOk(`create shipment ${label}`, apiFetch('/shipping', {
    method: 'POST',
    data: {
      customerId: Number(customerId),
      orderId: Number(orderId),
      productName,
      quantity,
      unit: 'kg',
      batchNo,
      carrier: `RACE-CARRIER-${label}-${RUN_ID.slice(-4)}`,
      trackingNo: `RACE-${label}-${RUN_ID}`,
    },
  }, token));
  const shipment = createShipment.json?.data;
  if (!shipment?.id || !shipment?.shipmentNo) fail('Create shipment returned empty id/no', { response: createShipment.json });

  await expectOk(`dispatch shipment ${label}`, apiFetch(`/shipping/${shipment.id}/status`, {
    method: 'PATCH',
    data: { status: 'in_transit' },
  }, token));
  return shipment;
}

async function createReceiptEvent(token, shipmentId, payload) {
  const response = await apiFetch(`/shipping/${shipmentId}/receipt-events`, {
    method: 'POST',
    data: payload,
  }, token);
  return {
    ok: response.ok,
    status: response.status,
    body: response.json,
  };
}

async function uploadFullReceipt(token, shipmentId, label) {
  const response = await apiFetch(`/shipping/${shipmentId}/receipt`, {
    method: 'POST',
    data: {
      fileName: `full-receipt-${label}-${RUN_ID}.png`,
      mimeType: 'image/png',
      dataUrl: `data:image/png;base64,${PNG_1X1}`,
    },
  }, token);
  return {
    ok: response.ok,
    status: response.status,
    body: response.json,
  };
}

async function readReceiptTotals(shipmentId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS receiptCount,
            COALESCE(SUM(quantity), 0) AS processedQuantity,
            COALESCE(SUM(accepted_quantity), 0) AS acceptedQuantity,
            COALESCE(SUM(rejected_quantity), 0) AS rejectedQuantity
       FROM shipment_receipts
      WHERE shipment_id = ?`,
    Number(shipmentId),
  );
  const row = rows[0] || {};
  return {
    receiptCount: Number(row.receiptCount || 0),
    processedQuantity: Number(row.processedQuantity || 0),
    acceptedQuantity: Number(row.acceptedQuantity || 0),
    rejectedQuantity: Number(row.rejectedQuantity || 0),
  };
}

async function countDiscrepancyCases(shipmentId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS count
       FROM receipt_discrepancy_cases
      WHERE related_module = 'shipping'
        AND related_id = ?`,
    Number(shipmentId),
  );
  return Number(rows[0]?.count || 0);
}

async function readShipment(shipmentId) {
  return prisma.shipment.findUnique({
    where: { id: Number(shipmentId) },
    select: {
      id: true,
      shipmentNo: true,
      status: true,
      signedReceiptUrl: true,
      deliveredAt: true,
      orderId: true,
    },
  });
}

async function countShippingIssueEntries(shipmentNo) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS count
       FROM stock_entries
      WHERE source_type = 'shipping_issue'
        AND source_ref = ?`,
    shipmentNo,
  );
  return Number(rows[0]?.count || 0);
}

async function setupShipmentPair({ managerToken, salesToken, label, quantity = 10, stockQuantity = 16 }) {
  const productName = `SHIP-RACE-${label}-${RUN_ID}`;
  const batchNo = `SHIP-RACE-${label}-BATCH-${RUN_ID}`;
  const customer = await createCustomer(salesToken, label);
  await seedFinishedGoods(managerToken, productName, batchNo, stockQuantity);
  const order = await createConfirmedOrder(salesToken, managerToken, customer.id, productName, quantity, label);
  const shipment = await createDispatchedShipment(managerToken, customer.id, order.id, productName, batchNo, quantity, label);
  const stockAfterDispatch = await readStockBalance(managerToken, productName, batchNo);
  const issueEntries = await countShippingIssueEntries(shipment.shipmentNo);
  if (stockAfterDispatch !== stockQuantity - quantity) {
    fail('Dispatch stock deduction is incorrect', { label, stockAfterDispatch, stockQuantity, quantity });
  }
  if (issueEntries !== 1) {
    fail('Shipping issue entry was not posted exactly once', { label, issueEntries });
  }
  return { productName, batchNo, customer, order, shipment, stockQuantity, quantity };
}

async function runPartialReceiptRace(managerToken, salesToken) {
  const ctx = await setupShipmentPair({ managerToken, salesToken, label: 'PARTIAL' });
  const raceResults = await Promise.all([
    createReceiptEvent(managerToken, ctx.shipment.id, {
      quantity: 6,
      acceptedQuantity: 6,
      rejectedQuantity: 0,
      fileName: `partial-race-a-${RUN_ID}.png`,
      mimeType: 'image/png',
      dataUrl: `data:image/png;base64,${PNG_1X1}`,
      note: 'partial receipt race A',
    }),
    createReceiptEvent(managerToken, ctx.shipment.id, {
      quantity: 6,
      acceptedQuantity: 6,
      rejectedQuantity: 0,
      fileName: `partial-race-b-${RUN_ID}.png`,
      mimeType: 'image/png',
      dataUrl: `data:image/png;base64,${PNG_1X1}`,
      note: 'partial receipt race B',
    }),
  ]);

  const successCount = raceResults.filter(item => item.ok).length;
  const conflictCount = raceResults.filter(item => item.status === 409).length;
  if (successCount !== 1 || conflictCount !== 1) {
    fail('Partial receipt race did not resolve as one success and one conflict', { raceResults });
  }

  const afterRaceTotals = await readReceiptTotals(ctx.shipment.id);
  const afterRaceShipment = await readShipment(ctx.shipment.id);
  if (afterRaceTotals.receiptCount !== 1 || afterRaceTotals.processedQuantity !== 6 || afterRaceTotals.acceptedQuantity !== 6) {
    fail('Partial receipt race left incorrect totals', { afterRaceTotals });
  }
  if (afterRaceShipment.status !== 'in_transit') {
    fail('Partial receipt race should leave shipment in transit', { afterRaceShipment });
  }

  const remaining = await createReceiptEvent(managerToken, ctx.shipment.id, {
    quantity: 4,
    acceptedQuantity: 3,
    rejectedQuantity: 1,
    discrepancyType: 'customer_damaged',
    discrepancyReason: 'customer reported one damaged package',
    note: 'remaining receipt with discrepancy',
  });
  if (!remaining.ok) fail(`Remaining receipt failed: ${remaining.status}`, { response: remaining.body });

  const finalTotals = await readReceiptTotals(ctx.shipment.id);
  const finalShipment = await readShipment(ctx.shipment.id);
  const discrepancyCount = await countDiscrepancyCases(ctx.shipment.id);
  const finalStock = await readStockBalance(managerToken, ctx.productName, ctx.batchNo);
  const issueEntries = await countShippingIssueEntries(ctx.shipment.shipmentNo);
  const overReceipt = await createReceiptEvent(managerToken, ctx.shipment.id, {
    quantity: 1,
    acceptedQuantity: 1,
    rejectedQuantity: 0,
  });

  if (finalShipment.status !== 'exception') fail('Final shipment should be exception after rejected quantity', { finalShipment });
  if (finalTotals.receiptCount !== 2 || finalTotals.processedQuantity !== 10 || finalTotals.acceptedQuantity !== 9 || finalTotals.rejectedQuantity !== 1) {
    fail('Final partial receipt totals are incorrect', { finalTotals });
  }
  if (discrepancyCount !== 1) fail('Final discrepancy case count is incorrect', { discrepancyCount });
  if (finalStock !== ctx.stockQuantity - ctx.quantity) fail('Final stock should not change during receipt events', { finalStock, ctx });
  if (issueEntries !== 1) fail('Shipping issue entry count drifted', { issueEntries });
  if (overReceipt.status !== 409) fail('Over receipt after full processing must be blocked', { overReceipt });

  const evidence = {
    shipmentId: String(ctx.shipment.id),
    shipmentNo: ctx.shipment.shipmentNo,
    raceResults: raceResults.map(item => ({ ok: item.ok, status: item.status, message: item.body?.message })),
    afterRaceTotals,
    finalTotals,
    finalShipment,
    discrepancyCount,
    finalStock,
    issueEntries,
    overReceiptStatus: overReceipt.status,
  };
  recordStep('partial_receipt_race', 'passed', evidence);
  return evidence;
}

async function runLegacyUploadRace(managerToken, salesToken) {
  const ctx = await setupShipmentPair({ managerToken, salesToken, label: 'LEGACY' });
  const raceResults = await Promise.all([
    createReceiptEvent(managerToken, ctx.shipment.id, {
      quantity: 4,
      acceptedQuantity: 4,
      rejectedQuantity: 0,
      note: 'partial endpoint in legacy upload race',
    }),
    uploadFullReceipt(managerToken, ctx.shipment.id, 'legacy-race'),
  ]);

  const partialResult = raceResults[0];
  const uploadResult = raceResults[1];
  if (partialResult.ok && uploadResult.ok) {
    fail('Partial receipt and legacy full upload both succeeded', { raceResults });
  }
  if (!partialResult.ok && !uploadResult.ok) {
    fail('Partial receipt and legacy full upload both failed', { raceResults });
  }

  const finalTotals = await readReceiptTotals(ctx.shipment.id);
  const finalShipment = await readShipment(ctx.shipment.id);
  const finalStock = await readStockBalance(managerToken, ctx.productName, ctx.batchNo);
  const issueEntries = await countShippingIssueEntries(ctx.shipment.shipmentNo);

  if (partialResult.ok) {
    if (uploadResult.status !== 409) fail('Legacy upload should conflict after partial receipt wins', { uploadResult });
    if (finalShipment.status !== 'in_transit') fail('Partial-wins final shipment should remain in transit', { finalShipment });
    if (finalShipment.signedReceiptUrl) fail('Partial-wins final shipment should not have legacy receipt URL', { finalShipment });
    if (finalTotals.receiptCount !== 1 || finalTotals.processedQuantity !== 4) {
      fail('Partial-wins final receipt totals are incorrect', { finalTotals });
    }
  } else if (uploadResult.ok) {
    if (partialResult.status !== 409) fail('Partial receipt should conflict after legacy upload wins', { partialResult });
    if (finalShipment.status !== 'delivered') fail('Legacy-wins final shipment should be delivered', { finalShipment });
    if (!finalShipment.signedReceiptUrl) fail('Legacy-wins final shipment should have receipt URL', { finalShipment });
    if (finalTotals.receiptCount !== 1 || finalTotals.processedQuantity !== ctx.quantity) {
      fail('Legacy-wins final receipt totals should be represented by one full receipt event', { finalTotals, ctx });
    }
  }

  if (finalStock !== ctx.stockQuantity - ctx.quantity) fail('Legacy race stock should only reflect dispatch issue', { finalStock, ctx });
  if (issueEntries !== 1) fail('Legacy race shipping issue entry count drifted', { issueEntries });

  const evidence = {
    shipmentId: String(ctx.shipment.id),
    shipmentNo: ctx.shipment.shipmentNo,
    raceResults: raceResults.map(item => ({ ok: item.ok, status: item.status, message: item.body?.message })),
    finalTotals,
    finalShipment,
    finalStock,
    issueEntries,
  };
  recordStep('partial_vs_legacy_full_receipt_race', 'passed', evidence);
  return evidence;
}

async function run() {
  try {
    const manager = await login('manager', 'manager123');
    const sales = await login('sales', 'sales123');
    recordStep('login-users', 'passed', { managerId: manager.user.id, salesId: sales.user.id });

    const partialRace = await runPartialReceiptRace(manager.token, sales.token);
    const legacyRace = await runLegacyUploadRace(manager.token, sales.token);

    report.status = 'passed';
    report.evidence = { partialRace, legacyRace };
  } catch (error) {
    report.status = 'failed';
    report.error = error?.message || String(error);
    report.details = error?.details || null;
    report.stack = error?.stack || null;
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify({
      status: report.status,
      reportPath: REPORT_PATH,
      evidence: report.evidence || null,
      error: report.error || null,
      details: report.details || null,
    }, null, 2));
  }
}

run();
