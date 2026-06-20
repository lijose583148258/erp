const path = require('path');
const { createBackendBusinessChainContext } = require('./lib/backend-business-chain-audit-utils.cjs');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'backend-business-chain-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const REQUEST_TIMEOUT_MS = 20_000;
const SCRIPT_TIMEOUT_MS = 290_000;

const DATA = {
  supplierName: `CHAIN-SUP-${RUN_ID}`,
  customerName: `CHAIN-CUS-${RUN_ID}`,
  orderProduct: `CHAIN-FG-${RUN_ID}`,
  rawItem: `CHAIN-RAW-${RUN_ID}`,
  fgBatchNo: `CHAIN-FG-BATCH-${RUN_ID}`,
  rawBatchNo: `CHAIN-RAW-BATCH-${RUN_ID}`,
  procurementQuantity: 10,
  procurementAcceptedQuantity: 8,
  procurementRejectedQuantity: 2,
  orderQuantity: 4,
  orderUnitPrice: 250,
  paymentMethod: 'cash',
};

const {
  apiFetch,
  approvePurchaseOrder,
  confirmSalesOrder,
  createCustomer,
  createPurchaseOrder,
  createPurchaseReceipt,
  createSalesOrder,
  createShipment,
  createShipmentReceiptEvent,
  createSupplier,
  expectOk,
  fail,
  getWarehouses,
  login,
  readDiscrepancyCases,
  readOrderDetail,
  readPurchaseReceipts,
  readShipmentReceipts,
  readStockBalance,
  readStockEntries,
  recordPayment,
  recordStep,
  report,
  saveReport,
  seedFinishedGoodsStock,
  setShipmentInTransit,
  summarizeError,
  unwrapList,
  verifyPayment,
} = createBackendBusinessChainContext({
  appUrl: APP_URL,
  outputDir: OUTPUT_DIR,
  reportPath: REPORT_PATH,
  runId: RUN_ID,
  data: DATA,
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
});

let overallTimer = null;

