/**
 * Procurement partial receipt concurrency audit.
 *
 * Proves that two operators cannot over-receive the same purchase order by
 * submitting partial receipts against the same remaining quantity at once.
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('../backend/node_modules/@prisma/client');
const {
  createProcurementApiAuditSupport,
  createProcurementAuditData,
} = require('./lib/procurement-api-audit-support.cjs');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'file:D:/AilaoDaRuntime/stable.db';

const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'procurement-partial-receipt-concurrency-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const prisma = new PrismaClient();
const DATA = createProcurementAuditData(RUN_ID);

const report = {
  name: 'procurement-partial-receipt-concurrency-audit-v1',
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

const {
  apiFetch,
  unwrapList,
  expectedLandedCost,
  procurementCostPayload,
  login,
} = createProcurementApiAuditSupport({
  appUrl: APP_URL,
  data: DATA,
  runId: RUN_ID,
  prisma,
});

async function createSupplier(token) {
  const response = await apiFetch('/procurement/suppliers', {
    method: 'POST',
    data: {
      name: `PARTIAL-SUP-${RUN_ID}`,
      nameZh: `分批收货供应商-${RUN_ID}`,
      nameEn: `Partial Supplier ${RUN_ID}`,
      category: 'Raw Materials',
      contactPerson: `Partial Buyer ${RUN_ID.slice(-4)}`,
      phone: `09${RUN_ID.slice(-8)}`,
      email: `partial-${RUN_ID}@example.com`,
      addresses: [{
        label: '注册地址',
        countryCode: 'VN',
        city: 'Hanoi',
        fullAddress: 'Partial receipt audit address',
      }],
    },
  }, token);
  if (!response.ok) {
    fail(`Create supplier failed: ${response.status}`, { response: response.json });
  }
  const supplier = response.json?.data;
  if (!supplier?.id) fail('Create supplier returned empty id', { response: response.json });
  return supplier;
}

async function createPurchaseOrder(token, supplierId) {
  const item = `PARTIAL-PO-ITEM-${RUN_ID}`;
  const response = await apiFetch('/procurement/orders', {
    method: 'POST',
    data: {
      supplierId: Number(supplierId),
      item,
      quantity: 10,
      unit: 'kg',
      ...procurementCostPayload(),
      eta: '2026-05-20',
    },
  }, token);
  if (!response.ok) {
    fail(`Create purchase order failed: ${response.status}`, { response: response.json });
  }
  const order = response.json?.data;
  if (!order?.id) fail('Create purchase order returned empty id', { response: response.json });
  return { ...order, item };
}

async function patchStatus(token, orderId, status) {
  const response = await apiFetch(`/procurement/orders/${orderId}/status`, {
    method: 'PATCH',
    data: { status },
  }, token);
  if (!response.ok) {
    fail(`Patch purchase order status failed: ${status} -> ${response.status}`, { response: response.json });
  }
  return response.json?.data;
}

async function createReceipt(token, orderId, payload) {
  const response = await apiFetch(`/procurement/orders/${orderId}/receipts`, {
    method: 'POST',
    data: payload,
  }, token);
  return {
    ok: response.ok,
    status: response.status,
    body: response.json,
  };
}

async function readReceiptTotals(orderId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS receiptCount,
            COALESCE(SUM(quantity), 0) AS processedQuantity,
            COALESCE(SUM(accepted_quantity), 0) AS acceptedQuantity,
            COALESCE(SUM(rejected_quantity), 0) AS rejectedQuantity
       FROM purchase_receipts
      WHERE purchase_order_id = ?`,
    Number(orderId),
  );
  const row = rows[0] || {};
  return {
    receiptCount: Number(row.receiptCount || 0),
    processedQuantity: Number(row.processedQuantity || 0),
    acceptedQuantity: Number(row.acceptedQuantity || 0),
    rejectedQuantity: Number(row.rejectedQuantity || 0),
  };
}

async function readStockEvidence(orderId, productName) {
  const sourceLike = `PO-${orderId}-RCV-%`;
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(DISTINCT e.id) AS entryCount,
            COALESCE(SUM(m.quantity_delta), 0) AS totalQuantity
       FROM stock_entries e
       JOIN stock_movements m ON m.entry_id = e.id
      WHERE e.source_type = 'procurement_receipt'
        AND e.source_ref LIKE ?
        AND m.product_name = ?`,
    sourceLike,
    productName,
  );
  const row = rows[0] || {};
  return {
    sourceLike,
    entryCount: Number(row.entryCount || 0),
    totalQuantity: Number(row.totalQuantity || 0),
  };
}

async function readCostEvidence(productName) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COALESCE(SUM(l.quantity_delta), 0) AS quantityDelta,
            COALESCE(SUM(l.cost_amount_delta), 0) AS costAmountDelta,
            COUNT(*) AS ledgerCount
       FROM inventory_cost_ledgers l
       JOIN product_batches b ON b.id = l.batch_id
      WHERE b.product_name = ?
        AND b.batch_no IN (?, ?)`,
    productName,
    `PARTIAL-A-${RUN_ID}`,
    `PARTIAL-C-${RUN_ID}`,
  );
  const row = rows[0] || {};
  return {
    ledgerCount: Number(row.ledgerCount || 0),
    quantityDelta: Number(row.quantityDelta || 0),
    costAmountDelta: Number(row.costAmountDelta || 0),
  };
}

async function readOrderStatus(token, orderId) {
  const response = await apiFetch('/procurement/orders?pageSize=100', {}, token);
  if (!response.ok) fail(`Read purchase order list failed: ${response.status}`, { response: response.json });
  const order = unwrapList(response).find(item => String(item.id) === String(orderId));
  if (!order) fail('Purchase order not found in list readback', { orderId });
  return String(order.status);
}

async function run() {
  try {
    const manager = await login('manager', 'manager123');
    recordStep('login-manager', 'passed', { userId: manager.user.id });

    const supplier = await createSupplier(manager.token);
    recordStep('create-supplier', 'passed', { supplierId: supplier.id });

    const order = await createPurchaseOrder(manager.token, supplier.id);
    recordStep('create-purchase-order', 'passed', { purchaseOrderId: order.id, item: order.item, quantity: 10 });

    await patchStatus(manager.token, order.id, 'approved');
    await patchStatus(manager.token, order.id, 'in_transit');
    recordStep('approve-and-dispatch', 'passed', { purchaseOrderId: order.id });

    const raceResults = await Promise.all([
      createReceipt(manager.token, order.id, {
        quantity: 6,
        acceptedQuantity: 6,
        rejectedQuantity: 0,
        batchNo: `PARTIAL-A-${RUN_ID}`,
        note: 'partial receipt race A',
      }),
      createReceipt(manager.token, order.id, {
        quantity: 6,
        acceptedQuantity: 6,
        rejectedQuantity: 0,
        batchNo: `PARTIAL-B-${RUN_ID}`,
        note: 'partial receipt race B',
      }),
    ]);
    const raceSuccessCount = raceResults.filter(item => item.ok).length;
    const raceConflictCount = raceResults.filter(item => item.status === 409).length;
    if (raceSuccessCount !== 1 || raceConflictCount !== 1) {
      fail('Concurrent partial receipts did not resolve as one success and one conflict', { raceResults });
    }

    const afterRaceTotals = await readReceiptTotals(order.id);
    const afterRaceStock = await readStockEvidence(order.id, order.item);
    if (afterRaceTotals.receiptCount !== 1 || afterRaceTotals.processedQuantity !== 6 || afterRaceTotals.acceptedQuantity !== 6) {
      fail('Concurrent partial receipt left incorrect receipt totals', { afterRaceTotals });
    }
    if (afterRaceStock.entryCount !== 1 || afterRaceStock.totalQuantity !== 6) {
      fail('Concurrent partial receipt left incorrect stock entries', { afterRaceStock });
    }
    recordStep('concurrent-partial-receipt-race', 'passed', {
      results: raceResults.map(item => ({ ok: item.ok, status: item.status, message: item.body?.message })),
      totals: afterRaceTotals,
      stock: afterRaceStock,
    });

    const remainingReceipt = await createReceipt(manager.token, order.id, {
      quantity: 4,
      acceptedQuantity: 4,
      rejectedQuantity: 0,
      batchNo: `PARTIAL-C-${RUN_ID}`,
      note: 'partial receipt remaining quantity',
    });
    if (!remainingReceipt.ok) {
      fail(`Remaining partial receipt failed: ${remainingReceipt.status}`, { response: remainingReceipt.body });
    }

    const finalTotals = await readReceiptTotals(order.id);
    const finalStock = await readStockEvidence(order.id, order.item);
    const finalStatus = await readOrderStatus(manager.token, order.id);
    const expectedCost = expectedLandedCost(10);
    const costEvidence = await readCostEvidence(order.item);

    if (finalStatus !== 'received') fail('Final purchase order status is not received', { finalStatus });
    if (finalTotals.receiptCount !== 2 || finalTotals.processedQuantity !== 10 || finalTotals.acceptedQuantity !== 10) {
      fail('Final partial receipt totals are incorrect', { finalTotals });
    }
    if (finalStock.entryCount !== 2 || finalStock.totalQuantity !== 10) {
      fail('Final partial receipt stock evidence is incorrect', { finalStock });
    }
    if (
      costEvidence.ledgerCount !== 2
      || Math.abs(costEvidence.quantityDelta - 10) > 0.000001
      || Math.abs(costEvidence.costAmountDelta - expectedCost.landedCostAmount) > 0.01
    ) {
      fail('Final partial receipt cost ledger is incorrect', { costEvidence, expectedCost });
    }

    recordStep('remaining-partial-receipt-completes-order', 'passed', {
      finalStatus,
      finalTotals,
      finalStock,
      costEvidence,
      expectedCost,
    });

    report.status = 'passed';
    report.evidence = {
      purchaseOrderId: String(order.id),
      item: order.item,
      raceResults: raceResults.map(item => ({ ok: item.ok, status: item.status, message: item.body?.message })),
      afterRaceTotals,
      finalTotals,
      finalStatus,
      finalStock,
      costEvidence,
    };
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
