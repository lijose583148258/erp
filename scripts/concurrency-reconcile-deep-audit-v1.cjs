const fs = require('fs');
const path = require('path');
const {
  createConcurrencyApiClient,
  createConcurrencyAuditData,
  isSuccessStatus,
  makeReceiptPngDataUrl,
  summarizeStatuses,
} = require('./lib/concurrency-reconcile-audit-utils.cjs');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5001/';
const API_BASE = `${APP_URL.replace(/\/$/, '')}/api`;
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'concurrency-reconcile-deep-audit-report-v1.json');
const RUN_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const BUDGET_MS = 5 * 60 * 1000;
const DATA = createConcurrencyAuditData(RUN_ID);
const {
  apiFetch,
  login,
  createCustomer,
  createOrder,
  getOrder,
  listShipments,
  createShipment,
  seedStock,
  readStockBalance,
  countStockEntries,
  createBarterAgreement,
  createBarterBatch,
  approveBarterSettlement,
  postBarterSettlement,
  getBarterSettlement,
  uploadReceipt,
} = createConcurrencyApiClient({ apiBase: API_BASE, runId: RUN_ID });

const report = {
  appUrl: APP_URL,
  startedAt: new Date().toISOString(),
  runId: RUN_ID,
  budgetMs: BUDGET_MS,
  status: 'running',
  steps: [],
  findings: [],
  summary: {},
};

function recordStep(entry) {
  report.steps.push({ at: new Date().toISOString(), ...entry });
}

function addFinding(finding) {
  report.findings.push({ at: new Date().toISOString(), ...finding });
}

