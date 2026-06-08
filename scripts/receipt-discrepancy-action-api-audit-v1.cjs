const fs = require('fs');
const path = require('path');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'receipt-discrepancy-action-api-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9qsKQAAAAASUVORK5CYII=';

const data = {
  customerName: `DCA-CUS-${RUN_ID}`,
  productName: `DCA-FG-${RUN_ID}`,
  batchNo: `DCA-FG-BATCH-${RUN_ID}`,
};

const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  data,
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

async function expectOk(label, promise) {
  const response = await promise;
  if (!response.ok) {
    throw new Error(`${label} failed: ${response.status} ${JSON.stringify(response.json)}`);
  }
  return response;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (String(actual) !== String(expected)) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

async function login(username, password) {
  const response = await expectOk(`login ${username}`, apiFetch('/auth/login', {
    method: 'POST',
    data: { username, password },
  }));
  return response.json.data;
}

async function createCustomer(token) {
  const response = await expectOk('create customer for discrepancy action', apiFetch('/customers', {
    method: 'POST',
    data: {
      nameZh: data.customerName,
      nameEn: `Customer ${RUN_ID}`,
      nameVi: `Khach hang ${RUN_ID}`,
      licenseNumber: `DCA-LIC-${RUN_ID}`,
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
        fullAddress: 'Discrepancy action customer address',
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

async function seedStock(token) {
  const location = await resolveLocation(token, 'LOC-FG');
  const response = await expectOk('seed action audit stock', apiFetch('/warehouses/stock-balances', {
    method: 'POST',
    data: {
      locationId: Number(location.id),
      productName: data.productName,
      batchNo: data.batchNo,
      quantity: 8,
      unit: 'kg',
      sourceRef: `DCA-STOCK-SEED-${RUN_ID}`,
      reason: 'receipt_discrepancy_action_seed',
      note: `discrepancy action audit ${RUN_ID}`,
    },
  }, token));
  return response.json.data;
}

async function createShipmentDiscrepancy(manager, sales) {
  const customer = await createCustomer(sales.token);
  await seedStock(manager.token);

  const orderResponse = await expectOk('create sales order for action audit', apiFetch('/orders', {
    method: 'POST',
    data: {
      customerId: Number(customer.id),
      items: [{
        productName: data.productName,
        quantity: 5,
        unit: 'kg',
        unitPrice: 88,
      }],
      paymentTerms: 30,
      notes: `discrepancy action audit ${RUN_ID}`,
    },
  }, sales.token));
  const order = orderResponse.json.data;

  await expectOk('confirm sales order for action audit', apiFetch(`/orders/${order.id}/status`, {
    method: 'PATCH',
    data: { status: 'confirmed' },
  }, manager.token));

  const shipmentResponse = await expectOk('create shipment for action audit', apiFetch('/shipping', {
    method: 'POST',
    data: {
      customerId: Number(customer.id),
      orderId: Number(order.id),
      productName: data.productName,
      quantity: 5,
      unit: 'kg',
      batchNo: data.batchNo,
      carrier: `DCA-CARRIER-${RUN_ID.slice(-4)}`,
      trackingNo: `DCA-${RUN_ID}`,
    },
  }, manager.token));
  const shipment = shipmentResponse.json.data;

  await expectOk('dispatch shipment for action audit', apiFetch(`/shipping/${shipment.id}/status`, {
    method: 'PATCH',
    data: { status: 'in_transit' },
  }, manager.token));

  const receipt = await expectOk('create shipment receipt discrepancy for action audit', apiFetch(`/shipping/${shipment.id}/receipt-events`, {
    method: 'POST',
    data: {
      quantity: 5,
      acceptedQuantity: 3,
      rejectedQuantity: 2,
      fileName: `dca-receipt-${RUN_ID}.png`,
      mimeType: 'image/png',
      dataUrl: `data:image/png;base64,${PNG_1X1}`,
      discrepancyReason: '客户签收短少，需要创建 RMA 处置动作',
      note: 'receipt discrepancy action audit',
    },
  }, manager.token));

  const discrepancyCase = receipt.json.data.discrepancyCase;
  assert(discrepancyCase?.id, 'shipment discrepancy case missing');
  return { customer, order, shipment, discrepancyCase };
}

async function run() {
  try {
    const manager = await login('manager', 'manager123');
    const sales = await login('sales', 'sales123');
    recordStep({ step: 'login-users', result: 'passed', managerId: manager.user.id, salesId: sales.user.id });

    const setup = await createShipmentDiscrepancy(manager, sales);
    recordStep({
      step: 'create-shipment-discrepancy',
      result: 'passed',
      caseId: setup.discrepancyCase.id,
      caseNo: setup.discrepancyCase.caseNo,
      shipmentId: setup.shipment.id,
    });

    const createAction = await expectOk('create customer rma discrepancy action', apiFetch(`/receipt-discrepancies/${setup.discrepancyCase.id}/actions`, {
      method: 'POST',
      data: {
        actionType: 'customer_rma',
        quantity: 2,
        unit: 'kg',
        reasonCode: 'customer_short_signed',
        dispositionCode: 'rma_review',
        note: '客户签收短少，先生成 RMA 处置动作并保持后续可追踪',
      },
    }, manager.token));
    const action = createAction.json.data;
    assertEqual(action.actionType, 'customer_rma', 'action type');
    assertEqual(action.status, 'approved', 'action status');
    assertEqual(action.targetModule, 'rma', 'action target module');
    assert(action.targetId, 'action targetId missing');
    assert(action.targetRef, 'action targetRef missing');

    const actionReadback = await expectOk('readback discrepancy actions', apiFetch(`/receipt-discrepancies/${setup.discrepancyCase.id}/actions`, {}, manager.token));
    const actions = unwrapList(actionReadback);
    const foundAction = actions.find((item) => String(item.actionNo) === String(action.actionNo));
    assert(foundAction, 'created action not found by readback');

    const duplicateActionResponse = await expectOk('retry customer rma discrepancy action idempotently', apiFetch(`/receipt-discrepancies/${setup.discrepancyCase.id}/actions`, {
      method: 'POST',
      data: {
        actionType: 'customer_rma',
        quantity: 2,
        unit: 'kg',
        reasonCode: 'customer_short_signed',
        dispositionCode: 'rma_review',
        note: '重复点击转 RMA 不应生成第二张 RMA',
      },
    }, manager.token));
    const duplicateAction = duplicateActionResponse.json.data;
    assertEqual(duplicateAction.actionNo, action.actionNo, 'duplicate actionNo must reuse existing action');
    assertEqual(duplicateAction.targetRef, action.targetRef, 'duplicate targetRef must reuse existing RMA');

    const actionsAfterDuplicate = unwrapList(await expectOk('readback actions after duplicate retry', apiFetch(`/receipt-discrepancies/${setup.discrepancyCase.id}/actions`, {}, manager.token)));
    const activeCustomerRmaActions = actionsAfterDuplicate.filter((item) => item.actionType === 'customer_rma' && item.status !== 'cancelled');
    assertEqual(activeCustomerRmaActions.length, 1, 'duplicate retry must not create a second active customer RMA action');

    const cases = await expectOk('readback discrepancy case after action', apiFetch(`/receipt-discrepancies?sourceType=shipment_receipt&sourceRef=${encodeURIComponent(setup.discrepancyCase.sourceRef)}`, {}, manager.token));
    const caseAfterAction = unwrapList(cases)[0];
    assert(caseAfterAction, 'case readback missing after action');
    assertEqual(caseAfterAction.actionRef, action.actionNo, 'case actionRef');
    assertEqual(caseAfterAction.status, 'in_review', 'case status after action');

    const rmas = await expectOk('readback target rma', apiFetch(`/rma?customerId=${setup.customer.id}&pageSize=20`, {}, manager.token));
    const foundRma = unwrapList(rmas).find((item) => String(item.rmaNo) === String(action.targetRef));
    assert(foundRma, 'target RMA not found by readback');
    assertEqual(foundRma.productName, data.productName, 'target RMA productName');

    recordStep({
      step: 'customer-rma-action-readback',
      result: 'passed',
      actionNo: action.actionNo,
      rmaNo: action.targetRef,
      caseNo: setup.discrepancyCase.caseNo,
    });
    recordStep({
      step: 'customer-rma-action-idempotency',
      result: 'passed',
      actionNo: duplicateAction.actionNo,
      rmaNo: duplicateAction.targetRef,
      activeCustomerRmaActionCount: activeCustomerRmaActions.length,
    });
    report.action = {
      actionNo: action.actionNo,
      rmaNo: action.targetRef,
      caseNo: setup.discrepancyCase.caseNo,
    };
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
    console.error(report.error || 'receipt discrepancy action api audit failed');
    process.exit(1);
  }

  console.log(`Receipt discrepancy action API audit passed. Report: ${REPORT_PATH}`);
}

run();
