/**
 * Asset and adjustment permission audit.
 * Covers inventory visibility and adjustment domain separation.
 */
const fs = require('fs');
const path = require('path');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'asset-adjustment-permission-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
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

async function login(username, password) {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    data: { username, password },
  });
  if (!response.ok) {
    throw new Error(`Login failed (${username}): ${response.status} ${JSON.stringify(response.json)}`);
  }
  return response.json.data;
}

function expectStatus(response, expected, label) {
  if (response.status !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${response.status} ${JSON.stringify(response.json)}`);
  }
}

async function run() {
  try {
    const [sales, finance, warehouse, manager] = await Promise.all([
      login('sales', 'sales123'),
      login('finance', 'finance123'),
      login('warehouse', 'warehouse123'),
      login('manager', 'manager123'),
    ]);
    recordStep({
      step: 'login-roles',
      result: 'passed',
      salesUserId: sales.user.id,
      financeUserId: finance.user.id,
      warehouseUserId: warehouse.user.id,
      managerUserId: manager.user.id,
    });

    const salesBatches = await apiFetch('/assets/batches', {}, sales.token);
    expectStatus(salesBatches, 403, 'sales inventory batches denied');
    const salesBalances = await apiFetch('/assets/balance', {}, sales.token);
    expectStatus(salesBalances, 403, 'sales asset balances denied');
    const financeBatches = await apiFetch('/assets/batches', {}, finance.token);
    if (!financeBatches.ok || !Array.isArray(financeBatches.json?.data)) {
      throw new Error(`Finance batches should be readable: ${financeBatches.status} ${JSON.stringify(financeBatches.json)}`);
    }
    recordStep({
      step: 'verify-asset-read-scope',
      result: 'passed',
      salesBatchesStatus: salesBatches.status,
      salesBalancesStatus: salesBalances.status,
      financeBatchRows: financeBatches.json.data.length,
    });

    const warehouseFinanceAdjustment = await apiFetch('/adjustments', {
      method: 'POST',
      data: {
        domain: 'finance',
        targetType: 'order',
        orderId: 1,
        amountDelta: 1,
        reason: `warehouse finance deny ${RUN_ID}`,
        status: 'pending',
      },
    }, warehouse.token);
    expectStatus(warehouseFinanceAdjustment, 403, 'warehouse finance adjustment denied');

    const financeInventoryAdjustment = await apiFetch('/adjustments', {
      method: 'POST',
      data: {
        domain: 'inventory',
        targetType: 'productBatch',
        batchId: 1,
        quantityDelta: 1,
        reason: `finance inventory deny ${RUN_ID}`,
        status: 'pending',
      },
    }, finance.token);
    expectStatus(financeInventoryAdjustment, 403, 'finance inventory adjustment denied');
    recordStep({
      step: 'verify-adjustment-domain-denials',
      result: 'passed',
      warehouseFinanceStatus: warehouseFinanceAdjustment.status,
      financeInventoryStatus: financeInventoryAdjustment.status,
    });

    const orderList = await apiFetch('/orders?pageSize=1', {}, manager.token);
    const firstOrder = Array.isArray(orderList.json?.data) ? orderList.json.data[0] : null;
    if (!orderList.ok || !firstOrder?.id) {
      throw new Error(`Cannot locate an order for pending finance adjustment audit: ${orderList.status}`);
    }

    const financePendingAdjustment = await apiFetch('/adjustments', {
      method: 'POST',
      data: {
        domain: 'finance',
        targetType: 'order',
        orderId: Number(firstOrder.id),
        amountDelta: 1,
        reason: `finance pending audit ${RUN_ID}`,
        status: 'pending',
      },
    }, finance.token);
    if (!financePendingAdjustment.ok || !financePendingAdjustment.json?.data?.adjustment?.id) {
      throw new Error(`Finance pending adjustment should be created: ${financePendingAdjustment.status} ${JSON.stringify(financePendingAdjustment.json)}`);
    }

    const adjustmentId = financePendingAdjustment.json.data.adjustment.id;
    const warehouseApplyFinance = await apiFetch(`/adjustments/${adjustmentId}/apply`, {
      method: 'POST',
      data: {},
    }, warehouse.token);
    expectStatus(warehouseApplyFinance, 403, 'warehouse apply finance adjustment denied');
    recordStep({
      step: 'verify-adjustment-apply-domain-scope',
      result: 'passed',
      financePendingAdjustmentId: adjustmentId,
      warehouseApplyStatus: warehouseApplyFinance.status,
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
    console.error(report.error || 'Asset/adjustment permission audit failed');
    process.exit(1);
  }

  console.log(`Asset/adjustment permission audit passed. Report: ${REPORT_PATH}`);
}

run();