async function run() {
  const checkpoints = {};
  try {
    const health = await apiFetch('/health', {});
    if (!health.ok) {
      throw new Error(`health check failed: ${health.status} ${JSON.stringify(health.json)}`);
    }
    recordStep({ step: 'health-check', result: 'passed', status: health.status });

    const [manager, sales, finance, warehouse] = await Promise.all([
      login('manager', 'manager123'),
      login('sales', 'sales123'),
      login('finance', 'finance123'),
      login('warehouse', 'warehouse123'),
    ]);
    recordStep({
      step: 'login-users',
      result: 'passed',
      managerId: manager.user.id,
      salesId: sales.user.id,
      financeId: finance.user.id,
      warehouseId: warehouse.user.id,
    });

    const { rawLocation, fgLocation } = await getWarehouses(warehouse.token);
    checkpoints.warehouse = {
      rawLocationId: Number(rawLocation.id),
      fgLocationId: Number(fgLocation.id),
    };
    recordStep({
      step: 'resolve-warehouse-locations',
      result: 'passed',
      rawLocationCode: rawLocation.code,
      fgLocationCode: fgLocation.code,
    });

    const supplier = await createSupplier(manager);
    checkpoints.supplier = {
      id: Number(supplier.id),
      name: supplier.name || supplier.nameZh || DATA.supplierName,
    };
    recordStep({ step: 'create-supplier', result: 'passed', supplierId: supplier.id });

    const supplierList = await expectOk('read supplier list', () => apiFetch(`/procurement/suppliers?search=${encodeURIComponent(DATA.supplierName)}`, {}, manager.token));
    const matchedSupplier = unwrapList(supplierList).find((item) => String(item.id) === String(supplier.id));
    if (!matchedSupplier) throw new Error('supplier readback did not include the created supplier');
    recordStep({ step: 'read-supplier-list-back', result: 'passed', supplierId: supplier.id });

    const customer = await createCustomer(sales);
    checkpoints.customer = {
      id: Number(customer.id),
      name: customer.name || customer.nameZh || DATA.customerName,
    };
    recordStep({ step: 'create-customer', result: 'passed', customerId: customer.id });

    const customerList = await expectOk('read customer list', () => apiFetch(`/customers?search=${encodeURIComponent(DATA.customerName)}`, {}, sales.token));
    const matchedCustomer = unwrapList(customerList).find((item) => String(item.id) === String(customer.id));
    if (!matchedCustomer) throw new Error('customer readback did not include the created customer');
    recordStep({ step: 'read-customer-list-back', result: 'passed', customerId: customer.id });

    const salesOrder = await createSalesOrder(sales, customer.id);
    checkpoints.salesOrder = {
      id: Number(salesOrder.id),
      orderNo: salesOrder.orderNo,
      finalAmount: Number(salesOrder.finalAmount),
    };
    recordStep({
      step: 'create-sales-order',
      result: 'passed',
      orderId: salesOrder.id,
      orderNo: salesOrder.orderNo,
      finalAmount: salesOrder.finalAmount,
    });

    const confirmedOrder = await confirmSalesOrder(manager, salesOrder.id);
    if (String(confirmedOrder.status) !== 'confirmed') throw new Error(`expected confirmed order status, got ${confirmedOrder.status}`);
    recordStep({ step: 'confirm-sales-order', result: 'passed', orderId: salesOrder.id, status: confirmedOrder.status });

    const paymentSubmitted = await recordPayment(sales, salesOrder.id, Number(salesOrder.finalAmount));
    checkpoints.salesPaymentOrder = {
      id: Number(paymentSubmitted.id),
      paymentStatus: paymentSubmitted.paymentStatus,
      paidAmount: Number(paymentSubmitted.paidAmount),
    };
    recordStep({
      step: 'record-payment',
      result: 'passed',
      orderId: paymentSubmitted.id,
      paymentStatus: paymentSubmitted.paymentStatus,
      paidAmount: paymentSubmitted.paidAmount,
    });

    const orderAfterPayment = await readOrderDetail(sales.token, salesOrder.id);
    const paymentRecords = Array.isArray(orderAfterPayment.paymentRecords) ? orderAfterPayment.paymentRecords : [];
    const pendingPayment = paymentRecords.find((item) => String(item.status) === 'pending') || paymentRecords[0];
    if (!pendingPayment?.id) throw new Error('payment record id not found in order detail after payment submission');
    recordStep({
      step: 'read-payment-record-from-order',
      result: 'passed',
      paymentRecordId: pendingPayment.id,
      paymentRecords: paymentRecords.length,
    });

    const verifiedOrder = await verifyPayment(finance, salesOrder.id, pendingPayment.id);
    if (String(verifiedOrder.paymentStatus) !== 'paid') {
      throw new Error(`expected paid order after verification, got ${verifiedOrder.paymentStatus}`);
    }
    recordStep({
      step: 'verify-payment',
      result: 'passed',
      orderId: verifiedOrder.id,
      paymentStatus: verifiedOrder.paymentStatus,
      paidAmount: verifiedOrder.paidAmount,
    });

    const procurementOrder = await createPurchaseOrder(manager, supplier.id, salesOrder.id);
    checkpoints.procurementOrder = {
      id: Number(procurementOrder.id),
      orderNo: procurementOrder.orderNo,
    };
    recordStep({
      step: 'create-purchase-order',
      result: 'passed',
      purchaseOrderId: procurementOrder.id,
      purchaseOrderNo: procurementOrder.orderNo,
    });

    const approvedPurchaseOrder = await approvePurchaseOrder(manager, procurementOrder.id);
    if (String(approvedPurchaseOrder.status) !== 'approved') throw new Error(`expected approved purchase order, got ${approvedPurchaseOrder.status}`);
    recordStep({
      step: 'approve-purchase-order',
      result: 'passed',
      purchaseOrderId: procurementOrder.id,
      status: approvedPurchaseOrder.status,
    });

    const purchaseReceipt = await createPurchaseReceipt(manager, procurementOrder.id);
    checkpoints.purchaseReceipt = {
      receiptNo: purchaseReceipt.receiptNo,
      sourceRef: `PO-${procurementOrder.id}-RCV-${purchaseReceipt.receiptNo}`,
      acceptedQuantity: Number(purchaseReceipt.receiptSummary?.acceptedQuantity || 0),
      rejectedQuantity: Number(purchaseReceipt.receiptSummary?.rejectedQuantity || 0),
    };
    recordStep({
      step: 'create-purchase-receipt',
      result: 'passed',
      receiptNo: purchaseReceipt.receiptNo,
      acceptedQuantity: purchaseReceipt.receiptSummary?.acceptedQuantity,
      rejectedQuantity: purchaseReceipt.receiptSummary?.rejectedQuantity,
      receiptCount: purchaseReceipt.receiptSummary?.receiptCount,
    });

    const purchaseReceiptBack = await readPurchaseReceipts(manager, procurementOrder.id);
    const purchaseReceiptMatch = purchaseReceiptBack.receipts.find((item) => String(item.receiptNo) === String(purchaseReceipt.receiptNo));
    if (!purchaseReceiptMatch) throw new Error('purchase receipt readback did not include the created receipt');
    recordStep({
      step: 'read-purchase-receipt-back',
      result: 'passed',
      receiptCount: purchaseReceiptBack.receipts.length,
      discrepancyCaseCount: Array.isArray(purchaseReceiptBack.discrepancyCases) ? purchaseReceiptBack.discrepancyCases.length : 0,
    });

    const purchaseDiscrepancies = await readDiscrepancyCases(manager.token, {
      relatedModule: 'procurement',
      relatedId: String(procurementOrder.id),
      page: '1',
      pageSize: '100',
    });
    if (purchaseDiscrepancies.length === 0) {
      throw new Error('procurement discrepancy case was not created for rejected receipt');
    }
    recordStep({
      step: 'read-procurement-discrepancy-cases',
      result: 'passed',
      caseCount: purchaseDiscrepancies.length,
      caseNo: purchaseDiscrepancies[0]?.caseNo || null,
    });

    const rawStockRows = await readStockBalance(manager.token, DATA.rawItem, DATA.rawBatchNo, 'LOC-RAW');
    if (rawStockRows.length === 0) throw new Error('raw stock balance readback missing after procurement receipt');
    const rawQuantity = rawStockRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    if (Math.abs(rawQuantity - DATA.procurementAcceptedQuantity) > 0.000001) {
      throw new Error(`raw stock balance mismatch: expected ${DATA.procurementAcceptedQuantity}, got ${rawQuantity}`);
    }
    recordStep({
      step: 'verify-raw-stock-balance',
      result: 'passed',
      quantity: rawQuantity,
      locationCode: 'LOC-RAW',
    });

    const procurementEntries = await readStockEntries(manager.token, 'procurement_receipt', checkpoints.purchaseReceipt.sourceRef);
    if (procurementEntries.length === 0) throw new Error('procurement stock entry not found for sourceRef');
    recordStep({
      step: 'verify-procurement-stock-entry',
      result: 'passed',
      entryCount: procurementEntries.length,
      sourceRef: checkpoints.purchaseReceipt.sourceRef,
    });

    const fgSeed = await seedFinishedGoodsStock(warehouse, fgLocation.id, 20);
    checkpoints.fgSeed = {
      id: Number(fgSeed.id),
      productName: DATA.orderProduct,
      batchNo: DATA.fgBatchNo,
      quantity: 20,
    };
    recordStep({
      step: 'seed-finished-goods-stock',
      result: 'passed',
      balanceId: fgSeed.id,
      quantity: 20,
      locationCode: 'LOC-FG',
    });

    const shipment = await createShipment(warehouse, customer.id, salesOrder.id);
    checkpoints.shipment = {
      id: Number(shipment.id),
      shipmentNo: shipment.shipmentNo,
    };
    recordStep({
      step: 'create-shipment',
      result: 'passed',
      shipmentId: shipment.id,
      shipmentNo: shipment.shipmentNo,
    });

    const shipmentInTransit = await setShipmentInTransit(warehouse, shipment.id);
    if (String(shipmentInTransit.status) !== 'in_transit') throw new Error(`expected shipment in_transit, got ${shipmentInTransit.status}`);
    recordStep({
      step: 'set-shipment-in-transit',
      result: 'passed',
      shipmentId: shipment.id,
      status: shipmentInTransit.status,
    });

    const fgRowsAfterIssue = await readStockBalance(manager.token, DATA.orderProduct, DATA.fgBatchNo, 'LOC-FG');
    const fgQuantityAfterIssue = fgRowsAfterIssue.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    if (Math.abs(fgQuantityAfterIssue - (20 - DATA.orderQuantity)) > 0.000001) {
      throw new Error(`finished goods balance mismatch after issue: expected ${20 - DATA.orderQuantity}, got ${fgQuantityAfterIssue}`);
    }
    recordStep({
      step: 'verify-shipment-stock-issue',
      result: 'passed',
      locationCode: 'LOC-FG',
      quantity: fgQuantityAfterIssue,
    });

    const shipmentEntries = await readStockEntries(manager.token, 'shipping_issue', checkpoints.shipment.shipmentNo);
    if (shipmentEntries.length === 0) throw new Error('shipping stock issue entry not found after dispatch');
    recordStep({
      step: 'verify-shipping-stock-entry',
      result: 'passed',
      entryCount: shipmentEntries.length,
      sourceRef: checkpoints.shipment.shipmentNo,
    });

    const shipmentReceipt = await createShipmentReceiptEvent(warehouse, shipment.id);
    if (!shipmentReceipt.discrepancyCase && (!Array.isArray(shipmentReceipt.discrepancyCases) || shipmentReceipt.discrepancyCases.length === 0)) {
      throw new Error('shipment receipt event did not create or return a discrepancy case');
    }
    recordStep({
      step: 'create-shipment-receipt-event',
      result: 'passed',
      receiptCount: Array.isArray(shipmentReceipt.receipts) ? shipmentReceipt.receipts.length : 0,
      discrepancyCaseCount: Array.isArray(shipmentReceipt.discrepancyCases) ? shipmentReceipt.discrepancyCases.length : 0,
      shipmentStatus: shipmentReceipt.shipment?.status || null,
    });

    const shipmentReceiptBack = await readShipmentReceipts(warehouse, shipment.id);
    if (!Array.isArray(shipmentReceiptBack.receipts) || shipmentReceiptBack.receipts.length === 0) {
      throw new Error('shipment receipt readback returned empty receipts');
    }
    recordStep({
      step: 'read-shipment-receipt-back',
      result: 'passed',
      receiptCount: shipmentReceiptBack.receipts.length,
      discrepancyCaseCount: Array.isArray(shipmentReceiptBack.discrepancyCases) ? shipmentReceiptBack.discrepancyCases.length : 0,
      shipmentStatus: shipmentReceiptBack.shipment.status,
    });

    const shippingDiscrepancies = await readDiscrepancyCases(warehouse.token, {
      relatedModule: 'shipping',
      relatedId: String(shipment.id),
      page: '1',
      pageSize: '100',
    });
    if (shippingDiscrepancies.length === 0) {
      throw new Error('shipping discrepancy case was not created by receipt event');
    }
    recordStep({
      step: 'read-shipping-discrepancy-cases',
      result: 'passed',
      caseCount: shippingDiscrepancies.length,
      caseNo: shippingDiscrepancies[0]?.caseNo || null,
    });

    const orderAfterShipment = await readOrderDetail(sales.token, salesOrder.id);
    checkpoints.orderAfterShipment = {
      status: orderAfterShipment.status,
      paymentStatus: orderAfterShipment.paymentStatus,
      paidAmount: Number(orderAfterShipment.paidAmount),
    };
    if (!['shipped', 'delivered', 'completed'].includes(String(orderAfterShipment.status))) {
      throw new Error(`unexpected order status after shipping flow: ${orderAfterShipment.status}`);
    }
    recordStep({
      step: 'verify-order-after-shipment',
      result: 'passed',
      orderStatus: orderAfterShipment.status,
      paymentStatus: orderAfterShipment.paymentStatus,
      paidAmount: orderAfterShipment.paidAmount,
    });

    report.checkpoints = checkpoints;
    report.status = 'passed';
    recordStep({ step: 'business-chain-complete', result: 'passed' });
  } catch (error) {
    fail('backend-business-chain-audit', error, { lastStep: report.steps.at(-1) || null });
    recordStep({
      step: 'business-chain-failed',
      result: 'failed',
      error: summarizeError(error),
    });
    throw error;
  } finally {
    clearTimeout(overallTimer);
    await saveReport();
  }
}

async function main() {
  overallTimer = setTimeout(() => {
    const timeoutError = new Error(`Script timeout after ${SCRIPT_TIMEOUT_MS}ms`);
    timeoutError.code = 'SCRIPT_TIMEOUT';
    fail('script-timeout', timeoutError, { lastStep: report.steps.at(-1) || null });
    saveReport()
      .catch(() => {})
      .finally(() => process.exit(1));
  }, SCRIPT_TIMEOUT_MS);

  try {
    await run();
    process.exit(0);
  } catch {
    process.exit(1);
  }
}

main().catch(async (error) => {
  fail('unhandled', error);
  await saveReport().catch(() => {});
  process.exit(1);
});
