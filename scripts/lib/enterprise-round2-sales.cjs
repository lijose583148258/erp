const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { createWorkforce } = require('./enterprise-round2-workforce.cjs');
const { explicitPurchaseSources } = require('./purchase-quality-audit-fixture.cjs');

const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const money = value => Math.round(Number(value) * 100);

// One concrete shared order, not a second runner or a generic workflow engine.
async function sharedSalesChain(ctx, signal) {
  const { request, dataOf, prisma, runId, urls, reportPath, bootstrap, catalog, ensureReleasedMaterial } = ctx;
  const e = { version: 'shared-sales-chain/v1', runId, provider: process.env.AUDIT_PRISMA_PROVIDER || 'sqlite',
    scope: 'One150 order, existing100 and linked purchase50 with real job identities; not all20/12-chain completion',
    bootstrap: [], actions: [], denials: [], stages: {}, costReadbacks: [] };
  const folder = path.join(path.dirname(reportPath), `${runId}-shared-sales`); fs.mkdirSync(folder, { recursive: true });
  let browser, qualityBrowser;
  const bootstrapRequest = async (endpoint, options = {}) => {
    signal?.throwIfAborted();
    const result = await request(endpoint, { ...options, actor: bootstrap, signal });
    e.bootstrap.push({ method: options.method || 'GET', path: endpoint, status: result.status }); return result;
  };
  try {
    const workforce = ctx.workforce || await createWorkforce({ request: (endpoint, { auth, ...options } = {}) => request(endpoint,
      { ...options, actor: auth ? { token: auth } : null, signal }), dataOf, bootstrapToken: bootstrap.token,
      runId: `${runId}-shared`, password: crypto.randomBytes(24).toString('base64url') + '!Aa1', catalog });
    const one = (job, index = 0) => { const actor = workforce.byJob[job]?.[index]; assert(actor?.id && actor.token); return actor; };
    const people = { sales: one('sales'), salesPeer: one('sales', 1), lead: one('sales_lead'), buyer1: one('buyer'), buyer2: one('buyer', 1),
      warehouse: one('warehouse'), qc: one('qc'), qa: one('qa'), receivables: one('receivables'), payables: one('payables'), owner: one('owner'), cost: one('cost_accountant') };
    e.workforce = { version: workforce.version, configurationOnly: true, participationNotYetProven: true,
      actors: workforce.actors.map(({ id, job, index, role, profile, profilesByInstance }) => ({ id, job, index, role, profile, profilesByInstance })) };
    const call = async (job, endpoint, options = {}) => {
      const actor = people[job]; assert(actor?.id && actor.id !== bootstrap.id, 'Every business request needs a real non-bootstrap actor');
      signal?.throwIfAborted();
      const result = await request(endpoint, { ...options, actor, signal });
      e.actions.push({ job, actorId: actor.id, role: actor.role, instance: options.instance || 0,
        method: options.method || 'GET', path: endpoint, sent: options.data ?? null, key: options.headers?.['Idempotency-Key'] || null,
        status: result.status, json: result.json }); return result;
    };
    const material = await ensureReleasedMaterial({ request: bootstrapRequest, code: `${runId}-shared150`, name: `${runId}-shared150`, category: 'finished_good', unit: 'kg' });
    const warehouses = dataOf(await bootstrapRequest('/warehouses'));
    let fg = warehouses.flatMap(w => w.locations || []).find(loc => loc.code === 'LOC-FG');
    if (!fg) {
      const wh = dataOf(await bootstrapRequest('/warehouses', { method: 'POST', data: { code: `${runId}-shared`, name: 'Isolated shared-chain opening', type: 'physical' } }));
      fg = dataOf(await bootstrapRequest(`/warehouses/${wh.id}/locations`, { method: 'POST', data: { code: 'LOC-FG', name: 'Finished goods', type: 'internal' } }));
    }
    const batchNo = `${runId}-opening100`;
    dataOf(await bootstrapRequest('/warehouses/stock-balances', { method: 'POST', data: { locationId: Number(fg.id), materialId: material.id,
      productName: material.nameZh, batchNo, quantity: 100, unit: 'kg', unitCost: 10, sourceRef: `${runId}-opening`, reason: 'Declared isolated opening100, not a business receipt' } }));
    const supplier = dataOf(await bootstrapRequest('/procurement/suppliers', { method: 'POST', data: { name: `${runId}-shared-supplier`, category: 'Raw Materials', contact: 'Isolated supplier master' } }));
    const customer = dataOf(await call('sales', '/customers', { method: 'POST', data: { name: `${runId}-shared-customer`, nameZh: `${runId}-shared-customer`,
      creditLimit: 100000, termsDays: 30, poolState: 'private', segment: 'direct', salespersonId: people.sales.id } }));
    const order = dataOf(await call('sales', '/orders', { method: 'POST', data: { customerId: Number(customer.id),
      items: [{ materialId: material.id, productName: material.nameZh, quantity: 150, unit: 'kg', unitPrice: 10 }], paymentTerms: 30 } }));
    const initial = dataOf(await call('sales', `/orders/${order.id}`)), lineId = initial.items[0].id;
    e.manifest = { orderId: Number(order.id), orderNo: order.orderNo, orderItemId: lineId, customerId: Number(customer.id),
      materialId: material.id, existingBatch: batchNo, orderedQuantity: 150, existingQuantity: 100, plannedQuantity: 50, unit: 'kg', orderAmount: 1500 };
    const snapshot = async () => {
      const purchase = e.manifest.purchaseOrderId ? await prisma.purchaseOrder.findUnique({ where: { id: e.manifest.purchaseOrderId }, include: { receipts: { orderBy: { id: 'asc' } } } }) : null;
      const receiptIds = purchase?.receipts.map(r => r.id) || [];
      const shipments = await prisma.shipment.findMany({ where: { orderId: Number(order.id) }, orderBy: { id: 'asc' }, include: { receipts: { orderBy: { id: 'asc' } } } });
      const checks = await prisma.incomingQualityCheck.findMany({ where: { purchaseReceiptId: { in: receiptIds } }, orderBy: { id: 'asc' } });
      const supplierPayments = await prisma.supplierPayment.findMany({ where: { purchaseReceiptId: { in: receiptIds } }, orderBy: { id: 'asc' } });
      const plans = await prisma.salesFulfillmentPlan.findMany({ where: { orderId: Number(order.id) }, orderBy: { id: 'asc' } });
      const entries = await prisma.stockEntry.findMany({ where: { movements: { some: { materialId: material.id } } }, orderBy: { id: 'asc' }, include: { movements: { orderBy: { id: 'asc' } } } });
      return { order: await prisma.order.findUnique({ where: { id: Number(order.id) }, include: { items: true, paymentRecords: true } }), shipments, purchase, checks, supplierPayments, plans,
        balances: await prisma.stockBalance.findMany({ where: { materialId: material.id }, orderBy: { id: 'asc' } }),
        batches: await prisma.productBatch.findMany({ where: { materialId: material.id }, orderBy: { id: 'asc' } }), entries,
        costs: await prisma.inventoryCostLedger.findMany({ where: { productBatch: { materialId: material.id } }, orderBy: { id: 'asc' } }),
        audits: await prisma.auditLog.findMany({ where: { OR: [{ resource: 'order', resourceId: Number(order.id) },
          { resource: 'payment', resourceId: e.manifest.paymentRecordId || -1 },
          { resource: 'shipment', resourceId: { in: shipments.map(s => s.id) } }, { resource: 'purchase_order', resourceId: e.manifest.purchaseOrderId || -1 },
          { resource: 'incoming_quality', resourceId: { in: checks.map(c => c.id) } }, { resource: 'supplier_payment', resourceId: { in: supplierPayments.map(p => p.id) } },
          { resource: 'sales_fulfillment_plan', resourceId: { in: plans.map(p => p.id) } }] }, orderBy: { id: 'asc' } }) };
    };
    const deny = async (name, job, endpoint, options, status, code) => {
      const before = await snapshot(), result = await call(job, endpoint, options), after = await snapshot();
      assert.equal(result.status, status, `${name}: ${JSON.stringify(result)}`);
      if (code) assert.equal(result.json.errorCode || result.json.message, code);
      assert.deepEqual(after, before, `${name}: rejected operation changed shared business facts`);
      e.denials.push({ name, job, actionIndex: e.actions.length - 1, before, after }); return result;
    };
    await deny('sales cannot confirm own order', 'sales', `/orders/${order.id}/status`, { method: 'PATCH', data: { status: 'confirmed' } }, 403);
    dataOf(await call('lead', `/orders/${order.id}/status`, { method: 'PATCH', data: { status: 'confirmed' } }));
    dataOf(await call('sales', `/orders/${order.id}/payment`, { method: 'POST', data: { idempotencyKey: `${runId}-shared-ar`, amount: 1500, method: 'bank_transfer', payerName: `${runId}-customer` } }));
    const payment = dataOf(await call('receivables', `/orders/${order.id}`)).paymentRecords.find(row => row.status === 'pending'); assert(payment);
    dataOf(await call('receivables', `/orders/${order.id}/payment/${payment.id}/verify`, { method: 'POST', instance: 1 })); e.manifest.paymentRecordId = Number(payment.id);
    const sources = explicitPurchaseSources({ quoteRef: `${runId}-quote`, specificationRef: `${runId}-spec`, specificationRevision: 'R1',
      taxTreatment: 'none_or_third_party', supplierTaxAmount: 0, supplierChargesAmount: 0,
      characteristics: [{ code: 'PH', name: 'pH', valueType: 'numeric', unit: null, lowerLimit: '7', upperLimit: '8', testMethod: 'Declared calibrated retained-sample pH test', required: true }] });
    // Overseas quote/specification is genuinely not yet available to buyer1.
    // Buyer2 supplies it later on this same draft; do not generate a redundant
    // "confirmation" with identical facts just to make a second actor appear.
    const po = dataOf(await call('buyer1', '/procurement/orders', { method: 'POST', data: { supplierId: Number(supplier.id), materialId: material.id,
      salesOrderId: Number(order.id), item: material.nameZh, quantity: 50, price: 10, unit: 'kg', currency: 'CNY', status: 'pending', eta: new Date(Date.now() + 86400000).toISOString().slice(0, 10) } }));
    e.manifest.purchaseOrderId = Number(po.id);
    e.purchaseDraft = po;
    await deny('late quote/specification may remain blank only in draft', 'owner', `/procurement/orders/${po.id}/status`,
      { method: 'PATCH', data: { status: 'approved', expectedRevision: po.revision } }, 409, 'PURCHASE_GOVERNANCE_SOURCE_REQUIRED');
    const confirmed = dataOf(await call('buyer2', `/procurement/orders/${po.id}/confirm-sources`, { method: 'POST', instance: 1,
      data: { ...sources, expectedRevision: po.revision, expectedUpdatedAt: po.updatedAt, reason: 'Second buyer confirms the actual quote and quality specification' } }));
    await deny('source confirmer cannot approve own sources', 'buyer2', `/procurement/orders/${po.id}/status`,
      { method: 'PATCH', data: { status: 'approved', expectedRevision: confirmed.revision } }, 409, 'PURCHASE_INDEPENDENT_APPROVAL_REQUIRED');
    const approved = dataOf(await call('owner', `/procurement/orders/${po.id}/status`, { method: 'PATCH', data: { status: 'approved', expectedRevision: confirmed.revision } }));
    const planBase = `/orders/${order.id}/fulfillment-plans`;
    const plan = dataOf(await call('sales', planBase, { method: 'POST', data: { idempotencyKey: `${runId}-shared-plan`, orderItemId: lineId,
      fulfillmentOption: 'linked_purchase', sourceDocumentId: Number(po.id), plannedQuantity: 50, expectedFulfillmentAt: new Date(Date.now() + 2 * 86400000).toISOString(), note: 'Original150 obligation, existing100 plus traceable purchase50' } }));
    dataOf(await call('lead', `${planBase}/${plan.id}/approve`, { method: 'POST', data: { expectedUpdatedAt: plan.updatedAt, reason: 'Independent sales lead approves only the remaining50 supply plan' } }));
    e.manifest.planId = plan.id; e.stages.beforeDraft = await snapshot();
    const { createSharedSalesBrowser } = require('./enterprise-round2-sales-browser.cjs');
    browser = await createSharedSalesBrowser({ urls, prisma, actors: people, runId, folder, signal });
    qualityBrowser = await require('./enterprise-round2-sales-quality-browser.cjs').createSharedQualityBrowser({ urls, actors: people, runId, folder, signal });
    const read = async (name, held, dispatched, accepted) => {
      const expected = { reservedQuantity: held, dispatchedQuantity: dispatched, acceptedQuantity: accepted,
        outstandingQuantity: 150 - accepted, orderedQuantity: 150 };
      const details = await Promise.all([0, 1].map(instance => call('sales', `/orders/${order.id}`, { instance }).then(dataOf)));
      const lists = await Promise.all([0, 1].map(instance => call('sales', `/orders?search=${encodeURIComponent(order.orderNo)}`, { instance }).then(dataOf)));
      for (const value of [...details, ...lists.map(rows => rows.find(row => Number(row.id) === Number(order.id)))]) {
        assert(value); assert.equal(money(value.finalAmount), 150000); assert.equal(money(value.paidAmount), 150000);
        for (const [field, quantity] of Object.entries(expected)) assert.equal(value.fulfillment.lines.find(l => l.orderItemId === lineId)[field], quantity, `${name}/${field}`);
      }
      e.stages[name] = { expected, details, lists, browser: await browser.salesRead({ orderId: Number(order.id), lineId, orderNo: order.orderNo, expected }), snapshot: await snapshot() };
    };
    const first = await browser.draft({ orderId: Number(order.id), lineId, quantity: 100, batchNo });
    const second = await browser.draft({ orderId: Number(order.id), lineId, quantity: 50 });
    e.manifest.shipmentIds = [Number(first.shipment.id), Number(second.shipment.id)]; e.drafts = [first, second];
    e.stages.afterDraft = await snapshot();
    for (const field of ['balances', 'batches', 'costs', 'entries']) assert.deepEqual(e.stages.afterDraft[field], e.stages.beforeDraft[field]);
    await deny('warehouse cannot read full orders', 'warehouse', `/orders/${order.id}`, {}, 403);
    await deny('warehouse cannot read financial payables', 'warehouse', '/procurement/payables', {}, 403);
    await deny('foreign sales cannot read this customer order', 'salesPeer', `/orders/${order.id}`, {}, 404);
    await deny('missing batch cannot reserve remainder', 'warehouse', `/shipping/${second.shipment.id}/reserve`, { method: 'POST', data: { expectedAuditId: null } }, 409, 'SHIPMENT_RESERVATION_IDENTITY_REQUIRED');
    await deny('shortage cannot dispatch remainder', 'warehouse', `/shipping/${second.shipment.id}/status`, { method: 'PATCH', data: { status: 'in_transit' } }, 409, 'SHIPMENT_BATCH_REQUIRED_BEFORE_DISPATCH');
    await deny('sales cannot reserve physical stock', 'sales', `/shipping/${first.shipment.id}/reserve`, { method: 'POST', data: { expectedAuditId: null } }, 403);
    e.firstReservation = { response: await browser.reserve({ shipmentId: first.shipment.id }), snapshot: await snapshot() };
    await read('firstReserved', 100, 0, 0);
    await browser.release({ shipmentId: first.shipment.id, reason: 'Cross-border transport papers delayed; release only this hold' }); await read('firstReleased', 0, 0, 0);
    await browser.reserve({ shipmentId: first.shipment.id }); await read('firstReheld', 100, 0, 0);
    await browser.dispatch({ shipmentId: first.shipment.id }); await read('firstDispatched', 0, 100, 0);
    e.firstReceipt = await browser.receive({ shipmentId: first.shipment.id, quantity: 100, acceptedQuantity: 100, note: 'Actual isolated first100 customer acceptance; remainder50 still owed' });
    await read('partialAccepted', 0, 100, 100);
    const receiptResponse = await call('warehouse', `/procurement/orders/${po.id}/receipts`, { method: 'POST', instance: 1,
      headers: { 'Idempotency-Key': `${runId}-shared-purchase-receipt` }, data: { expectedRevision: approved.revision,
        quantity: 50, acceptedQuantity: 50, rejectedQuantity: 0, batchNo: `${runId}-supplier50`, note: 'Actual original PO50 received, independent QC/QA still required' } });
    const receipt = dataOf(receiptResponse).submission.receipt;
    Object.assign(e.manifest, { purchaseReceiptId: receipt.id, replenishmentBatch: receipt.batchNo, replenishmentBatchId: receipt.batchId });
    e.purchaseReceipt = receiptResponse;
    e.apBeforeQA = dataOf(await call('payables', `/procurement/receipts/${receipt.id}/payments`));
    assert.equal(e.apBeforeQA.payableAmountNative, '500.00'); assert.equal(e.apBeforeQA.paidAmountNative, '0.00'); assert.equal(e.apBeforeQA.paymentEligibility.eligible, false);
    await qualityBrowser.payable({ receiptId: receipt.id, amountNative: '500.00', eligible: false });
    const paymentInput = { amountNative: 500, currency: 'CNY', method: 'bank_transfer', date: new Date().toISOString().slice(0, 10),
      paymentAccountRef: `${runId}-supplier-bank`, externalTransactionRef: `${runId}-external-500`, evidenceRef: `${runId}-declared-external-advice`, note: 'Isolated external payment evidence; not a bank execution' };
    e.supplierPayment = await qualityBrowser.registerPayment({ receiptId: receipt.id, input: paymentInput });
    e.manifest.supplierPaymentId = e.supplierPayment.json.data.submission.payment.id;
    await deny('QA hold freezes independent payment verification', 'owner', `/procurement/supplier-payments/${e.manifest.supplierPaymentId}/verify`, { method: 'POST', data: {} }, 409, 'INCOMING_QA_RELEASE_REQUIRED');
    await browser.supplement({ shipmentId: second.shipment.id, batchNo: receipt.batchNo });
    const receivedStock = await prisma.stockBalance.findFirst({ where: { materialId: material.id, batchNo: receipt.batchNo, quantity: 50 } }); assert(receivedStock);
    e.heldRelocation = await call('warehouse', `/warehouses/stock-balances/${receivedStock.id}/transfer`, { method: 'POST', data: { toLocationId: Number(fg.id), quantity: 50,
      requestId: `${runId}-shared-held-relocation`, note: 'Internal relocation only: QC hold remains in force; this is not release or dispatch' } }); dataOf(e.heldRelocation);
    await deny('QA hold blocks reservation of the real received batch', 'warehouse', `/shipping/${second.shipment.id}/reserve`, { method: 'POST', data: { expectedAuditId: null } }, 409);
    await deny('QA hold blocks dispatch of the real received batch', 'warehouse', `/shipping/${second.shipment.id}/status`, { method: 'PATCH', data: { status: 'in_transit' } }, 409);
    e.stages.beforeQC = await snapshot();
    e.inspection = await qualityBrowser.inspect({ receiptId: receipt.id }); const check = e.inspection.json.data.submission.inspection;
    await deny('inspector cannot independently release own sample', 'qc', `/procurement/quality-checks/${check.id}/review`, { method: 'POST', data: { expectedRevision: check.revision, decision: 'released', reason: 'Forbidden self release' } }, 403);
    e.qa = await qualityBrowser.release({ receiptId: receipt.id, checkId: check.id });
    e.manifest.qualityCheckId = check.id;
    e.apAfterQA = dataOf(await call('payables', `/procurement/receipts/${receipt.id}/payments`, { instance: 1 }));
    assert.equal(e.apAfterQA.payableAmountNative, '500.00'); assert.equal(e.apAfterQA.paidAmountNative, '0.00'); assert.equal(e.apAfterQA.paymentEligibility.eligible, true);
    await qualityBrowser.payable({ receiptId: receipt.id, amountNative: '500.00', eligible: true });
    e.supplierPaymentVerification = await call('owner', `/procurement/supplier-payments/${e.manifest.supplierPaymentId}/verify`, { method: 'POST', instance: 1, data: {} }); dataOf(e.supplierPaymentVerification);
    await browser.reserve({ shipmentId: second.shipment.id }); await read('secondReserved', 50, 100, 100);
    await browser.dispatch({ shipmentId: second.shipment.id }); await read('secondDispatched', 0, 150, 100);
    e.secondReceipt = await browser.receive({ shipmentId: second.shipment.id, quantity: 50, acceptedQuantity: 50, note: 'Actual same original pending50 now accepted after QA release' });
    await read('fullyAccepted', 0, 150, 150);
    const closeInput = { idempotencyKey: `${runId}-shared-plan-close`, reason: 'Original100 plus original linkedPO50 fully accepted; no demand erased' };
    e.planClose = await call('lead', `${planBase}/${plan.id}/close`, { method: 'POST', data: closeInput }); dataOf(e.planClose);
    e.final = await snapshot();
    e.planCloseReplay = await call('lead', `${planBase}/${plan.id}/close`, { method: 'POST', instance: 1, data: closeInput }); dataOf(e.planCloseReplay);
    e.planCloseReplaySnapshot = await snapshot(); assert.deepEqual(e.planCloseReplaySnapshot, e.final);
    e.shipmentReplays = [];
    e.receiptReplays = [];
    for (const [index, draft] of e.drafts.entries()) for (const instance of [0, 1]) {
      const response = await call('warehouse', '/shipping', { method: 'POST', instance,
        headers: { 'Idempotency-Key': draft.http.key }, data: draft.http.sent });
      dataOf(response); assert.equal(response.json.replayed, true); assert.deepEqual(response.json.submission, draft.submission);
      e.shipmentReplays.push({ index, instance, response });
      const originalReceipt = [e.firstReceipt, e.secondReceipt][index];
      const replay = await call('warehouse', `/shipping/${draft.shipment.id}/receipt-events`, { method: 'POST', instance,
        headers: { 'Idempotency-Key': originalReceipt.http.key }, data: originalReceipt.http.sent });
      const readback = dataOf(replay); assert.equal(readback.replayed, true); assert.deepEqual(readback.submission, originalReceipt.json.data.submission);
      e.receiptReplays.push({ index, instance, response: replay });
    }
    e.supplierVerificationReplay = await call('owner', `/procurement/supplier-payments/${e.manifest.supplierPaymentId}/verify`,
      { method: 'POST', instance: 0, data: {} }); dataOf(e.supplierVerificationReplay);
    e.afterReplaysSnapshot = await snapshot();
    assert.deepEqual(e.afterReplaysSnapshot, e.final, 'Replays must not recreate any stock/cost/receipt/payment/audit fact');
    for (const batch of e.final.batches) for (const instance of [0, 1]) e.costReadbacks.push({ batchId: batch.id, instance,
      data: dataOf(await call('cost', `/production/batches/${batch.id}/cost-ledger`, { instance })) });
    assert.equal(e.final.shipments.length, 2); assert.equal(e.final.shipments.flatMap(s => s.receipts).reduce((n, r) => n + r.acceptedQuantity, 0), 150);
    assert(e.final.balances.every(b => b.quantity === 0)); assert.equal(e.final.costs.reduce((n, c) => n + c.quantityDelta, 0), 0);
    assert.equal(money(e.final.costs.reduce((n, c) => n + c.costAmountDelta, 0)), 0);
    await qualityBrowser.close(); await browser.close();
    e.browser = browser.evidence(); e.qualityBrowser = qualityBrowser.evidence();
    e.status = 'passed'; e.chainDigest = digest({ manifest: e.manifest, actions: e.actions, final: e.final, browser: e.browser, qualityBrowser: e.qualityBrowser });
    require('./enterprise-round2-sales-proof.cjs').verifySharedSalesChain(e);
    return e;
  } catch (error) {
    e.status = 'failed'; e.browser = browser?.evidence(); e.qualityBrowser = qualityBrowser?.evidence(); error.evidence = e; throw error;
  } finally { await qualityBrowser?.close(); await browser?.close(); }
}
module.exports = { sharedSalesChain };
