const assert = require('node:assert/strict');
const { explicitPurchaseSources, createApprovedPurchaseFixture } = require('./purchase-quality-audit-fixture.cjs');

async function readSupplierPaymentSnapshot(prisma, receiptId) {
  const rows = await prisma.supplierPayment.findMany({ where: { purchaseReceiptId: receiptId }, orderBy: { id: 'asc' } });
  const audits = await prisma.auditLog.findMany({ where: { resource: 'supplier_payment', resourceId: { in: rows.map(row => row.id) } }, orderBy: { id: 'asc' } });
  return { rows, audits };
}

// Actual dual-node API/database evidence. This is a sub-proof, not the missing
// whole purchase obligation: scoped role browsers and cumulative/cloud gates
// must still run before the original fixed37 check may be accepted.
async function purchaseQualityPayablesApiProbe({ request, dataOf, actors, prisma, runId, material, supplier }, signal) {
  const e = { version: 'purchase-quality-payables-api/v1', provider: process.env.AUDIT_PRISMA_PROVIDER || 'sqlite', requests: [],
    scope: 'Actual receipt liability, failed/retested QC, independent QA and external supplier payment registration; no bank execution, supplier refund, full workforce/browser/cloud acceptance' };
  const call = async (endpoint, actor, method = 'GET', data, instance = 0, key) => {
    const result = await request(endpoint, { actor, instance, method, data, signal, headers: key ? { 'Idempotency-Key': key } : {} });
    e.requests.push({ endpoint, actorId: actor.id, instance, method, data: data || null, key: key || null, ...result });
    return result;
  };
  const err = (response, status, code) => { assert.equal(response.status, status, JSON.stringify(response.json)); if (code) assert.equal(response.json.errorCode, code); };
  try {
    const sources = explicitPurchaseSources({ quoteRef: `${runId}-ap-quote`, specificationRef: `${runId}-ap-spec`, specificationRevision: 'R1',
      taxTreatment: 'none_or_third_party', supplierTaxAmount: 0, supplierChargesAmount: 0, characteristics: [
        { code: 'PH', name: 'pH', valueType: 'numeric', unit: null, lowerLimit: '7', upperLimit: '8', testMethod: 'Explicit synthetic calibrated meter', required: true },
      ] });
    e.setup = await createApprovedPurchaseFixture({ request, dataOf, signal }, { buyer: actors.buyer1, approver: actors.buyer2, sources,
      payload: { supplierId: Number(supplier.id), materialId: material.id, item: material.nameZh, quantity: 3, price: 10.01,
        unit: 'kg', eta: '2026-10-14', currency: 'USD', exchangeRate: 0.14 } });
    const order = e.setup.approved, po = Number(order.id), supplierLot = `${runId}-ap-supplier-lot`;
    const receive = async (quantity, key) => dataOf(await call(`/procurement/orders/${po}/receipts`, actors.buyer1, 'POST',
      { expectedRevision: order.revision, quantity, acceptedQuantity: quantity, rejectedQuantity: 0, batchNo: supplierLot }, 0, key));
    e.receipt1 = await receive(1, `${runId}-ap-receipt-1`); e.receipt2 = await receive(2, `${runId}-ap-receipt-2`);
    const receiptId = e.receipt1.submission.receipt.id, otherReceiptId = e.receipt2.submission.receipt.id;
    assert.equal(e.receipt1.submission.receipt.payableAmountNative, '10.01'); assert.equal(e.receipt1.submission.receipt.payableAmountBase, '71.50');
    assert.equal(e.receipt2.submission.receipt.payableAmountNative, '20.02'); assert.equal(e.receipt2.submission.receipt.payableAmountBase, '143.00');
    assert.notEqual(e.receipt1.submission.receipt.batchId, e.receipt2.submission.receipt.batchId);
    const isolated = async () => ({ receipts: await prisma.purchaseReceipt.findMany({ where: { purchaseOrderId: po }, orderBy: { id: 'asc' } }),
      entries: await prisma.stockEntry.findMany({ where: { sourceRef: { startsWith: `PO-${po}-RCV-` } }, orderBy: { id: 'asc' } }),
      movements: await prisma.stockMovement.findMany({ where: { batchNo: { startsWith: `PO-${po}-RCV-` } }, orderBy: { id: 'asc' } }),
      costs: await prisma.inventoryCostLedger.findMany({ where: { batchId: { in: [e.receipt1.submission.receipt.batchId, e.receipt2.submission.receipt.batchId] } }, orderBy: { id: 'asc' } }),
      customerPayments: await prisma.paymentRecord.findMany({ orderBy: { id: 'asc' } }), financeAdjustments: await prisma.receivableAdjustment.findMany({ orderBy: { id: 'asc' } }) });
    e.unrelatedBefore = await isolated();
    e.receiptAudits = await prisma.auditLog.findMany({ where: { resource: 'purchase_order', resourceId: po }, orderBy: { id: 'asc' } });
    e.qualityStages = [];
    const captureQuality = async label => {
      const checks = await prisma.incomingQualityCheck.findMany({ where: { purchaseReceiptId: receiptId }, orderBy: { id: 'asc' } });
      e.qualityStages.push({ label, batch: await prisma.productBatch.findUniqueOrThrow({ where: { id: e.receipt1.submission.receipt.batchId } }), checks,
        audits: await prisma.auditLog.findMany({ where: { resource: 'incoming_quality', resourceId: { in: checks.map(row => row.id) } }, orderBy: { id: 'asc' } }) });
    };
    const paymentSnapshot = () => readSupplierPaymentSnapshot(prisma, receiptId);
    const bundle = async (instance = 0) => dataOf(await call(`/procurement/receipts/${receiptId}/payments`, actors.finance1, 'GET', undefined, instance));
    e.preQA = await bundle(); assert.equal(e.preQA.paymentEligibility.eligible, false); assert.equal(e.preQA.outstandingAmountNative, '10.01');
    const proposalFacts = (amountNative, flow) => ({ amountNative, currency: 'USD', method: 'bank_transfer', date: '2026-10-14',
      paymentAccountRef: `${runId}-BANK-Account-MixedCase`, externalTransactionRef: `${runId}-${flow}`, evidenceRef: `${runId}-bank-advice-${flow}`, note: 'Synthetic external payment evidence, not bank execution' });
    const propose = (actor, amount, flow, key, instance = 0, id = receiptId) => call(`/procurement/receipts/${id}/payments`, actor, 'POST', proposalFacts(amount, flow), instance, key);
    e.concurrentDraft = await Promise.all([0, 1].map(instance => propose(actors.finance1, 1, 'FIRST', `${runId}-draft-1`, instance)));
    assert(e.concurrentDraft.every(r => r.status === 201), JSON.stringify(e.concurrentDraft));
    assert.equal(e.concurrentDraft.filter(r => r.json.data.replayed).length, 1);
    assert.deepEqual(e.concurrentDraft[0].json.data.submission, e.concurrentDraft[1].json.data.submission);
    const first = dataOf(e.concurrentDraft[0]).submission.payment;
    assert.equal(first.baseAmount, '7.14'); assert.equal(first.paymentAccountRef, `${runId}-BANK-Account-MixedCase`);
    const untouchedDraft = await paymentSnapshot();
    err(await propose(actors.finance1, 2, 'FIRST', `${runId}-draft-1`), 409, 'SUPPLIER_PAYMENT_KEY_CONFLICT');
    err(await propose(actors.finance2, 1, 'FIRST', `${runId}-draft-1`), 409, 'SUPPLIER_PAYMENT_KEY_CONFLICT');
    err(await propose(actors.finance1, 1, 'OTHER', `${runId}-draft-other`), 409, 'SUPPLIER_PAYMENT_DRAFT_PENDING');
    err(await call(`/procurement/supplier-payments/${first.id}/verify`, actors.finance1, 'POST', {}), 403, 'SUPPLIER_PAYMENT_SELF_VERIFY_FORBIDDEN');
    err(await call(`/procurement/supplier-payments/${first.id}/verify`, actors.finance2, 'POST', {}, 1), 409, 'INCOMING_QA_RELEASE_REQUIRED');
    err(await call(`/procurement/receipts/${receiptId}/payments`, actors.stock0), 403);
    assert.deepEqual(await paymentSnapshot(), untouchedDraft); assert.equal((await bundle()).paidAmountNative, '0.00');

    const inspect = async (value, actor, key) => dataOf(await call(`/procurement/receipts/${receiptId}/quality-checks`, actor, 'POST',
      { sampleNo: `${runId}-${key}`, measurements: [{ code: 'PH', unit: null, measuredNumeric: value, measuredText: null, instrumentNo: 'SYNTHETIC-METER-PH-1' }],
        note: 'Explicit isolated actual measurement submission' }, 0, `${runId}-${key}`));
    const review = (check, decision, reason, actor = actors.buyer2) => call(`/procurement/quality-checks/${check.id}/review`, actor, 'POST',
      { expectedRevision: check.revision, decision, reason }, 1);
    e.failedQC = await inspect('6.5', actors.admin, 'qc-failed'); const failed = e.failedQC.submission.inspection;
    assert.equal(failed.result, 'fail');
    err(await review(failed, 'released', 'Cannot release failed measurements'), 409, 'INCOMING_QA_FAILED_INSPECTION');
    err(await review(failed, 'rejected', 'Admin cannot approve own measurements', actors.admin), 409, 'INCOMING_QA_INDEPENDENT_REVIEWER_REQUIRED');
    e.failedDecision = dataOf(await review(failed, 'rejected', 'Independent QA isolated failed pH evidence'));
    assert.equal((await prisma.productBatch.findUnique({ where: { id: e.receipt1.submission.receipt.batchId } })).qualityStatus, 'quarantine');
    await captureQuality('failed-qc-quarantined');
    e.passingQC = await inspect('7.5000', actors.stock0, 'qc-passing'); const passed = e.passingQC.submission.inspection;
    assert.equal(passed.revision, 2); assert.equal(passed.result, 'pass');
    await captureQuality('passing-retest-held');
    e.release = dataOf(await review(passed, 'released', 'Independent QA released the actual retained sample'));
    await captureQuality('independent-qa-released');
    e.qualityReadback = dataOf(await call(`/procurement/receipts/${receiptId}/quality`, actors.stock0));
    const denyPrivate = obj => { for (const [key, value] of Object.entries(obj || {})) {
      assert(!['price', 'amountNative', 'amountBase', 'payableAmountNative', 'payableSnapshotJson', 'supplierPayableBasisJson', 'binding', 'requestKey'].includes(key), `QC price/private field ${key}`);
      if (value && typeof value === 'object') denyPrivate(value);
    } };
    denyPrivate(e.qualityReadback); assert.equal(e.qualityReadback.receipt.qualityStatus, 'released');
    e.concurrentVerify = await Promise.all([0, 1].map(instance => call(`/procurement/supplier-payments/${first.id}/verify`, actors.finance2, 'POST', {}, instance)));
    assert(e.concurrentVerify.every(r => r.status === 200), JSON.stringify(e.concurrentVerify)); assert.equal(e.concurrentVerify.filter(r => r.json.data.replayed).length, 1);
    assert.deepEqual(e.concurrentVerify[0].json.data.verification, e.concurrentVerify[1].json.data.verification);
    assert.equal((await bundle()).paidAmountBase, '7.14');

    e.retestQC = await inspect('7.6', actors.stock0, 'qc-retest'); const retest = e.retestQC.submission.inspection;
    await captureQuality('new-retest-held');
    e.originalPaymentReplay = dataOf(await call(`/procurement/supplier-payments/${first.id}/verify`, actors.finance2, 'POST', {}, 1));
    assert.deepEqual(e.originalPaymentReplay.verification, dataOf(e.concurrentVerify[0]).verification);
    // Corrupt only this isolated synthetic historical QA audit, then restore
    // the exact original bytes. A later hold must not hide an invalid release
    // behind a previously verified payment or invent a zero payable balance.
    const originalQaAudit = await prisma.auditLog.findUnique({ where: { id: e.release.review.auditId } });
    try {
      await prisma.auditLog.update({ where: { id: originalQaAudit.id }, data: { details: '{}' } });
      e.corruptedHistoricalQa = await call(`/procurement/receipts/${receiptId}/payments`, actors.finance1);
      err(e.corruptedHistoricalQa, 409, 'INCOMING_QUALITY_EVIDENCE_INVALID');
      const candidates = dataOf(await call('/procurement/payables?pageSize=50', actors.finance1));
      const unknown = candidates.items.find(row => row.purchaseReceiptId === receiptId);
      assert.equal(unknown.state, 'history_unreconciled'); assert.equal(unknown.payableAmountNative, null);
      assert.equal(unknown.outstandingAmountNative, null);
      e.unknownCandidate = unknown;
    } finally { await prisma.auditLog.update({ where: { id: originalQaAudit.id }, data: { details: originalQaAudit.details } }); }
    e.oldQaReplay = dataOf(await review(passed, 'released', 'Independent QA released the actual retained sample'));
    assert.equal(e.oldQaReplay.replayed, true); assert.equal((await bundle()).paymentEligibility.eligible, false);
    await captureQuality('old-qa-replay-still-held');
    const second = dataOf(await propose(actors.finance1, 1, 'SECOND', `${runId}-draft-2`, 1)).submission.payment;
    assert.equal(second.baseAmount, '7.15'); err(await call(`/procurement/supplier-payments/${second.id}/verify`, actors.finance2, 'POST', {}), 409, 'INCOMING_QA_RELEASE_REQUIRED');
    e.retestRelease = dataOf(await review(retest, 'released', 'Independent QA released the new retest evidence'));
    await captureQuality('latest-qa-released');
    dataOf(await call(`/procurement/supplier-payments/${second.id}/verify`, actors.finance2, 'POST', {}));

    const cancelled = dataOf(await propose(actors.finance1, 8.01, 'FINAL', `${runId}-draft-cancel`)).submission.payment;
    err(await call(`/procurement/supplier-payments/${cancelled.id}/cancel`, actors.finance2, 'POST', { reason: 'Another actor cannot cancel this draft' }), 403, 'SUPPLIER_PAYMENT_CANCEL_SCOPE_DENIED');
    e.cancellation = dataOf(await call(`/procurement/supplier-payments/${cancelled.id}/cancel`, actors.finance1, 'POST', { reason: 'Wrong external advice, register a corrected draft' }));
    e.cancelReplay = dataOf(await call(`/procurement/supplier-payments/${cancelled.id}/cancel`, actors.finance1, 'POST', { reason: 'Wrong external advice, register a corrected draft' }, 1));
    assert.deepEqual(e.cancelReplay.cancellation, e.cancellation.cancellation);
    err(await call(`/procurement/supplier-payments/${cancelled.id}/cancel`, actors.finance1, 'POST', { reason: 'Cannot replace the saved cancellation reason' }), 409, 'SUPPLIER_PAYMENT_CANCEL_CONFLICT');
    const final = dataOf(await propose(actors.finance1, 8.01, 'FINAL', `${runId}-draft-final`, 1)).submission.payment;
    assert.equal(final.baseAmount, '57.21'); e.beforeAuditFault = await paymentSnapshot();
    const name = `supplier_payment_audit_fault_${final.id}`, pg = process.env.AUDIT_PRISMA_PROVIDER === 'postgresql';
    try {
      if (pg) {
        await prisma.$executeRawUnsafe(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic payment audit unavailable'; END; $$`);
        await prisma.$executeRawUnsafe(`CREATE TRIGGER ${name} BEFORE INSERT ON audit_logs FOR EACH ROW WHEN (NEW.action='SUPPLIER_PAYMENT_VERIFIED' AND NEW.resource_id=${final.id}) EXECUTE FUNCTION ${name}()`);
      } else await prisma.$executeRawUnsafe(`CREATE TRIGGER ${name} BEFORE INSERT ON audit_logs WHEN NEW.action='SUPPLIER_PAYMENT_VERIFIED' AND NEW.resource_id=${final.id} BEGIN SELECT RAISE(ABORT,'Synthetic payment audit unavailable'); END`);
      err(await call(`/procurement/supplier-payments/${final.id}/verify`, actors.finance2, 'POST', {}, 1), 500);
    } finally {
      await prisma.$executeRawUnsafe(pg ? `DROP TRIGGER IF EXISTS ${name} ON audit_logs` : `DROP TRIGGER IF EXISTS ${name}`);
      if (pg) await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${name}()`);
    }
    e.afterAuditFault = await paymentSnapshot(); assert.deepEqual(e.afterAuditFault, e.beforeAuditFault);
    dataOf(await call(`/procurement/supplier-payments/${final.id}/verify`, actors.finance2, 'POST', {}, 1));
    err(await call(`/procurement/supplier-payments/${final.id}/cancel`, actors.finance1, 'POST', { reason: 'Verified payment cannot silently disappear' }), 409, 'SUPPLIER_PAYMENT_VERIFIED_CANNOT_CANCEL');
    err(await propose(actors.finance1, 0.01, 'OVERPAY', `${runId}-draft-overpay`), 409, 'SUPPLIER_PAYMENT_EXCEEDS_PAYABLE');
    err(await propose(actors.finance1, 1, 'FIRST', `${runId}-other-receipt`, 1, otherReceiptId), 409, 'SUPPLIER_PAYMENT_BANK_TRANSACTION_DUPLICATE');
    e.finalReadbacks = await Promise.all([0, 1].map(instance => bundle(instance)));
    assert.deepEqual(e.finalReadbacks[0], e.finalReadbacks[1]);
    assert.equal(e.finalReadbacks[0].paidAmountNative, '10.01'); assert.equal(e.finalReadbacks[0].paidAmountBase, '71.50');
    assert.equal(e.finalReadbacks[0].outstandingAmountNative, '0.00'); assert.equal(e.finalReadbacks[0].outstandingAmountBase, '0.00');
    assert.equal(e.finalReadbacks[0].payments.filter(row => row.status === 'verified').length, 3);
    e.finalDatabase = await paymentSnapshot(); e.unrelatedAfter = await isolated(); assert.deepEqual(e.unrelatedAfter, e.unrelatedBefore);
    assert.equal(e.finalDatabase.audits.filter(a => a.action === 'SUPPLIER_PAYMENT_VERIFIED').length, 3);
    e.requirements = { physical_receipt_immediately_recognizes_ap: true, qa_freezes_payment_not_debt: true, failed_qc_quarantined_and_independent_retest: true,
      same_supplier_lot_never_merges_controlled_batches: true, historical_qa_ack_never_releases_new_hold: true, native_and_base_partial_payments_close_exactly: true,
      duplicate_ack_and_bank_ref_do_not_rebook: true, cancelled_draft_preserves_history_without_refund: true, failed_audit_rolls_back_payment: true, no_customer_ar_or_stock_reposting: true };
    return e;
  } catch (error) { error.evidence = e; throw error; }
}
// Re-read serialized HTTP and typed database facts independently of the probe's
// assertions. Summary/requirements booleans are deliberately not consulted.
function verifyPurchaseQualityPayablesApiProof(raw) {
  const crypto = require('node:crypto');
  const e = JSON.parse(JSON.stringify(raw));
  const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const textHash = value => crypto.createHash('sha256').update(value).digest('hex');
  const money = value => {
    const m = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(String(value));
    assert(m, `Invalid actual money: ${value}`);
    return BigInt(m[1]) * 100n + BigInt((m[2] || '').padEnd(2, '0'));
  };
  const fixed = value => { const n = money(value); return `${n / 100n}.${String(n % 100n).padStart(2, '0')}`; };
  const id = value => { assert(Number.isSafeInteger(value) && value > 0, 'Missing typed positive identity'); return value; };
  const data = response => { assert([200, 201].includes(response.status)); assert.equal(response.json.success, true); return response.json.data; };
  assert.equal(e.version, 'purchase-quality-payables-api/v1');
  assert(['sqlite', 'postgresql'].includes(e.provider));
  assert(Array.isArray(e.receiptAudits), 'Missing original source/receipt audit rows');
  assert(Array.isArray(e.qualityStages), 'Missing raw QC/QA lifecycle snapshots');
  const r1 = e.receipt1.submission.receipt, r2 = e.receipt2.submission.receipt;
  const receiptId = id(r1.id), otherReceiptId = id(r2.id), po = id(r1.purchaseOrderId);
  assert.notEqual(receiptId, otherReceiptId); assert.equal(r2.purchaseOrderId, po);
  assert.notEqual(id(r1.batchId), id(r2.batchId)); assert.equal(r1.supplierBatchNo, r2.supplierBatchNo); assert(r1.supplierBatchNo);
  const setup = e.setup;
  assert.equal(setup.created.status, 'pending'); assert.equal(setup.approved.status, 'approved');
  assert.equal(Number(setup.created.id), po); assert.equal(Number(setup.approved.id), po);
  assert.notEqual(id(setup.buyerId), id(setup.approverId));
  assert.equal(setup.creationRequest.status, 'pending'); assert.equal(setup.creationRequest.quantity, 3);
  assert.equal(setup.creationRequest.price, 10.01); assert.equal(setup.creationRequest.currency, 'USD'); assert.equal(setup.creationRequest.exchangeRate, 0.14);
  assert.deepEqual(setup.created, data(setup.creationResponse)); assert.deepEqual(setup.approved, data(setup.approvalResponse));
  assert.deepEqual(setup.approvalRequest, { status: 'approved', expectedRevision: setup.created.revision });
  assert.equal(setup.approved.revision, setup.created.revision);
  const quote = JSON.parse(setup.approved.supplierPayableBasisJson), plan = JSON.parse(r1.incomingQualityPlanJson).plan;
  assert.equal(quote.schema, 'supplier-payable-basis/v1'); assert.equal(money(quote.amountNative), 3003n); assert.equal(money(quote.amountBase), 21450n);
  assert.equal(quote.terms.evidenceRef, setup.creationRequest.supplierPayableTerms.evidenceRef);
  assert.equal(plan.specificationRef, setup.creationRequest.incomingQualityPlan.specificationRef);
  assert.equal(plan.specificationRevision, setup.creationRequest.incomingQualityPlan.specificationRevision);
  assert.equal(plan.characteristics.length, 1);
  const standard = plan.characteristics[0];
  assert.equal(standard.code, 'PH'); assert.equal(standard.lowerLimit, '7'); assert.equal(standard.upperLimit, '8');
  assert.equal(standard.required, true); assert(standard.testMethod);
  assert.equal(e.unrelatedBefore.receipts.length, 2);
  for (const [index, ack] of [e.receipt1.submission, e.receipt2.submission].entries()) {
    const receipt = ack.receipt, quantity = index + 1, actual = e.unrelatedBefore.receipts.find(row => row.id === receipt.id);
    assert(actual); assert.equal(ack.schema, 'purchase-receipt-submission/v2');
    assert.equal(ack.fingerprint, hash({ schema: 'purchase-receipt-facts/v2', ...ack.facts }));
    assert.equal(ack.facts.purchaseOrderId, po); assert.equal(ack.facts.receivedBy, setup.buyerId);
    assert.equal(ack.facts.expectedRevision, setup.created.revision); assert.equal(ack.facts.quantity, quantity);
    assert.equal(ack.facts.acceptedQuantity, quantity); assert.equal(ack.facts.rejectedQuantity, 0); assert.equal(ack.facts.batchNo, receipt.supplierBatchNo);
    assert.equal(receipt.quantity, quantity); assert.equal(receipt.acceptedQuantity, quantity); assert.equal(receipt.rejectedQuantity, 0); assert.equal(receipt.unit, 'kg');
    assert.equal(receipt.batchNo, `PO-${po}-RCV-${receipt.receiptNo}`); assert.equal(receipt.stockEntryRef, receipt.batchNo);
    assert.equal(money(receipt.payableAmountNative), BigInt(quantity) * 1001n); assert.equal(money(receipt.payableAmountBase), BigInt(quantity) * 7150n);
    assert.equal(actual.submissionKey, ack.key); assert.equal(actual.submissionFingerprint, ack.fingerprint); assert.deepEqual(JSON.parse(actual.submissionJson), ack);
    for (const [key, value] of Object.entries(receipt)) {
      if (['payableAmountNative', 'payableAmountBase'].includes(key)) assert.equal(money(actual[key]), money(value));
      else assert.deepEqual(actual[key], value, `Actual receipt ${key}`);
    }
    const snapshot = JSON.parse(receipt.payableSnapshotJson);
    assert.equal(snapshot.schema, 'purchase-receipt-payable/v1'); assert.equal(snapshot.purchaseOrderId, po);
    assert.equal(snapshot.receiptNo, receipt.receiptNo); assert.equal(snapshot.batchNo, receipt.batchNo); assert.equal(snapshot.supplierBatchNo, receipt.supplierBatchNo);
    assert.equal(snapshot.source.supplierPayableBasisJson, setup.approved.supplierPayableBasisJson); id(snapshot.source.sourceAuditId); id(snapshot.source.approvalAuditId);
    assert.notEqual(snapshot.source.sourceAuditId, snapshot.source.approvalAuditId);
    const sourceAudit = e.receiptAudits.find(a => a.id === snapshot.source.sourceAuditId), approvalAudit = e.receiptAudits.find(a => a.id === snapshot.source.approvalAuditId);
    for (const [audit, actor, action] of [[sourceAudit, setup.buyerId, 'CREATE'], [approvalAudit, setup.approverId, 'STATUS_CHANGE']]) {
      assert(audit); assert.equal(audit.userId, actor); assert.equal(audit.action, action); assert.equal(audit.resource, 'purchase_order'); assert.equal(audit.resourceId, po);
    }
    const sourceFacts = JSON.parse(sourceAudit.details); assert.equal(sourceFacts.schema, 'purchase-create/v1');
    assert.equal(sourceFacts.after.supplierPayableBasisJson, setup.approved.supplierPayableBasisJson); assert.equal(sourceFacts.after.incomingQualityPlanJson, receipt.incomingQualityPlanJson);
    assert.equal(sourceFacts.source.supplierPayableHash, textHash(setup.approved.supplierPayableBasisJson)); assert.equal(sourceFacts.source.incomingQualityHash, textHash(receipt.incomingQualityPlanJson));
    assert.deepEqual(JSON.parse(approvalAudit.details), { schema: 'purchase-status/v2', revision: setup.created.revision, from: 'pending', to: 'approved', isSourceApproval: true,
      sourceAuditId: sourceAudit.id, supplierPayableHash: textHash(setup.approved.supplierPayableBasisJson), incomingQualityHash: textHash(receipt.incomingQualityPlanJson) });
    const receiptAudit = e.receiptAudits.find(a => a.id === ack.auditId); assert(receiptAudit);
    assert.equal(receiptAudit.userId, setup.buyerId); assert.equal(receiptAudit.action, 'CREATE_RECEIPT'); assert.equal(receiptAudit.resource, 'purchase_order'); assert.equal(receiptAudit.resourceId, po);
    assert.deepEqual(JSON.parse(receiptAudit.details), { schema: 'purchase-receipt-audit/v2', receiptId: receipt.id, receiptNo: receipt.receiptNo,
      submissionKeyHash: textHash(ack.key), fingerprint: ack.fingerprint, receiptHash: hash(receipt) });
    assert.equal(money(snapshot.allocation.amountNative), money(receipt.payableAmountNative)); assert.equal(money(snapshot.allocation.amountBase), money(receipt.payableAmountBase));
    assert.equal(receipt.incomingQualityPlanJson, setup.approved.incomingQualityPlanJson);
    const entry = e.unrelatedBefore.entries.filter(row => row.sourceRef === receipt.batchNo); assert.equal(entry.length, 1);
    assert.equal(entry[0].sourceType, 'procurement_receipt'); assert.equal(entry[0].status, 'posted'); assert.equal(entry[0].direction, 'inbound');
    const movement = e.unrelatedBefore.movements.filter(row => row.batchNo === receipt.batchNo); assert.equal(movement.length, 1);
    assert.equal(movement[0].entryId, entry[0].id); assert.equal(Number(movement[0].quantityDelta), quantity); assert.equal(Number(movement[0].quantityBefore), 0); assert.equal(Number(movement[0].quantityAfter), quantity);
    const costs = e.unrelatedBefore.costs.filter(row => row.batchId === receipt.batchId); assert.equal(costs.length, 1);
    assert.equal(costs[0].sourceRef, entry[0].entryNo); assert.equal(Number(costs[0].quantityDelta), quantity); assert.equal(money(costs[0].costAmountDelta), BigInt(quantity) * 7150n);
  }
  assert.equal(e.unrelatedBefore.entries.length, 2); assert.equal(e.unrelatedBefore.movements.length, 2); assert.equal(e.unrelatedBefore.costs.length, 2);
  assert.deepEqual(e.unrelatedAfter, e.unrelatedBefore, 'QC/payment changed receipt, stock, inventory cost or customer AR');
  const pre = e.preQA;
  assert.equal(pre.purchaseReceiptId, receiptId); assert.equal(pre.currency, 'USD'); assert.equal(money(pre.payableAmountNative), 1001n); assert.equal(money(pre.payableAmountBase), 7150n);
  assert.equal(money(pre.paidAmountNative), 0n); assert.equal(money(pre.paidAmountBase), 0n); assert.equal(money(pre.outstandingAmountNative), 1001n); assert.equal(money(pre.outstandingAmountBase), 7150n);
  assert.deepEqual(pre.payments, []); assert.deepEqual(pre.paymentEligibility, { eligible: false, reason: 'INCOMING_QA_RELEASE_REQUIRED' });
  const firstSubmission = data(e.concurrentDraft[0]).submission, first = firstSubmission.payment;
  const finance1 = id(first.submittedByUserId), finance2 = id(data(e.concurrentVerify[0]).verification.verifiedByUserId);
  assert.notEqual(finance1, finance2);
  for (const [responses, property, status] of [[e.concurrentDraft, 'submission', 201], [e.concurrentVerify, 'verification', 200]]) {
    assert.equal(responses.length, 2); assert(responses.every(row => row.status === status));
    assert.deepEqual(responses.map(row => data(row).replayed).sort(), [false, true]);
    assert.deepEqual(data(responses[0])[property], data(responses[1])[property]);
  }
  const checks = [e.failedQC, e.passingQC, e.retestQC].map(item => item.submission.inspection);
  const reviews = [e.failedDecision.review, e.release.review, e.retestRelease.review];
  for (const [index, inspection] of checks.entries()) {
    const submission = [e.failedQC, e.passingQC, e.retestQC][index].submission;
    assert.equal(submission.schema, 'incoming-quality-submission/v1'); id(submission.auditId);
    assert.equal(inspection.purchaseReceiptId, receiptId); assert.equal(inspection.revision, index + 1);
    assert.equal(inspection.result, index === 0 ? 'fail' : 'pass'); assert.equal(inspection.planHash, textHash(r1.incomingQualityPlanJson));
    assert.equal(inspection.measurements.length, 1); const measurement = inspection.measurements[0];
    assert.equal(measurement.code, 'PH'); assert.equal(measurement.lowerLimit, '7'); assert.equal(measurement.upperLimit, '8');
    assert.equal(measurement.testMethod, standard.testMethod); assert.equal(measurement.result, inspection.result);
    assert.equal(measurement.measuredNumeric, ['6.5', '7.5', '7.6'][index]); assert(measurement.instrumentNo);
    const submitted = e.requests.filter(row => row.method === 'POST' && row.endpoint === `/procurement/receipts/${receiptId}/quality-checks` && row.status === 201 && row.key === submission.key);
    assert.equal(submitted.length, 1); const req = submitted[0];
    assert.equal(req.actorId, inspection.inspectorUserId); assert.equal(inspection.sampleNo, req.data.sampleNo);
    const normalizedMeasurements = req.data.measurements.map(value => ({ ...value,
      measuredNumeric: value.measuredNumeric.replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1') }));
    assert.equal(submission.fingerprint, hash({ schema: 'incoming-quality-facts/v1', purchaseReceiptId: receiptId, inspectorUserId: req.actorId,
      sampleNo: req.data.sampleNo, measurements: normalizedMeasurements, note: req.data.note }));
    const review = reviews[index]; assert.equal(review.checkId, inspection.id); assert.equal(review.purchaseReceiptId, receiptId); assert.equal(review.revision, index + 1);
    assert.equal(review.decision, index === 0 ? 'rejected' : 'released'); assert.notEqual(review.reviewedByUserId, inspection.inspectorUserId);
    assert.equal(review.reviewedByUserId, setup.approverId); assert.equal(review.inspectionHash, hash(inspection)); id(review.auditId);
  }
  const stages = e.qualityStages;
  assert.deepEqual(stages.map(s => s.label), ['failed-qc-quarantined', 'passing-retest-held', 'independent-qa-released', 'new-retest-held', 'old-qa-replay-still-held', 'latest-qa-released']);
  for (const [stageIndex, stage] of stages.entries()) {
    assert.equal(stage.batch.id, r1.batchId); assert.equal(stage.batch.batchNo, r1.batchNo); assert.equal(Number(stage.batch.stockQuantity), 1); assert.equal(stage.batch.unit, 'kg');
    assert.equal(stage.batch.qualityStatus, ['quarantine', 'hold', 'released', 'hold', 'hold', 'released'][stageIndex]);
    const expectedStatuses = [['rejected'], ['rejected', 'submitted'], ['rejected', 'released'], ['rejected', 'released', 'submitted'], ['rejected', 'released', 'submitted'], ['rejected', 'released', 'released']][stageIndex];
    assert.deepEqual(stage.checks.map(row => row.status), expectedStatuses);
    let expectedAudits = 0;
    for (const [index, row] of stage.checks.entries()) {
      const submission = [e.failedQC, e.passingQC, e.retestQC][index].submission, inspection = checks[index];
      assert.equal(row.id, inspection.id); assert.equal(row.purchaseReceiptId, receiptId); assert.equal(row.revision, index + 1);
      assert.equal(row.requestKey, submission.key); assert.equal(row.fingerprint, submission.fingerprint); assert.deepEqual(JSON.parse(row.submissionJson), submission);
      assert.deepEqual(JSON.parse(row.measurementsJson), inspection.measurements); assert.equal(row.inspectorUserId, inspection.inspectorUserId); assert.equal(row.result, inspection.result);
      for (const key of ['checkNo', 'sampleNo', 'note', 'checkedAt']) assert.equal(row[key], inspection[key], `Original QC ${key}`);
      const qa = row.status !== 'submitted', submissionAudit = stage.audits.find(a => a.id === submission.auditId); assert(submissionAudit); expectedAudits++;
      assert.equal(submissionAudit.userId, inspection.inspectorUserId); assert.equal(submissionAudit.action, 'CREATE_INCOMING_QC'); assert.equal(submissionAudit.resource, 'incoming_quality'); assert.equal(submissionAudit.resourceId, row.id);
      assert.deepEqual(JSON.parse(submissionAudit.details), { schema: 'incoming-quality-submit-audit/v1', requestKeyHash: textHash(submission.key), fingerprint: submission.fingerprint,
        inspectionHash: hash(inspection), purchaseReceiptId: receiptId });
      if (qa) {
        const review = reviews[index], { auditId: ignoredId, ...reviewFacts } = review; id(ignoredId);
        assert.deepEqual(JSON.parse(row.reviewJson), review); assert.equal(row.reviewedByUserId, review.reviewedByUserId); assert.equal(row.decision, review.decision);
        assert.equal(row.reviewedAt, review.reviewedAt); assert.equal(row.reviewNote, review.reason);
        const reviewAudit = stage.audits.find(a => a.id === review.auditId); assert(reviewAudit); expectedAudits++;
        assert.equal(reviewAudit.userId, review.reviewedByUserId); assert.equal(reviewAudit.action, 'REVIEW_INCOMING_QC'); assert.equal(reviewAudit.resource, 'incoming_quality'); assert.equal(reviewAudit.resourceId, row.id);
        assert.deepEqual(JSON.parse(reviewAudit.details), { schema: 'incoming-quality-review-audit/v1', reviewHash: hash(reviewFacts), checkId: row.id, purchaseReceiptId: receiptId });
      } else { assert.equal(row.reviewJson, null); assert.equal(row.reviewedByUserId, null); assert.equal(row.decision, null);
        assert.equal(row.reviewedAt, null); assert.equal(row.reviewNote, null); }
    }
    assert.equal(stage.audits.length, expectedAudits); assert.equal(new Set(stage.audits.map(a => a.id)).size, expectedAudits);
    if (stageIndex > 0) {
      for (const prior of stages[stageIndex - 1].audits) assert.deepEqual(stage.audits.find(a => a.id === prior.id), prior, 'A later QC/QA action rewrote historical audit facts');
      const { qualityStatus: ignoredQuality, updatedAt: ignoredTime, ...batch } = stage.batch;
      const { qualityStatus: previousQuality, updatedAt: previousTime, ...priorBatch } = stages[0].batch;
      assert(ignoredQuality && previousQuality); assert(ignoredTime && previousTime); assert.deepEqual(batch, priorBatch, 'QC changed physical batch facts');
    }
  }
  assert.deepEqual(stages[4], { ...stages[3], label: stages[4].label }, 'Old QA replay changed the new held revision');
  assert.deepEqual(e.qualityReadback.plan, plan); assert.equal(e.qualityReadback.receipt.qualityStatus, 'released');
  assert.deepEqual(e.qualityReadback.qualityChecks.map(row => [row.id, row.status, row.result]), [[checks[1].id, 'released', 'pass'], [checks[0].id, 'rejected', 'fail']]);
  require('./purchase-quality-payables-browser-proof.cjs').assertRedactedQuality(e.qualityReadback);
  assert.equal(e.originalPaymentReplay.replayed, true); assert.deepEqual(e.originalPaymentReplay.verification, data(e.concurrentVerify[0]).verification);
  assert.equal(e.oldQaReplay.replayed, true); assert.deepEqual(e.oldQaReplay.review, e.release.review);
  assert.equal(e.corruptedHistoricalQa.status, 409); assert.equal(e.corruptedHistoricalQa.json.errorCode, 'INCOMING_QUALITY_EVIDENCE_INVALID');
  assert.equal(e.unknownCandidate.purchaseReceiptId, receiptId); assert.equal(e.unknownCandidate.state, 'history_unreconciled');
  assert.equal(e.unknownCandidate.payableAmountNative, null); assert.equal(e.unknownCandidate.outstandingAmountNative, null);
  assert.equal(e.cancellation.replayed, false); assert.equal(e.cancelReplay.replayed, true); assert.deepEqual(e.cancelReplay.cancellation, e.cancellation.cancellation);
  assert.deepEqual(e.afterAuditFault, e.beforeAuditFault, 'An unavailable payment audit left a partial commit');
  const rows = e.finalDatabase.rows, audits = e.finalDatabase.audits;
  assert.equal(rows.length, 4); assert.equal(new Set(rows.map(row => row.id)).size, 4); assert.deepEqual(rows.map(row => row.status), ['verified', 'verified', 'cancelled', 'verified']);
  assert.equal(audits.length, 8); assert.equal(new Set(audits.map(row => row.id)).size, 8);
  const findAudit = (auditId, paymentId, actorId, action) => {
    const found = audits.filter(row => row.id === auditId); assert.equal(found.length, 1); const a = found[0];
    assert.equal(a.resource, 'supplier_payment'); assert.equal(a.resourceId, paymentId); assert.equal(a.userId, actorId); assert.equal(a.action, action); return JSON.parse(a.details);
  };
  let paidNative = 0n, paidBase = 0n;
  for (const [index, row] of rows.entries()) {
    const submission = JSON.parse(row.submissionJson), payment = submission.payment, decision = JSON.parse(row.verificationJson);
    assert.equal(row.purchaseReceiptId, receiptId); assert.equal(row.submittedByUserId, finance1);
    assert.equal(submission.schema, 'supplier-payment-submission/v1'); assert.equal(submission.status, 'draft');
    assert.equal(submission.key, row.requestKey); assert.equal(submission.fingerprint, row.fingerprint);
    for (const [key, value] of Object.entries(payment)) {
      if (['amountNative', 'baseAmount'].includes(key)) assert.equal(money(row[key]), money(value)); else assert.deepEqual(row[key], value, `Immutable payment ${key}`);
    }
    assert.equal(money(payment.amountNative), [100n, 100n, 801n, 801n][index]); assert.equal(money(payment.baseAmount), [714n, 715n, 5721n, 5721n][index]);
    const facts = { purchaseReceiptId: receiptId, submittedByUserId: finance1, amountNative: payment.amountNative, currency: payment.currency,
      method: payment.method, date: payment.date, paymentAccountRef: payment.paymentAccountRef, externalTransactionRef: payment.externalTransactionRef, evidenceRef: payment.evidenceRef, note: payment.note };
    assert.equal(submission.fingerprint, hash({ schema: 'supplier-payment-facts/v1', ...facts }));
    assert.equal(payment.currency, 'USD'); assert.equal(submission.allocationBasis.payableSnapshotJson, r1.payableSnapshotJson);
    assert.equal(submission.allocationBasis.receiptSubmissionHash, hash(e.unrelatedBefore.receipts.find(r => r.id === receiptId).submissionJson));
    assert.equal(money(submission.allocationBasis.paidAmountNativeBefore), paidNative); assert.equal(money(submission.allocationBasis.paidAmountBaseBefore), paidBase);
    assert.deepEqual(findAudit(submission.auditId, row.id, finance1, 'SUPPLIER_PAYMENT_DRAFTED'), { schema: 'supplier-payment-submit-audit/v1', paymentId: row.id,
      purchaseReceiptId: receiptId, submissionKeyHash: textHash(submission.key), fingerprint: submission.fingerprint, paymentHash: hash(payment), allocationHash: hash(submission.allocationBasis) });
    const { auditId: ignoredAuditId, ...decisionFacts } = decision; id(ignoredAuditId);
    assert.equal(decision.paymentId, row.id); assert.equal(decision.purchaseReceiptId, receiptId); assert.equal(decision.draftAuditId, submission.auditId);
    const verified = row.status === 'verified', actor = verified ? finance2 : finance1;
    assert.deepEqual(findAudit(decision.auditId, row.id, actor, verified ? 'SUPPLIER_PAYMENT_VERIFIED' : 'SUPPLIER_PAYMENT_CANCELLED'), {
      schema: 'supplier-payment-decision-audit/v1', paymentId: row.id, purchaseReceiptId: receiptId, decisionHash: hash(decisionFacts) });
    if (verified) {
      assert.equal(decision.schema, 'supplier-payment-verification/v1'); assert.equal(row.verifiedByUserId, finance2); assert.equal(decision.verifiedByUserId, finance2);
      assert.equal(decision.submittedByUserId, finance1); assert.equal(row.verifiedAt, decision.verifiedAt);
      const qcIndex = index === 0 ? 1 : 2; assert.equal(decision.qualityCheckId, checks[qcIndex].id); assert.equal(decision.qualityRevision, qcIndex + 1); assert.equal(decision.qualityReviewerUserId, reviews[qcIndex].reviewedByUserId);
      assert.equal(money(decision.amountNative), money(payment.amountNative)); assert.equal(money(decision.baseAmount), money(payment.baseAmount));
      assert.equal(money(decision.paidAmountNativeBefore), paidNative); assert.equal(money(decision.paidAmountBaseBefore), paidBase);
      paidNative += money(payment.amountNative); paidBase += money(payment.baseAmount);
      assert.equal(paidBase, (paidNative * 7150n + 1001n / 2n) / 1001n);
      assert.equal(money(decision.paidAmountNativeAfter), paidNative); assert.equal(money(decision.paidAmountBaseAfter), paidBase);
    } else {
      assert.equal(decision.schema, 'supplier-payment-cancellation/v1'); assert.equal(decision.cancelledByUserId, finance1); assert(decision.reason.length >= 3);
      assert.equal(row.verifiedByUserId, null); assert.equal(row.verifiedAt, null); assert.deepEqual(decision, e.cancellation.cancellation);
    }
  }
  assert.equal(paidNative, 1001n); assert.equal(paidBase, 7150n);
  assert.equal(rows[2].paymentAccountRef, rows[3].paymentAccountRef); assert.equal(rows[2].externalTransactionRef, rows[3].externalTransactionRef);
  assert.equal(e.beforeAuditFault.rows.find(row => row.id === rows[3].id).status, 'draft');
  assert.equal(e.beforeAuditFault.audits.filter(row => row.action === 'SUPPLIER_PAYMENT_VERIFIED').length, 2);
  assert.deepEqual(e.finalReadbacks[0], e.finalReadbacks[1]); assert.equal(e.finalReadbacks.length, 2);
  for (const b of e.finalReadbacks) {
    assert.equal(b.purchaseReceiptId, receiptId); assert.equal(b.currency, 'USD');
    for (const [name, expected] of [['payableAmountNative', 1001n], ['payableAmountBase', 7150n], ['paidAmountNative', 1001n], ['paidAmountBase', 7150n], ['outstandingAmountNative', 0n], ['outstandingAmountBase', 0n]]) assert.equal(money(b[name]), expected);
    assert.equal(b.payments.length, 4);
    for (const row of rows) { const dto = b.payments.find(p => p.id === row.id); assert(dto); assert.equal(dto.status, row.status);
      assert.deepEqual(dto.submission, JSON.parse(row.submissionJson)); assert.deepEqual(dto[row.status === 'verified' ? 'verification' : 'cancellation'], JSON.parse(row.verificationJson)); }
  }
  const reqs = e.requests, paymentPath = `/procurement/receipts/${receiptId}/payments`, qcPath = `/procurement/receipts/${receiptId}/quality-checks`;
  assert.equal(reqs.length, 45, 'Missing actual API operations');
  const expect = (index, method, endpoint, status, actorId, instance, errorCode) => {
    const row = reqs[index]; assert.equal(row.method, method); assert.equal(row.endpoint, endpoint); assert.equal(row.status, status); assert.equal(row.actorId, actorId);
    if (instance !== null) assert.equal(row.instance, instance);
    assert.equal(row.json.success, status < 400); if (errorCode) assert.equal(row.json.errorCode, errorCode); return row;
  };
  for (const index of [0, 1]) { const req = expect(index, 'POST', `/procurement/orders/${po}/receipts`, 201, setup.buyerId, 0);
    assert.deepEqual(data(req).submission, [e.receipt1, e.receipt2][index].submission); assert.equal(req.key, data(req).submission.key); assert.equal(req.data.expectedRevision, setup.created.revision); }
  expect(2, 'GET', paymentPath, 200, finance1, 0); assert.deepEqual(data(reqs[2]), e.preQA);
  for (const index of [3, 4]) { expect(index, 'POST', paymentPath, 201, finance1, null); assert.equal(reqs[index].key, firstSubmission.key); assert.equal(reqs[index].data.amountNative, 1); }
  assert.deepEqual(reqs.slice(3, 5).map(r => r.instance).sort(), [0, 1]);
  for (const req of reqs.slice(3, 5)) assert.deepEqual(req.json.data, e.concurrentDraft[req.instance].json.data);
  expect(5, 'POST', paymentPath, 409, finance1, 0, 'SUPPLIER_PAYMENT_KEY_CONFLICT'); assert.equal(reqs[5].data.amountNative, 2); assert.equal(reqs[5].key, firstSubmission.key);
  expect(6, 'POST', paymentPath, 409, finance2, 0, 'SUPPLIER_PAYMENT_KEY_CONFLICT'); assert.equal(reqs[6].key, firstSubmission.key);
  expect(7, 'POST', paymentPath, 409, finance1, 0, 'SUPPLIER_PAYMENT_DRAFT_PENDING');
  expect(8, 'POST', `/procurement/supplier-payments/${first.id}/verify`, 403, finance1, 0, 'SUPPLIER_PAYMENT_SELF_VERIFY_FORBIDDEN');
  expect(9, 'POST', `/procurement/supplier-payments/${first.id}/verify`, 409, finance2, 1, 'INCOMING_QA_RELEASE_REQUIRED');
  const qcActor = checks[1].inspectorUserId;
  expect(10, 'GET', paymentPath, 403, qcActor, 0); expect(11, 'GET', paymentPath, 200, finance1, 0); assert.equal(money(data(reqs[11]).paidAmountNative), 0n);
  expect(12, 'POST', qcPath, 201, checks[0].inspectorUserId, 0);
  expect(13, 'POST', `/procurement/quality-checks/${checks[0].id}/review`, 409, setup.approverId, 1, 'INCOMING_QA_FAILED_INSPECTION');
  expect(14, 'POST', `/procurement/quality-checks/${checks[0].id}/review`, 409, checks[0].inspectorUserId, 1, 'INCOMING_QA_INDEPENDENT_REVIEWER_REQUIRED');
  for (const [index, qcIndex] of [[15, 0], [17, 1], [30, 2]]) { expect(index, 'POST', `/procurement/quality-checks/${checks[qcIndex].id}/review`, 200, setup.approverId, 1);
    assert.deepEqual(data(reqs[index]).review, reviews[qcIndex]); assert.equal(reqs[index].data.expectedRevision, qcIndex + 1); assert.equal(reqs[index].data.decision, reviews[qcIndex].decision); }
  expect(16, 'POST', qcPath, 201, qcActor, 0); expect(18, 'GET', `/procurement/receipts/${receiptId}/quality`, 200, qcActor, 0); assert.deepEqual(data(reqs[18]), e.qualityReadback);
  for (const index of [19, 20]) expect(index, 'POST', `/procurement/supplier-payments/${first.id}/verify`, 200, finance2, null);
  assert.deepEqual(reqs.slice(19, 21).map(r => r.instance).sort(), [0, 1]);
  for (const req of reqs.slice(19, 21)) assert.deepEqual(req.json.data, e.concurrentVerify[req.instance].json.data);
  expect(21, 'GET', paymentPath, 200, finance1, 0); assert.equal(money(data(reqs[21]).paidAmountBase), 714n);
  expect(22, 'POST', qcPath, 201, qcActor, 0); assert.equal(reqs[16].data.measurements[0].measuredNumeric, '7.5000');
  expect(23, 'POST', `/procurement/supplier-payments/${first.id}/verify`, 200, finance2, 1); assert.deepEqual(data(reqs[23]), e.originalPaymentReplay);
  expect(24, 'GET', paymentPath, 409, finance1, 0, 'INCOMING_QUALITY_EVIDENCE_INVALID'); assert.deepEqual(reqs[24], { ...reqs[24], ...e.corruptedHistoricalQa });
  expect(25, 'GET', '/procurement/payables?pageSize=50', 200, finance1, 0); assert.deepEqual(data(reqs[25]).items.find(row => row.purchaseReceiptId === receiptId), e.unknownCandidate);
  expect(26, 'POST', `/procurement/quality-checks/${checks[1].id}/review`, 200, setup.approverId, 1); assert.deepEqual(data(reqs[26]), e.oldQaReplay);
  expect(27, 'GET', paymentPath, 200, finance1, 0); assert.equal(data(reqs[27]).paymentEligibility.eligible, false);
  expect(28, 'POST', paymentPath, 201, finance1, 1);
  expect(29, 'POST', `/procurement/supplier-payments/${rows[1].id}/verify`, 409, finance2, 0, 'INCOMING_QA_RELEASE_REQUIRED');
  expect(31, 'POST', `/procurement/supplier-payments/${rows[1].id}/verify`, 200, finance2, 0);
  expect(32, 'POST', paymentPath, 201, finance1, 0);
  expect(33, 'POST', `/procurement/supplier-payments/${rows[2].id}/cancel`, 403, finance2, 0, 'SUPPLIER_PAYMENT_CANCEL_SCOPE_DENIED');
  for (const [index, instance] of [[34, 0], [35, 1]]) { expect(index, 'POST', `/procurement/supplier-payments/${rows[2].id}/cancel`, 200, finance1, instance); assert.deepEqual(data(reqs[index]).cancellation, e.cancellation.cancellation); }
  expect(36, 'POST', `/procurement/supplier-payments/${rows[2].id}/cancel`, 409, finance1, 0, 'SUPPLIER_PAYMENT_CANCEL_CONFLICT');
  expect(37, 'POST', paymentPath, 201, finance1, 1);
  expect(38, 'POST', `/procurement/supplier-payments/${rows[3].id}/verify`, 500, finance2, 1);
  expect(39, 'POST', `/procurement/supplier-payments/${rows[3].id}/verify`, 200, finance2, 1);
  expect(40, 'POST', `/procurement/supplier-payments/${rows[3].id}/cancel`, 409, finance1, 0, 'SUPPLIER_PAYMENT_VERIFIED_CANNOT_CANCEL');
  expect(41, 'POST', paymentPath, 409, finance1, 0, 'SUPPLIER_PAYMENT_EXCEEDS_PAYABLE'); assert.equal(reqs[41].data.amountNative, 0.01);
  expect(42, 'POST', `/procurement/receipts/${otherReceiptId}/payments`, 409, finance1, 1, 'SUPPLIER_PAYMENT_BANK_TRANSACTION_DUPLICATE');
  assert.equal(reqs[42].data.paymentAccountRef, first.paymentAccountRef); assert.equal(reqs[42].data.externalTransactionRef, first.externalTransactionRef);
  assert.deepEqual(reqs.slice(43, 45).map(r => r.instance).sort(), [0, 1]);
  for (const index of [43, 44]) { expect(index, 'GET', paymentPath, 200, finance1, null); assert.deepEqual(data(reqs[index]), e.finalReadbacks[reqs[index].instance]); }
  for (const [requestIndex, rowIndex] of [[3, 0], [4, 0], [28, 1], [32, 2], [37, 3]]) {
    const req = reqs[requestIndex], submission = JSON.parse(rows[rowIndex].submissionJson);
    assert.deepEqual(data(req).submission, submission); assert.equal(req.key, submission.key);
    for (const name of ['currency', 'method', 'paymentAccountRef', 'externalTransactionRef', 'evidenceRef', 'note']) assert.equal(req.data[name], submission.payment[name]);
    assert.equal(fixed(req.data.amountNative), submission.payment.amountNative); assert.equal(`${req.data.date}T00:00:00.000Z`, submission.payment.date);
  }
  return { receipts: 2, acceptedQuantity: 3, payableAmountNative: '30.03', payableAmountBase: '214.50', verifiedPayments: 3,
    cancelledDrafts: 1, paidAmountNative: '10.01', paidAmountBase: '71.50', requestCount: 45 };
}
module.exports = { purchaseQualityPayablesApiProbe, verifyPurchaseQualityPayablesApiProof, readSupplierPaymentSnapshot };
