// Synthetic contract fixture, never execution evidence or an acceptance report.
const crypto = require('node:crypto');
const hash = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const raw = v => crypto.createHash('sha256').update(v).digest('hex');
const clone = v => JSON.parse(JSON.stringify(v));
function sharedSalesProofFixture(provider = 'sqlite') {
  const runId = 'contract-shared150', date = '2026-10-16T01:00:00.000Z';
  const counts = { owner: 1, sales_lead: 1, sales: 3, buyer: 2, warehouse: 3, production_planner: 1, production_operator: 2, research: 1, qc: 1, qa: 1, receivables: 1, payables: 1, cost_accountant: 1, system_admin: 1 };
  const grants = { owner: ['procurement.payment.verify'], sales_lead: ['orders.status.manage'], sales: ['orders.create'], buyer: ['procurement.write'], warehouse: ['orders.shippingReady.read', 'shipping.write'], qc: ['procurement.quality.inspect'], qa: ['procurement.quality.release'], receivables: ['orders.payment.verify'], payables: ['procurement.payment.record'], cost_accountant: ['production.cost.read'] };
  const actors = []; for (const [job, count] of Object.entries(counts)) for (let index = 1; index <= count; index++) {
    const id = actors.length + 10, role = `r2wf_123456789abc_${job}`, profile = { id, username: `${role}_${index}`, role, isActive: true, mustChangePassword: false, permissions: grants[job] || [], dataScopes: [] };
    actors.push({ id, job, index, role, profile, profilesByInstance: { 0: clone(profile), 1: clone(profile) } });
  }
  const aliases = { lead: ['sales_lead', 1], buyer1: ['buyer', 1], buyer2: ['buyer', 2], salesPeer: ['sales', 2], cost: ['cost_accountant', 1] };
  const actor = job => { const [j, i] = aliases[job] || [job, 1]; return actors.find(a => a.job === j && a.index === i); };
  const m = { orderId: 101, orderNo: 'ORDER-SHARED150', orderItemId: 102, customerId: 103, materialId: 104, purchaseOrderId: 105, purchaseReceiptId: 106, replenishmentBatchId: 107,
    paymentRecordId: 108, supplierPaymentId: 109, qualityCheckId: 110, planId: 111, shipmentIds: [112, 113], existingBatch: 'OPENING100', replenishmentBatch: 'PO-105-RCV-PR1', orderedQuantity: 150, existingQuantity: 100, plannedQuantity: 50, orderAmount: 1500, unit: 'kg' };
  const e = { version: 'shared-sales-chain/v1', status: 'passed', runId, provider, workforce: { configurationOnly: true, participationNotYetProven: true, actors }, manifest: m, actions: [], denials: [], stages: {}, costReadbacks: [] };
  const f = e.final = { order: { id: m.orderId, orderNo: m.orderNo, customerId: m.customerId, finalAmount: 1500, paidAmount: 1500,
    items: [{ id: m.orderItemId, materialId: m.materialId, quantity: 150, unitPrice: 10, unit: 'kg' }], paymentRecords: [{ id: m.paymentRecordId, orderId: m.orderId, status: 'verified', verifiedBy: actor('receivables').id, amount: 1500 }] }, shipments: [], purchase: null, checks: [], supplierPayments: [], plans: [], balances: [], batches: [], entries: [], costs: [], audits: [] };
  let nextAudit = 1;
  const audit = (job, resource, resourceId, action, details) => { const row = { id: nextAudit++, userId: actor(job).id, resource, resourceId, action, details: JSON.stringify(details) }; f.audits.push(row); return row.id; };
  const response = (job, method, endpoint, payload, status = 200, instance = 0, sent = null, target = e.actions) => {
    const http = { job, actorId: actor(job).id, role: actor(job).role, instance, method, path: endpoint, sent: clone(sent), key: payload?.submission?.key || null, status, json: { data: clone(payload) } }; target.push(http); return { ...clone(http), http: clone(http) };
  };
  e.browser = { runId, actors: ['warehouse', 'sales'].map(job => ({ job, ...clone(actor(job).profile), instance: job === 'sales' ? 1 : 0 })), actions: [], screenshots: [], readbacks: [] };
  e.qualityBrowser = { runId, actors: ['qc', 'qa', 'payables'].map(job => ({ job, actorId: actor(job).id, role: actor(job).role })), browserProfiles: ['qc', 'qa', 'payables'].map(job => ({ job, actorId: actor(job).id, path: '/api/auth/me', status: 200, actual: { id: actor(job).id, role: actor(job).role, permissions: actor(job).profile.permissions, dataScopes: [] } })), actions: [], screenshots: [], readbacks: [] };
  const font = { glyphs: Array.from({ length: 10 }, (_, i) => ({ inkPixels: 100 + i, signature: `glyph${i}` })), missingSignatures: ['missing1', 'missing2'] };
  const shot = (browser, job, name, text = '') => { const s = { job, actorId: actor(job).id, name, path: `/artifact/${name}.png`, unobscured: true, visible: true, selector: 'stable-selector', font: clone(font), text }; browser.screenshots.push(s); return s; };
  response('sales', 'POST', '/orders', f.order, 201); response('lead', 'PATCH', `/orders/${m.orderId}/status`, f.order); response('sales', 'POST', `/orders/${m.orderId}/payment`, {}, 200); response('receivables', 'POST', `/orders/${m.orderId}/payment/${m.paymentRecordId}/verify`, {});
  audit('receivables', 'payment', m.paymentRecordId, 'PAYMENT_VERIFIED', { eventId: 'contract-verified-event', eventKey: `payment.verified:${m.paymentRecordId}`, orderId: m.orderId, paymentId: m.paymentRecordId, amount: 1500, currency: 'CNY', verifiedBy: actor('receivables').id });
  const qualityPlan = JSON.stringify({ plan: { characteristics: [{ code: 'PH', lowerLimit: '7', upperLimit: '8' }] } }), basis = JSON.stringify({ amountNative: '500.00' });
  const po = f.purchase = { id: m.purchaseOrderId, salesOrderId: m.orderId, materialId: m.materialId, quantity: 50, price: 10, unit: 'kg', currency: 'CNY', revision: 1, supplierPayableBasisJson: basis, incomingQualityPlanJson: qualityPlan, receipts: [] };
  audit('buyer1', 'purchase_order', po.id, 'CREATE', { schema: 'purchase-create/v1' });
  const sourceAudit = audit('buyer2', 'purchase_order', po.id, 'CONFIRM_SOURCES', { schema: 'purchase-source-confirmation/v1', source: { supplierPayableHash: raw(basis), incomingQualityHash: raw(qualityPlan) } });
  const approvalAudit = audit('owner', 'purchase_order', po.id, 'STATUS_CHANGE', { schema: 'purchase-status/v2', isSourceApproval: true, sourceAuditId: sourceAudit, revision: 1 });
  e.purchaseDraft = { ...clone(po), status: 'pending', revision: 0, supplierPayableBasisJson: null, incomingQualityPlanJson: null };
  response('buyer1', 'POST', '/procurement/orders', e.purchaseDraft, 201, 0, { salesOrderId: m.orderId, quantity: 50 }); response('buyer2', 'POST', `/procurement/orders/${po.id}/confirm-sources`, po); response('owner', 'PATCH', `/procurement/orders/${po.id}/status`, po);
  const receipt = { id: m.purchaseReceiptId, receiptNo: 'PR1', purchaseOrderId: po.id, quantity: 50, acceptedQuantity: 50, rejectedQuantity: 0, unit: 'kg', batchNo: m.replenishmentBatch, stockEntryRef: m.replenishmentBatch, discrepancyReason: null, note: 'Actual50', receivedBy: actor('warehouse').id, receivedAt: date, createdAt: date, supplierBatchNo: 'SUPPLIER50', batchId: m.replenishmentBatchId, payableAmountNative: '500.00', payableAmountBase: '500.00', incomingQualityPlanJson: qualityPlan };
  receipt.payableSnapshotJson = JSON.stringify({ purchaseOrderId: po.id, batchNo: receipt.batchNo, receivedBy: receipt.receivedBy, source: { sourceAuditId: sourceAudit, approvalAuditId: approvalAudit }, allocation: { receivedQuantity: '50', amountNative: '500.00', amountBase: '500.00' } });
  const facts = { purchaseOrderId: po.id, receivedBy: receipt.receivedBy, quantity: 50, acceptedQuantity: 50, rejectedQuantity: 0, batchNo: receipt.supplierBatchNo, receivedAt: null, discrepancyReason: null, discrepancyType: 'supplier_short_received', note: receipt.note, expectedRevision: 1 };
  const purchaseAck = { schema: 'purchase-receipt-submission/v2', key: 'contract-receipt-key', fingerprint: hash({ schema: 'purchase-receipt-facts/v2', ...facts }), auditId: 0, facts, receipt: clone(receipt) };
  purchaseAck.auditId = audit('warehouse', 'purchase_order', po.id, 'CREATE_RECEIPT', { schema: 'purchase-receipt-audit/v2', receiptId: receipt.id, receiptNo: receipt.receiptNo, submissionKeyHash: raw(purchaseAck.key), fingerprint: purchaseAck.fingerprint, receiptHash: hash(purchaseAck.receipt) });
  Object.assign(receipt, { submissionKey: purchaseAck.key, submissionFingerprint: purchaseAck.fingerprint, submissionJson: JSON.stringify(purchaseAck) }); po.receipts.push(receipt);
  e.purchaseReceipt = response('warehouse', 'POST', `/procurement/orders/${po.id}/receipts`, { submission: purchaseAck }, 201);
  for (const eligible of [false, true]) { const bundle = { purchaseReceiptId: receipt.id, currency: 'CNY', payableAmountNative: '500.00', paidAmountNative: '0.00', paymentEligibility: { eligible } }; e[eligible ? 'apAfterQA' : 'apBeforeQA'] = bundle;
    const image = shot(e.qualityBrowser, 'payables', eligible ? 'released' : 'frozen', `500.00 CNY ${eligible ? '最新独立QA放行证据已确认' : '付款核验冻结'}`); e.qualityBrowser.readbacks.push({ receiptId: receipt.id, amountNative: '500.00', eligible, actorId: actor('payables').id, screenshot: image }); }
  const payment = { id: m.supplierPaymentId, paymentNo: 'SP1', purchaseReceiptId: receipt.id, amountNative: '500.00', currency: 'CNY', baseAmount: '500.00', method: 'bank_transfer', date, paymentAccountRef: 'ACCOUNT', externalTransactionRef: 'TX1', evidenceRef: 'ADVICE', note: 'isolated', submittedByUserId: actor('payables').id, createdAt: date };
  const apAck = { schema: 'supplier-payment-submission/v1', key: 'contract-payment-key', fingerprint: 'a'.repeat(64), auditId: 0, status: 'draft', payment: clone(payment), allocationBasis: { payableSnapshotJson: receipt.payableSnapshotJson, receiptSubmissionHash: hash(receipt.submissionJson), paidAmountNativeBefore: '0.00', paidAmountBaseBefore: '0.00' } };
  apAck.auditId = audit('payables', 'supplier_payment', payment.id, 'SUPPLIER_PAYMENT_DRAFTED', { schema: 'supplier-payment-submit-audit/v1', paymentId: payment.id, purchaseReceiptId: receipt.id, submissionKeyHash: raw(apAck.key), fingerprint: apAck.fingerprint, paymentHash: hash(apAck.payment), allocationHash: hash(apAck.allocationBasis) });
  e.supplierPayment = response('payables', 'POST', `/api/procurement/receipts/${receipt.id}/payments`, { submission: apAck }, 201, 0, {}, e.qualityBrowser.actions);
  Object.assign(payment, { status: 'draft', submissionJson: JSON.stringify(apAck) });
  const measurement = { code: 'PH', unit: null, measuredNumeric: '7.5', measuredText: null, instrumentNo: 'METER1', lowerLimit: '7', upperLimit: '8', result: 'pass' };
  const inspection = { id: m.qualityCheckId, checkNo: 'IQ1', purchaseReceiptId: receipt.id, revision: 1, sampleNo: 'SAMPLE1', measurements: [measurement], note: 'Actual retained sample', inspectorUserId: actor('qc').id, checkedAt: date, result: 'pass', planHash: raw(qualityPlan) };
  const input = { sampleNo: inspection.sampleNo, measurements: [{ code: 'PH', unit: null, measuredNumeric: '7.5', measuredText: null, instrumentNo: 'METER1' }], note: inspection.note };
  const qcAck = { schema: 'incoming-quality-submission/v1', key: 'contract-qc-key', fingerprint: hash({ schema: 'incoming-quality-facts/v1', purchaseReceiptId: receipt.id, inspectorUserId: actor('qc').id, ...input }), auditId: 0, inspection };
  qcAck.auditId = audit('qc', 'incoming_quality', inspection.id, 'CREATE_INCOMING_QC', { schema: 'incoming-quality-submit-audit/v1', requestKeyHash: raw(qcAck.key), fingerprint: qcAck.fingerprint, inspectionHash: hash(inspection), purchaseReceiptId: receipt.id });
  const review = { schema: 'incoming-quality-review/v1', checkId: inspection.id, purchaseReceiptId: receipt.id, revision: 1, decision: 'released', reviewedByUserId: actor('qa').id, reviewedAt: date, reason: 'Independent release', inspectionHash: hash(inspection) };
  review.auditId = audit('qa', 'incoming_quality', inspection.id, 'REVIEW_INCOMING_QC', { schema: 'incoming-quality-review-audit/v1', reviewHash: hash(review), checkId: inspection.id, purchaseReceiptId: receipt.id });
  const check = { ...clone(inspection), inspectorUserId: actor('qc').id, reviewedByUserId: actor('qa').id, status: 'released', requestKey: qcAck.key, fingerprint: qcAck.fingerprint, measurementsJson: JSON.stringify(inspection.measurements), submissionJson: JSON.stringify(qcAck), reviewJson: JSON.stringify(review) }; f.checks.push(check);
  e.inspection = response('qc', 'POST', `/api/procurement/receipts/${receipt.id}/quality-checks`, { submission: qcAck }, 201, 0, input, e.qualityBrowser.actions); e.qa = response('qa', 'POST', `/api/procurement/quality-checks/${check.id}/review`, { review }, 200, 1, {}, e.qualityBrowser.actions);
  shot(e.qualityBrowser, 'qc', 'qc-measurements'); shot(e.qualityBrowser, 'qa', 'qa-release');
  const verification = { schema: 'supplier-payment-verification/v1', paymentId: payment.id, purchaseReceiptId: receipt.id, amountNative: '500.00', baseAmount: '500.00', currency: 'CNY', submittedByUserId: actor('payables').id, verifiedByUserId: actor('owner').id, verifiedAt: date, draftAuditId: apAck.auditId, qualityCheckId: check.id, qualityRevision: 1, qualityReviewerUserId: actor('qa').id, paidAmountNativeBefore: '0.00', paidAmountBaseBefore: '0.00', paidAmountNativeAfter: '500.00', paidAmountBaseAfter: '500.00' };
  verification.auditId = audit('owner', 'supplier_payment', payment.id, 'SUPPLIER_PAYMENT_VERIFIED', { schema: 'supplier-payment-decision-audit/v1', paymentId: payment.id, purchaseReceiptId: receipt.id, decisionHash: hash(verification) });
  Object.assign(payment, { status: 'verified', verifiedByUserId: actor('owner').id, verificationJson: JSON.stringify(verification) }); f.supplierPayments.push(payment); e.supplierPaymentVerification = response('owner', 'POST', `/procurement/supplier-payments/${payment.id}/verify`, { payment, verification });
  e.heldRelocation = response('warehouse', 'POST', '/warehouses/stock-balances/115/transfer', { source: {}, destination: {} }, 201);
  e.drafts = [];
  for (const [i, quantity] of [[0, 100], [1, 50]]) {
    const shipmentId = m.shipmentIds[i], batchId = i ? m.replenishmentBatchId : 114, batchNo = i ? m.replenishmentBatch : m.existingBatch;
    const facts = { customerId: m.customerId, orderId: m.orderId, orderItemId: m.orderItemId, materialId: m.materialId, productName: 'Shared material', quantity, unit: 'kg', batchNo: i ? null : batchNo, packageType: null, carrier: null, trackingNo: null };
    const shipment = { ...clone(facts), id: shipmentId, shipmentNo: `SHIP${i}`, productBatchId: i ? null : batchId, createdBy: actor('warehouse').id, createdAt: date, status: 'pending' };
    const draftAck = { schema: 'shipment-submission/v1', key: `contract-draft-${i}`, fingerprint: hash({ actorId: actor('warehouse').id, facts }), actorId: actor('warehouse').id, auditId: 0, facts, shipment: clone(shipment) };
    draftAck.auditId = audit('warehouse', 'shipment', shipmentId, 'CREATE', { schema: 'shipment-create/v1', key: draftAck.key, fingerprint: draftAck.fingerprint, actorId: draftAck.actorId, facts, shipment: draftAck.shipment });
    const d = response('warehouse', 'POST', '/api/shipping', shipment, 201, 0, facts, e.browser.actions); Object.assign(d, { shipment: clone(shipment), submission: clone(draftAck) }); e.drafts.push(d);
    d.http.key = draftAck.key; e.browser.actions.at(-1).key = draftAck.key;
    let previous = null; for (const action of (i ? ['reserve', 'consume'] : ['reserve', 'release', 'reserve', 'consume'])) {
      const event = { schema: 'shipment-reservation/v1', action, shipmentId, actorId: actor('warehouse').id, stockBalanceId: 115 + i, locationId: 117, materialId: m.materialId, batchNo, quantity, unit: 'kg', previousAuditId: previous, reason: null };
      previous = audit('warehouse', 'shipment', shipmentId, { reserve: 'RESERVE_STOCK', release: 'RELEASE_STOCK', consume: 'CONSUME_RESERVATION' }[action], event);
      response('warehouse', action === 'consume' ? 'PATCH' : 'POST', `/api/shipping/${shipmentId}/${action === 'consume' ? 'status' : action === 'release' ? 'release-reservation' : 'reserve'}`, {}, action === 'consume' ? 200 : 201, 0, {}, e.browser.actions);
    }
    Object.assign(shipment, { productBatchId: batchId, batchNo, status: 'delivered', reservationState: 'consumed', reservationAuditId: previous, submissionJson: JSON.stringify(draftAck) });
    const r = { id: 120 + i, receiptNo: `POD${i}`, shipmentId, quantity, acceptedQuantity: quantity, rejectedQuantity: 0, unit: 'kg', signedReceiptUrl: null, discrepancyReason: null, note: 'Actual acceptance', receivedBy: actor('warehouse').id, receivedAt: date, createdAt: date };
    const rfacts = { quantity, acceptedQuantity: quantity, rejectedQuantity: 0, discrepancyType: 'customer_short_signed', discrepancyReason: null, note: r.note, file: null };
    const rack = { schema: 'shipment-receipt-submission/v1', key: `contract-pod-${i}`, actorId: actor('warehouse').id, shipmentId, fingerprint: hash({ shipmentId, actorId: actor('warehouse').id, facts: rfacts }), facts: rfacts, receipt: r };
    rack.auditId = audit('warehouse', 'shipment', shipmentId, 'CREATE_RECEIPT_EVENT', clone(rack)); e[i ? 'secondReceipt' : 'firstReceipt'] = response('warehouse', 'POST', `/api/shipping/${shipmentId}/receipt-events`, { submission: rack }, 201, 0, rfacts, e.browser.actions);
    shipment.receipts = [r]; f.shipments.push(shipment); f.batches.push({ id: batchId, materialId: m.materialId, batchNo, stockQuantity: 0, qualityStatus: 'released' }); f.balances.push({ id: 115 + i, materialId: m.materialId, batchNo, quantity: 0 });
    f.entries.push({ sourceType: 'shipping_issue', sourceRef: shipment.shipmentNo, movements: [{ quantityDelta: -quantity, batchNo }] });
    f.costs.push({ id: 130 + i * 2, batchId, quantityDelta: quantity, costAmountDelta: quantity * 10 }, { id: 131 + i * 2, batchId, quantityDelta: -quantity, costAmountDelta: -quantity * 10 });
    for (const instance of [0, 1]) { const payload = { batch: { id: batchId }, summary: { totalQuantityDelta: 0, currentQuantity: 0, totalCostAmountDelta: 0, currentCostAmount: 0 }, items: clone(f.costs.filter(c => c.batchId === batchId)) }; e.costReadbacks.push({ batchId, instance, data: payload }); response('cost', 'GET', `/production/batches/${batchId}/cost-ledger`, payload, 200, instance); }
  }
  const close = { committedQuantity: 50, receivedQuantity: 50, deliveredFromSource: 50, stockChanged: false, moneyChanged: false, purchaseReceiptIds: [receipt.id], shipmentIds: [m.shipmentIds[1]], shipmentReceiptIds: [121] };
  const plan = { id: m.planId, orderId: m.orderId, orderItemId: m.orderItemId, sourceDocumentId: po.id, plannedQuantity: 50, status: 'closed', createdBy: actor('sales').id, approvedBy: actor('lead').id, closedBy: actor('lead').id, closeoutSnapshot: JSON.stringify(close) }; f.plans.push(plan);
  for (const [job, verb] of [['sales', 'CREATE'], ['lead', 'APPROVE'], ['lead', 'CLOSE']]) audit(job, 'sales_fulfillment_plan', plan.id, `${verb}_SALES_FULFILLMENT_PLAN`, {});
  const closeInput = { idempotencyKey: 'contract-close-key', reason: 'Actual source accepted' };
  e.planClose = response('lead', 'POST', `/orders/${m.orderId}/fulfillment-plans/${plan.id}/close`, plan, 200, 0, closeInput); e.planCloseReplay = response('lead', 'POST', `/orders/${m.orderId}/fulfillment-plans/${plan.id}/close`, plan, 200, 1, closeInput);
  const stageDefinitions = { firstReserved: [100, 0, 0], firstReleased: [0, 0, 0], firstReheld: [100, 0, 0], firstDispatched: [0, 100, 0], partialAccepted: [0, 100, 100], secondReserved: [50, 100, 100], secondDispatched: [0, 150, 100], fullyAccepted: [0, 150, 150] };
  for (const [name, [reserved, dispatched, accepted]] of Object.entries(stageDefinitions)) {
    const expected = { reservedQuantity: reserved, dispatchedQuantity: dispatched, acceptedQuantity: accepted, outstandingQuantity: 150 - accepted, orderedQuantity: 150 };
    const snapshot = clone(f); snapshot.shipments.forEach((s, i) => { if (accepted < (i ? 150 : 100)) s.receipts = []; });
    const opening = ['firstReserved', 'firstReleased', 'firstReheld'].includes(name), purchasing = name === 'secondReserved';
    snapshot.balances[0].quantity = opening ? 100 : 0; snapshot.balances[1].quantity = purchasing ? 50 : 0;
    snapshot.costs = snapshot.costs.filter(c => opening ? c.id === 130 : purchasing ? c.id !== 133 : dispatched < 150 ? c.batchId === 114 : true);
    if (opening || dispatched === 100 && accepted <= 100 && !purchasing) { snapshot.balances = snapshot.balances.filter(b => b.batchNo === m.existingBatch); snapshot.batches = snapshot.batches.filter(b => b.batchNo === m.existingBatch); }
    const value = { ...clone(f.order), fulfillment: { lines: [{ orderItemId: m.orderItemId, ...expected }] } };
    const image = shot(e.browser, 'sales', name); const crop = shot(e.browser, 'sales', `${name}-crop`);
    const b = { runId, actorId: actor('sales').id, job: 'sales', instance: 1, orderId: m.orderId, lineId: m.orderItemId, orderNo: m.orderNo, expected, testIds: { reserved: `order-reserved-${m.orderId}-${m.orderItemId}`, obligation: `order-line-obligation-${m.orderId}-${m.orderItemId}` }, unobscured: true, noPartialLoadWarning: true, font: clone(font), texts: { reserved: `已预留: ${reserved} kg`, obligation: `已签收: ${accepted} kg 待交: ${150 - accepted} kg`, line: `${dispatched} kg / 150 kg` }, screenshot: image.path, crop: crop.path };
    e.browser.readbacks.push(b); e.stages[name] = { expected, details: [clone(value), clone(value)], lists: [[clone(value)], [clone(value)]], browser: b, snapshot };
    for (const instance of [0, 1]) { response('sales', 'GET', `/orders/${m.orderId}`, value, 200, instance); response('sales', 'GET', `/orders?search=${m.orderNo}`, [value], 200, instance); }
  }
  e.stages.beforeDraft = clone(e.stages.firstReserved.snapshot); e.stages.afterDraft = clone(e.stages.beforeDraft);
  e.stages.beforeQC = clone(e.stages.secondReserved.snapshot); e.stages.beforeQC.batches.find(b => b.id === receipt.batchId).qualityStatus = 'hold'; e.stages.beforeQC.checks = []; e.stages.beforeQC.supplierPayments[0].status = 'draft';
  const denials = [['sales cannot confirm own order', 'sales', 403], ['source confirmer cannot approve own sources', 'buyer2', 409], ['warehouse cannot read full orders', 'warehouse', 403], ['warehouse cannot read financial payables', 'warehouse', 403], ['foreign sales cannot read this customer order', 'salesPeer', 404], ['missing batch cannot reserve remainder', 'warehouse', 409], ['shortage cannot dispatch remainder', 'warehouse', 409], ['sales cannot reserve physical stock', 'sales', 403], ['QA hold freezes independent payment verification', 'owner', 409], ['QA hold blocks reservation of the real received batch', 'warehouse', 409], ['QA hold blocks dispatch of the real received batch', 'warehouse', 409], ['inspector cannot independently release own sample', 'qc', 403]];
  denials.push(['late quote/specification may remain blank only in draft', 'owner', 409]);
  const targets = {
    'sales cannot confirm own order': ['PATCH', `/orders/${m.orderId}/status`, 'orders.status.manage'],
    'source confirmer cannot approve own sources': ['PATCH', `/procurement/orders/${po.id}/status`, null, 'PURCHASE_INDEPENDENT_APPROVAL_REQUIRED'],
    'late quote/specification may remain blank only in draft': ['PATCH', `/procurement/orders/${po.id}/status`, null, 'PURCHASE_GOVERNANCE_SOURCE_REQUIRED'],
    'warehouse cannot read full orders': ['GET', `/orders/${m.orderId}`, 'orders.read'],
    'warehouse cannot read financial payables': ['GET', '/procurement/payables', 'finance.read'],
    'foreign sales cannot read this customer order': ['GET', `/orders/${m.orderId}`],
    'missing batch cannot reserve remainder': ['POST', `/shipping/${m.shipmentIds[1]}/reserve`, null, 'SHIPMENT_RESERVATION_IDENTITY_REQUIRED'],
    'shortage cannot dispatch remainder': ['PATCH', `/shipping/${m.shipmentIds[1]}/status`, null, 'SHIPMENT_BATCH_REQUIRED_BEFORE_DISPATCH'],
    'sales cannot reserve physical stock': ['POST', `/shipping/${m.shipmentIds[0]}/reserve`, 'shipping.write'],
    'QA hold freezes independent payment verification': ['POST', `/procurement/supplier-payments/${m.supplierPaymentId}/verify`, null, 'INCOMING_QA_RELEASE_REQUIRED'],
    'QA hold blocks reservation of the real received batch': ['POST', `/shipping/${m.shipmentIds[1]}/reserve`, null, `STOCK_QC_RELEASE_REQUIRED:${m.replenishmentBatch}:hold：批次未放行，禁止发料或出库`],
    'QA hold blocks dispatch of the real received batch': ['PATCH', `/shipping/${m.shipmentIds[1]}/status`, null, `STOCK_MATERIAL_BATCH_NOT_RELEASED:${m.replenishmentBatch}:hold`],
    'inspector cannot independently release own sample': ['POST', `/procurement/quality-checks/${m.qualityCheckId}/review`, 'procurement.quality.release'],
  };
  for (const [name, job, status] of denials) {
    const actionIndex = e.actions.length, [method, endpoint, permission, code] = targets[name];
    response(job, method, endpoint, {}, status);
    e.actions.at(-1).json = { success: false, ...(permission ? { requiredPermissions: [permission] } : {}), ...(code ? { errorCode: code } : { message: 'Not authorized' }) };
    const before = clone(f); if (name.startsWith('QA hold')) before.batches.find(b => b.id === m.replenishmentBatchId).qualityStatus = 'hold';
    e.denials.push({ name, job, actionIndex, before, after: clone(before) });
  }
  e.planCloseReplaySnapshot = clone(f); e.shipmentReplays = []; e.receiptReplays = [];
  for (const index of [0, 1]) for (const instance of [0, 1]) {
    const original = e.drafts[index], receiptOriginal = [e.firstReceipt, e.secondReceipt][index];
    const draftReplay = response('warehouse', 'POST', '/shipping', original.shipment, 200, instance, original.http.sent);
    Object.assign(e.actions.at(-1), { key: original.submission.key, json: { data: clone(original.shipment), submission: clone(original.submission), replayed: true } });
    draftReplay.json = clone(e.actions.at(-1).json); e.shipmentReplays.push({ index, instance, response: draftReplay });
    const receiptReplay = response('warehouse', 'POST', `/shipping/${m.shipmentIds[index]}/receipt-events`, { submission: receiptOriginal.json.data.submission, replayed: true }, 201, instance, receiptOriginal.http.sent);
    e.receiptReplays.push({ index, instance, response: receiptReplay });
  }
  e.supplierVerificationReplay = response('owner', 'POST', `/procurement/supplier-payments/${payment.id}/verify`, { submission: apAck, decision: verification, payment, verification, replayed: true }, 200, 0, {});
  e.afterReplaysSnapshot = clone(f);
  shot(e.browser, 'warehouse', 'physical-shipping');
  e.chainDigest = hash({ manifest: e.manifest, actions: e.actions, final: e.final, browser: e.browser, qualityBrowser: e.qualityBrowser }); return e;
}
function refreshSharedSalesDigest(e) { e.chainDigest = hash({ manifest: e.manifest, actions: e.actions, final: e.final, browser: e.browser, qualityBrowser: e.qualityBrowser }); return e; }
module.exports = { sharedSalesProofFixture, refreshSharedSalesDigest };