async function withTimeout(name, timeoutMs, action) {
  const started = Date.now();
  let timer;
  try {
    const result = await Promise.race([
      Promise.resolve().then(action),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${name} exceeded ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    recordStep({ step: name, result: 'passed', durationMs: Date.now() - started, timeoutMs });
    return result;
  } catch (error) {
    recordStep({
      step: name,
      result: 'failed',
      durationMs: Date.now() - started,
      timeoutMs,
      error: String(error.message || error),
    });
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function auditOrderDuplicatePayments(tokens) {
  const customer = await createCustomer(tokens.sales.token, {
    nameZh: DATA.order.customerName,
    nameEn: `Concurrency Order Customer ${RUN_ID}`,
    nameVi: `Khach don hang ${RUN_ID}`,
    licenseNumber: `CONC-ORD-LIC-${RUN_ID}`,
    creditLimit: 999999,
    riskLevel: 'low',
    segment: 'direct',
    poolState: 'private',
    salespersonId: Number(tokens.sales.user.id),
    contactName: 'Order Concurrency Contact',
    contactPhone: `09${RUN_ID.slice(-8)}`,
    contactEmail: `conc-order-${RUN_ID}@example.com`,
    addresses: [{
      type: 'legal',
      label: 'registered',
      countryCode: 'VN',
      fullAddress: `Order concurrency address ${RUN_ID}`,
      isPrimary: true,
    }],
  });

  const order = await createOrder(tokens.sales.token, {
    customerId: Number(customer.id),
    items: [{
      productName: DATA.order.productName,
      specification: 'CONC-AUDIT',
      quantity: 3,
      unit: 'kg',
      unitPrice: 100,
    }],
    paymentTerms: 30,
    notes: `concurrency-audit ${RUN_ID}`,
  });

  const paymentPayload = {
    amount: DATA.order.amount,
    method: 'bank',
    payerName: `Payer ${RUN_ID}`,
    note: DATA.order.note,
    isProxy: false,
  };

  const submitResults = await withTimeout('order-concurrent-payment-submit', 20000, async () => Promise.all([
    apiFetch(`/orders/${order.id}/payment`, { method: 'POST', data: paymentPayload }, tokens.finance.token),
    apiFetch(`/orders/${order.id}/payment`, { method: 'POST', data: paymentPayload }, tokens.finance.token),
  ]));

  const orderAfterSubmit = await withTimeout('order-payment-submit-readback', 15000, async () => getOrder(tokens.manager.token, order.id));
  const paymentRecords = Array.isArray(orderAfterSubmit.paymentRecords) ? orderAfterSubmit.paymentRecords : [];
  const matchingPayments = paymentRecords.filter((record) => String(record.note || '') === DATA.order.note);
  const paymentStatuses = summarizeStatuses(submitResults);
  if (matchingPayments.length === 0) {
    throw new Error('duplicate payment submit created no visible payment records');
  }

  const verifyResults = await withTimeout('order-concurrent-payment-verify', 20000, async () => Promise.all(
    matchingPayments.map((record) => apiFetch(`/orders/${order.id}/payment/${record.id}/verify`, {
      method: 'POST',
    }, tokens.finance.token)),
  ));

  const verifyStatuses = summarizeStatuses(verifyResults);
  const orderAfterVerify = await withTimeout('order-payment-verify-readback', 15000, async () => getOrder(tokens.manager.token, order.id));
  const paidAmount = Number(orderAfterVerify.paidAmount || 0);
  const duplicated = submitResults.every((item) => isSuccessStatus(item.status)) && matchingPayments.length > 1;
  const drift = Math.abs(paidAmount - (DATA.order.amount * matchingPayments.length));

  const finding = {
    scenario: 'order_duplicate_payment_submit',
    orderId: String(order.id),
    submitStatuses: paymentStatuses,
    verifyStatuses,
    matchingPaymentCount: matchingPayments.length,
    paidAmount,
    expectedPaidAmount: DATA.order.amount * matchingPayments.length,
    paymentStatus: orderAfterVerify.paymentStatus,
    drift,
    status: 'clean',
    evidence: {
      readbackOrderNo: orderAfterVerify.orderNo,
      paymentRecordIds: matchingPayments.map((item) => item.id),
    },
  };

  if (duplicated || drift > 0.01 || matchingPayments.length > 1) {
    finding.status = 'finding';
    finding.message = duplicated
      ? 'duplicate payment submit was accepted more than once'
      : 'payment readback drift or duplicated records detected';
    addFinding(finding);
  }

  recordStep({
    step: 'order-duplicate-payment-submit',
    result: finding.status,
    submitStatuses: paymentStatuses,
    verifyStatuses,
    matchingPaymentCount: matchingPayments.length,
    paidAmount,
    paymentStatus: orderAfterVerify.paymentStatus,
  });
}

async function auditBarterSplitBatchAndPost(tokens) {
  const customer = await createCustomer(tokens.manager.token, {
    nameZh: DATA.barter.customerName,
    nameEn: `Concurrency Barter Customer ${RUN_ID}`,
    nameVi: `Khach doi hang ${RUN_ID}`,
    licenseNumber: `CONC-BARTER-LIC-${RUN_ID}`,
    creditLimit: 888888,
    riskLevel: 'low',
    segment: 'direct',
    poolState: 'private',
    salespersonId: Number(tokens.sales.user.id),
    contactName: 'Barter Concurrency Contact',
    contactPhone: `08${RUN_ID.slice(-8)}`,
    contactEmail: `conc-barter-${RUN_ID}@example.com`,
  });

  const agreement = await createBarterAgreement(tokens.manager.token, {
    counterpartyType: 'customer',
    counterpartyName: DATA.barter.counterpartyName,
    customerId: Number(customer.id),
    settlementMode: 'mixed',
    currency: 'CNY',
    agreementDate: new Date().toISOString(),
    valuationDate: new Date().toISOString(),
    note: `barter-concurrency ${RUN_ID}`,
    items: [
      {
        side: 'our',
        itemName: DATA.barter.ourItemName,
        unit: 'kg',
        quantity: 10,
        unitPrice: 80,
        valuationMethod: 'market',
        sourceDocument: `OUR-${RUN_ID}`,
      },
      {
        side: 'counterparty',
        itemName: DATA.barter.counterpartyItemName,
        unit: 'kg',
        quantity: 8,
        unitPrice: 80,
        valuationMethod: 'market',
        sourceDocument: `CP-${RUN_ID}`,
      },
    ],
  });

  const batchPayload = {
    note: DATA.barter.note,
    valuationDate: new Date().toISOString(),
    items: [
      {
        side: 'our',
        itemName: `${DATA.barter.ourItemName}-BATCH`,
        unit: 'kg',
        quantity: 5,
        unitPrice: 80,
        valuationMethod: 'market',
        sourceDocument: `OUR-BATCH-${RUN_ID}`,
      },
      {
        side: 'counterparty',
        itemName: `${DATA.barter.counterpartyItemName}-BATCH`,
        unit: 'kg',
        quantity: 5,
        unitPrice: 80,
        valuationMethod: 'market',
        sourceDocument: `CP-BATCH-${RUN_ID}`,
      },
    ],
  };

  const batchResults = await withTimeout('barter-concurrent-batch-create', 25000, async () => Promise.all([
    createBarterBatch(tokens.manager.token, agreement.id, batchPayload),
    createBarterBatch(tokens.manager.token, agreement.id, batchPayload),
  ]));

  const batchStatuses = summarizeStatuses(batchResults);
  const successfulBatches = batchResults.filter((item) => isSuccessStatus(item.status));
  const createdSettlements = successfulBatches.map((item) => item.json?.data).filter(Boolean);
  const settlementIds = createdSettlements.map((item) => item.id);

  const agreementAfterCreate = await withTimeout('barter-agreement-readback-after-batch-create', 15000, async () => {
    const response = await apiFetch(`/barter/agreements/${agreement.id}`, {}, tokens.manager.token);
    if (!response.ok || !response.json?.data) {
      throw new Error(`agreement readback failed: ${response.status} ${JSON.stringify(response.json)}`);
    }
    return response.json.data;
  });
  const agreementSettlements = Array.isArray(agreementAfterCreate.settlements) ? agreementAfterCreate.settlements : [];
  const agreementBatchIndexes = agreementSettlements.map((item) => item.batchIndex).filter((value) => value !== null && value !== undefined);
  const duplicateBatchCreation = successfulBatches.length > 1;
  const batchIndexCollision = new Set(agreementBatchIndexes).size !== agreementBatchIndexes.length && agreementBatchIndexes.length > 1;

  if (duplicateBatchCreation || batchIndexCollision) {
    addFinding({
      scenario: 'barter_duplicate_batch_create',
      agreementId: String(agreement.id),
      submitStatuses: batchStatuses,
      settlementIds,
      batchIndexes: agreementBatchIndexes,
      status: 'finding',
      message: duplicateBatchCreation
        ? 'duplicate barter batch submit was accepted more than once'
        : 'duplicate batchIndex detected in barter agreement readback',
    });
  }

  recordStep({
    step: 'barter-duplicate-batch-create',
    result: duplicateBatchCreation || batchIndexCollision ? 'finding' : 'clean',
    submitStatuses: batchStatuses,
    settlementIds,
    batchIndexes: agreementBatchIndexes,
  });

  if (!settlementIds.length) {
    throw new Error('barter batch create returned no settlement id');
  }

  const targetSettlementId = settlementIds[0];
  await seedStock(tokens.manager.token, 'LOC-FG', `${DATA.barter.ourItemName}-BATCH`, `OUR-BATCH-${RUN_ID}`, 20);
  await approveBarterSettlement(tokens.manager.token, targetSettlementId, `approve ${RUN_ID}`);

  const postResults = await withTimeout('barter-concurrent-post-submit', 25000, async () => Promise.all([
    postBarterSettlement(tokens.finance.token, targetSettlementId, {
      postingAmount: 400,
      offsetType: 'barter_offset',
      note: DATA.barter.note,
    }),
    postBarterSettlement(tokens.finance.token, targetSettlementId, {
      postingAmount: 400,
      offsetType: 'barter_offset',
      note: DATA.barter.note,
    }),
  ]));

  const postStatuses = summarizeStatuses(postResults);
  const settlementAfterPost = await withTimeout('barter-settlement-readback-after-post', 15000, async () => getBarterSettlement(tokens.manager.token, targetSettlementId));
  const postedCount = Array.isArray(settlementAfterPost.offsetPostings) ? settlementAfterPost.offsetPostings.length : 0;
  const reversalCount = Array.isArray(settlementAfterPost.reversalLogs) ? settlementAfterPost.reversalLogs.length : 0;
  const barterIssueEntries = await countStockEntries(tokens.manager.token, 'barter_issue', `BARTER-${targetSettlementId}`);
  const barterReceiptEntries = await countStockEntries(tokens.manager.token, 'barter_receipt', `BARTER-${targetSettlementId}`);
  const postConflict = postResults.filter((item) => isSuccessStatus(item.status)).length > 1;
  const postDrift = postedCount !== 1 || barterIssueEntries.length !== 1 || barterReceiptEntries.length !== 1 || settlementAfterPost.status !== 'posted';

  if (postConflict || postDrift) {
    addFinding({
      scenario: 'barter_duplicate_post_submit',
      settlementId: String(targetSettlementId),
      submitStatuses: postStatuses,
      settlementStatus: settlementAfterPost.status,
      postedCount,
      barterIssueEntryCount: barterIssueEntries.length,
      barterReceiptEntryCount: barterReceiptEntries.length,
      reversalCount,
      status: 'finding',
      message: postConflict
        ? 'duplicate barter post submit was accepted more than once'
        : 'barter post readback drift detected',
    });
  }

  recordStep({
    step: 'barter-duplicate-post-submit',
    result: postConflict || postDrift ? 'finding' : 'clean',
    submitStatuses: postStatuses,
    settlementStatus: settlementAfterPost.status,
    postedCount,
    barterIssueEntryCount: barterIssueEntries.length,
    barterReceiptEntryCount: barterReceiptEntries.length,
  });
}

async function auditShippingDispatchAndReceipt(tokens) {
  const customer = await createCustomer(tokens.sales.token, {
    nameZh: DATA.shipping.customerName,
    nameEn: `Concurrency Shipping Customer ${RUN_ID}`,
    nameVi: `Khach giao hang ${RUN_ID}`,
    licenseNumber: `CONC-SHIP-LIC-${RUN_ID}`,
    creditLimit: 888888,
    riskLevel: 'low',
    segment: 'direct',
    poolState: 'private',
    salespersonId: Number(tokens.sales.user.id),
    contactName: 'Shipping Concurrency Contact',
    contactPhone: `07${RUN_ID.slice(-8)}`,
    contactEmail: `conc-ship-${RUN_ID}@example.com`,
    addresses: [{
      type: 'shipping',
      label: 'ship',
      countryCode: 'VN',
      fullAddress: `Shipping concurrency address ${RUN_ID}`,
      isPrimary: true,
    }],
  });

  const order = await createOrder(tokens.sales.token, {
    customerId: Number(customer.id),
    items: [{
      productName: DATA.shipping.productName,
      specification: 'CONC-SHIP',
      quantity: DATA.shipping.quantity,
      unit: 'kg',
      unitPrice: 120,
    }],
    paymentTerms: 30,
    notes: `shipping-concurrency ${RUN_ID}`,
  });

  const confirmOrder = await apiFetch(`/orders/${order.id}/status`, {
    method: 'PATCH',
    data: { status: 'confirmed' },
  }, tokens.manager.token);
  if (!confirmOrder.ok) {
    throw new Error(`confirm order failed: ${confirmOrder.status} ${JSON.stringify(confirmOrder.json)}`);
  }

  await seedStock(tokens.manager.token, 'LOC-FG', DATA.shipping.productName, DATA.shipping.batchNo, 8);
  const fgBefore = await readStockBalance(tokens.manager.token, DATA.shipping.productName, DATA.shipping.batchNo, 'LOC-FG');

  const shipment = await createShipment(tokens.manager.token, {
    customerId: Number(customer.id),
    orderId: Number(order.id),
    productName: DATA.shipping.productName,
    quantity: DATA.shipping.quantity,
    unit: 'kg',
    batchNo: DATA.shipping.batchNo,
    carrier: 'CONC-CARRIER',
    trackingNo: DATA.shipping.trackingNo,
  });

  const dispatchResults = await withTimeout('shipping-concurrent-dispatch-submit', 25000, async () => Promise.all([
    apiFetch(`/shipping/${shipment.id}/status`, { method: 'PATCH', data: { status: 'in_transit' } }, tokens.manager.token),
    apiFetch(`/shipping/${shipment.id}/status`, { method: 'PATCH', data: { status: 'in_transit' } }, tokens.manager.token),
  ]));

  const dispatchStatuses = summarizeStatuses(dispatchResults);
  const shippingIssueEntries = await countStockEntries(tokens.manager.token, 'shipping_issue', shipment.shipmentNo);
  const fgAfterDispatch = await readStockBalance(tokens.manager.token, DATA.shipping.productName, DATA.shipping.batchNo, 'LOC-FG');
  const dispatchSuccessCount = dispatchResults.filter((item) => isSuccessStatus(item.status)).length;
  const dispatchReplayAccepted = dispatchSuccessCount > 1;
  const dispatchDrift = fgAfterDispatch !== fgBefore - DATA.shipping.quantity || shippingIssueEntries.length !== 1;

  if (dispatchDrift) {
    addFinding({
      scenario: 'shipping_duplicate_dispatch_submit',
      shipmentId: String(shipment.id),
      shipmentNo: shipment.shipmentNo,
      submitStatuses: dispatchStatuses,
      fgBefore,
      fgAfterDispatch,
      shippingIssueEntryCount: shippingIssueEntries.length,
      status: 'finding',
      message: 'shipping stock readback drift detected',
    });
  }

  recordStep({
    step: 'shipping-duplicate-dispatch-submit',
    result: dispatchDrift ? 'finding' : 'clean',
    submitStatuses: dispatchStatuses,
    fgBefore,
    fgAfterDispatch,
    shippingIssueEntryCount: shippingIssueEntries.length,
    replaySemantic: dispatchReplayAccepted ? 'same-state replay returned success without duplicate stock movement' : 'duplicate replay rejected or only one request succeeded',
  });

  const receiptPayload = {
    fileName: `receipt-${RUN_ID}.png`,
    mimeType: 'image/png',
    dataUrl: makeReceiptPngDataUrl(),
  };

  const receiptResults = await withTimeout('shipping-concurrent-receipt-submit', 25000, async () => Promise.all([
    uploadReceipt(tokens.manager.token, shipment.id, receiptPayload),
    uploadReceipt(tokens.manager.token, shipment.id, receiptPayload),
  ]));

  const receiptStatuses = summarizeStatuses(receiptResults);
  const receiptSuccessCount = receiptResults.filter((item) => isSuccessStatus(item.status)).length;
  const shipmentAfterReceipt = await withTimeout('shipping-readback-after-receipt', 15000, async () => {
    const rows = await listShipments(tokens.manager.token, order.id);
    const matched = rows.find((item) => String(item.id) === String(shipment.id));
    if (!matched) {
      throw new Error(`shipment ${shipment.id} not found in order list readback`);
    }
    return matched;
  });
  const receiptEvents = await withTimeout('shipping-receipt-event-readback', 15000, async () => {
    const response = await apiFetch(`/shipping/${shipment.id}/receipts`, {}, tokens.manager.token);
    if (!response.ok || !response.json?.data) {
      throw new Error(`read shipment receipts failed: ${response.status} ${JSON.stringify(response.json)}`);
    }
    const payload = response.json.data;
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.receipts)) return payload.receipts;
    if (Array.isArray(payload.items)) return payload.items;
    return [];
  });
  const receiptEventCount = Array.isArray(receiptEvents) ? receiptEvents.length : 0;
  const receiptDrift = shipmentAfterReceipt.status !== 'delivered' || !shipmentAfterReceipt.signedReceiptUrl || receiptSuccessCount > 1;

  if (receiptDrift) {
    addFinding({
      scenario: 'shipping_duplicate_receipt_submit',
      shipmentId: String(shipment.id),
      shipmentNo: shipment.shipmentNo,
      submitStatuses: receiptStatuses,
      shipmentStatus: shipmentAfterReceipt.status,
      signedReceiptUrl: shipmentAfterReceipt.signedReceiptUrl || null,
      receiptEventCount,
      status: 'finding',
      message: receiptSuccessCount > 1
        ? 'duplicate shipping receipt submit was accepted more than once'
        : 'shipping receipt readback drift detected',
    });
  }

  recordStep({
    step: 'shipping-duplicate-receipt-submit',
    result: receiptDrift ? 'finding' : 'clean',
    submitStatuses: receiptStatuses,
    shipmentStatus: shipmentAfterReceipt.status,
    signedReceiptUrl: shipmentAfterReceipt.signedReceiptUrl || null,
    receiptEventCount,
  });
}

async function run() {
  const started = Date.now();
  try {
    const tokens = await withTimeout('login-roles', 20000, async () => {
      const [sales, finance, manager] = await Promise.all([
        login('sales', 'sales123'),
        login('finance', 'finance123'),
        login('manager', 'manager123'),
      ]);
      return { sales, finance, manager };
    });
    recordStep({
      step: 'login-roles',
      result: 'passed',
      salesId: tokens.sales.user?.id,
      financeId: tokens.finance.user?.id,
      managerId: tokens.manager.user?.id,
    });

    await withTimeout('audit-order-duplicate-payment', 90000, () => auditOrderDuplicatePayments(tokens));
    await withTimeout('audit-barter-split-batch-and-post', 120000, () => auditBarterSplitBatchAndPost(tokens));
    await withTimeout('audit-shipping-dispatch-and-receipt', 120000, () => auditShippingDispatchAndReceipt(tokens));

    report.summary = {
      scenarioCount: 3,
      findingCount: report.findings.length,
      duplicateOrDriftDetected: report.findings.length > 0,
      durationMs: Date.now() - started,
    };
    report.status = report.findings.length > 0 ? 'findings' : 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error.message || error);
    report.stack = error.stack || null;
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  }

  if (report.status === 'failed') {
    console.error(report.error || 'concurrency reconcile deep audit failed');
    process.exit(1);
  }

  console.log(JSON.stringify({
    status: report.status,
    findings: report.findings.length,
    summary: report.summary,
    reportPath: REPORT_PATH,
  }, null, 2));
}

run();
