const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { assertCjkRasterEvidence } = require('./browser-cjk-font-guard.cjs');
const plain = value => JSON.parse(JSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const cents = value => { const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(String(value)); assert(match, `Invalid actual money ${value}`);
  return BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0')); };
const definitions = {
  qc: { permissions: ['dashboard.read', 'procurement.quality.inspect'], dataScopes: ['procurement_visible'] },
  qa: { permissions: ['dashboard.read', 'procurement.quality.release'], dataScopes: ['procurement_visible'] },
  recorder: { permissions: ['finance.read', 'procurement.payment.record'], dataScopes: ['finance_visible', 'procurement_visible'] },
  verifier: { permissions: ['finance.read', 'procurement.payment.verify'], dataScopes: ['finance_visible', 'procurement_visible'] },
};
const profile = value => ({ id: Number(value.id), role: value.role, permissions: [...value.permissions].sort(), dataScopes: [...value.dataScopes].sort() });
const deniedOperations = (receiptId, checkId, paymentId) => [
  ...['qc', 'qa'].flatMap(job => [['orders', '/procurement/orders', 'procurement.read'], ['suppliers', '/procurement/suppliers', 'procurement.suppliers.read'],
    ['payables', '/procurement/payables', 'finance.read'], ['payment-details', `/procurement/receipts/${receiptId}/payments`, 'finance.read']]
    .map(([operation, endpoint, permission]) => ({ phase: 'before', job, operation, endpoint, method: 'GET', permission }))),
  { phase: 'before', job: 'verifier', operation: 'record-payment', endpoint: `/procurement/receipts/${receiptId}/payments`, method: 'POST', permission: 'procurement.payment.record' },
  { phase: 'qc', job: 'qc', operation: 'review-qc', endpoint: `/procurement/quality-checks/${checkId}/review`, method: 'POST', permission: 'procurement.quality.release' },
  { phase: 'qc', job: 'qa', operation: 'submit-qc', endpoint: `/procurement/receipts/${receiptId}/quality-checks`, method: 'POST', permission: 'procurement.quality.inspect' },
  { phase: 'owner', job: 'recorder', operation: 'verify-own-payment', endpoint: `/procurement/supplier-payments/${paymentId}/verify`, method: 'POST', permission: 'procurement.payment.verify' },
].flatMap(row => [0, 1].map(instance => ({ ...row, instance })));

function assertRedactedQuality(value) {
  for (const [key, child] of Object.entries(value || {})) {
    assert(!['price', 'amountNative', 'amountBase', 'payableAmountNative', 'payableAmountBase', 'payableSnapshotJson',
      'supplierPayableBasisJson', 'binding', 'requestKey', 'submissionJson', 'reviewJson', 'fingerprint', 'auditId'].includes(key), `Private QC field ${key}`);
    if (child && typeof child === 'object') assertRedactedQuality(child);
  }
}
function verifyPurchaseQualityBrowserProof(raw) {
  const e = plain(raw);
  assert.equal(e.version, 'purchase-quality-payables-browser/v1');
  const receipt = e.seed.receipt, receiptId = receipt.id, actors = Object.fromEntries(e.actors.map(a => [a.job, a]));
  assert.deepEqual(e.actors.map(a => a.job), Object.keys(definitions)); assert.equal(new Set(e.actors.map(a => a.id)).size, 4);
  assert.equal(new Set(e.actors.map(a => a.role)).size, 4);
  for (const [job, definition] of Object.entries(definitions)) {
    const actor = actors[job]; assert(actor.id > 0); assert(!['admin', 'manager', 'warehouse', 'finance'].includes(actor.role));
    assert.deepEqual([...actor.permissions].sort(), [...definition.permissions].sort());
    assert.deepEqual([...actor.dataScopes].sort(), [...definition.dataScopes].sort());
    assert(e.browserProfiles.filter(p => p.job === job).length >= 1);
    for (const observed of e.browserProfiles.filter(p => p.job === job)) {
      assert.equal(observed.status, 200); assert.equal(observed.endpoint, '/api/auth/me');
      assert.deepEqual(profile(observed.actual), profile(actor));
    }
  }
  assert.equal(receipt.payableAmountNative, '20.02'); assert.equal(receipt.payableAmountBase, '143.00');
  assert.equal(receipt.acceptedQuantity, 2); assert.equal(receipt.batchNo, `PO-${receipt.purchaseOrderId}-RCV-${receipt.receiptNo}`);
  const rawReceipt = e.before.receipts.find(r => r.id === receiptId); assert(rawReceipt);
  for (const [key, value] of Object.entries(receipt)) {
    if (['payableAmountNative', 'payableAmountBase'].includes(key)) assert.equal(cents(rawReceipt[key]), cents(value));
    else assert.deepEqual(rawReceipt[key], value, `Seed receipt ${key} is not the actual typed database row`);
  }
  assert.deepEqual(JSON.parse(rawReceipt.submissionJson).receipt, receipt);
  assert.deepEqual(e.before.receipts.find(r => r.id === receiptId), e.after.receipts.find(r => r.id === receiptId));
  assert.deepEqual(e.afterDenied, e.before); assert.deepEqual(e.afterQcDenied, e.afterQC); assert.deepEqual(e.afterOwnerDenied, e.afterOwner);
  const expectedDenials = deniedOperations(receiptId, e.qcWrite.body.data.submission.inspection.id, e.lostAck.ownerResponse.body.data.payment.id);
  assert.deepEqual(e.denied.map(({ phase, job, operation, endpoint, method, permission, instance }) => ({ phase, job, operation, endpoint, method, permission, instance })), expectedDenials);
  for (const row of e.denied) { assert.equal(row.status, 403); assert.equal(row.body.success, false); assert.deepEqual(row.body.requiredPermissions, [row.permission]); }
  for (const snapshot of [e.afterQC, e.afterQA, e.afterOwner, e.afterReadback, e.after]) {
    for (const name of ['order', 'receipts', 'balances', 'entries', 'movements', 'costs', 'customerPayments', 'receivableAdjustments']) {
      assert.deepEqual(snapshot[name], e.before[name], `${name} was reposted by QC or supplier payment`);
    }
    const batch = snapshot.batches.find(b => b.id === receipt.batchId);
    assert.equal(batch.stockQuantity, 2); assert.equal(batch.unit, 'kg');
    for (const original of e.before.batches) {
      if (original.id !== receipt.batchId) assert.deepEqual(snapshot.batches.find(b => b.id === original.id), original);
      else { const prior = { ...original }, next = { ...batch }; delete prior.qualityStatus; delete prior.updatedAt;
        delete next.qualityStatus; delete next.updatedAt; assert.deepEqual(next, prior); }
    }
  }
  assert.equal(e.before.qualityChecks.length, 0); assert.equal(e.before.payments.length, 0);
  assert.equal(e.before.batches.find(b => b.id === receipt.batchId).qualityStatus, 'hold');
  const qc = e.qcWrite, qa = e.qaWrite, submission = qc.body.data.submission, inspection = submission.inspection, review = qa.body.data.review;
  assert.equal(qc.status, 201); assert.equal(qc.endpoint, `/api/procurement/receipts/${receiptId}/quality-checks`);
  assert.equal(qc.method, 'POST'); assert.equal(qc.instance, 0); assert.equal(qc.actorId, actors.qc.id);
  assert.equal(qc.body.data.replayed, false); assert.equal(inspection.purchaseReceiptId, receiptId); assert.equal(inspection.inspectorUserId, actors.qc.id);
  assert.equal(inspection.revision, 1); assert.equal(inspection.result, 'pass'); assert.equal(inspection.sampleNo, qc.request.sampleNo);
  assert.equal(submission.key, qc.requestKey); assert.equal(inspection.planHash, hash(receipt.incomingQualityPlanJson));
  assert.deepEqual(qc.request.measurements, [{ code: 'PH', unit: null, measuredNumeric: '7.5', measuredText: null, instrumentNo: `${e.runId}-browser-PH-1` }]);
  assert.equal(submission.fingerprint, hash({ schema: 'incoming-quality-facts/v1', purchaseReceiptId: receiptId, inspectorUserId: actors.qc.id,
    sampleNo: qc.request.sampleNo, measurements: qc.request.measurements, note: qc.request.note }));
  const plan = JSON.parse(receipt.incomingQualityPlanJson).plan;
  assert.equal(e.frozenStandardText, `冻结标准：${plan.specificationRef} / ${plan.specificationRevision}`);
  assert.equal(plan.characteristics.length, 1); assert.equal(plan.characteristics[0].code, 'PH');
  assert.equal(plan.characteristics[0].lowerLimit, '7'); assert.equal(plan.characteristics[0].upperLimit, '8');
  const measured = inspection.measurements[0]; assert.equal(measured.measuredNumeric, '7.5'); assert.equal(measured.result, 'pass');
  assert.equal(measured.lowerLimit, '7'); assert.equal(measured.upperLimit, '8'); assert.equal(measured.testMethod, plan.characteristics[0].testMethod);
  assert.equal(qa.status, 200); assert.equal(qa.method, 'POST'); assert.equal(qa.instance, 1); assert.equal(qa.actorId, actors.qa.id);
  assert.equal(qa.endpoint, `/api/procurement/quality-checks/${inspection.id}/review`);
  assert.deepEqual(qa.request, { expectedRevision: 1, decision: 'released', reason: review.reason });
  assert.equal(review.checkId, inspection.id); assert.equal(review.purchaseReceiptId, receiptId); assert.equal(review.reviewedByUserId, actors.qa.id);
  assert.equal(review.decision, 'released'); assert.equal(review.inspectionHash, hash(inspection));
  assert.equal(e.afterQC.batches.find(b => b.id === receipt.batchId).qualityStatus, 'hold');
  assert.equal(e.afterQA.batches.find(b => b.id === receipt.batchId).qualityStatus, 'released');
  assert.equal(e.afterQA.qualityChecks.length, 1); const rawCheck = e.afterQA.qualityChecks[0];
  assert.equal(rawCheck.inspectorUserId, actors.qc.id); assert.equal(rawCheck.reviewedByUserId, actors.qa.id);
  assert.equal(rawCheck.status, 'released'); assert.deepEqual(JSON.parse(rawCheck.submissionJson), submission); assert.deepEqual(JSON.parse(rawCheck.reviewJson), review);
  assert.deepEqual(JSON.parse(rawCheck.measurementsJson), inspection.measurements);
  const audit = (id, userId, action, resource, resourceId) => { const row = e.after.audits.find(a => a.id === id); assert(row);
    assert.deepEqual({ userId: row.userId, action: row.action, resource: row.resource, resourceId: row.resourceId }, { userId, action, resource, resourceId }); return JSON.parse(row.details); };
  assert.deepEqual(audit(submission.auditId, actors.qc.id, 'CREATE_INCOMING_QC', 'incoming_quality', inspection.id), {
    schema: 'incoming-quality-submit-audit/v1', requestKeyHash: hash(submission.key), fingerprint: submission.fingerprint,
    inspectionHash: hash(inspection), purchaseReceiptId: receiptId });
  const reviewFacts = { ...review }; delete reviewFacts.auditId;
  assert.deepEqual(audit(review.auditId, actors.qa.id, 'REVIEW_INCOMING_QC', 'incoming_quality', inspection.id), {
    schema: 'incoming-quality-review-audit/v1', reviewHash: hash(reviewFacts), checkId: inspection.id, purchaseReceiptId: receiptId });
  const recovery = e.lostAck, first = recovery.firstRequest, owner = recovery.ownerResponse, payment = owner.body.data.submission.payment, paymentSubmission = owner.body.data.submission;
  assert.equal(first.method, 'POST'); assert.equal(first.instance, 0); assert.equal(first.endpoint, `/api/procurement/receipts/${receiptId}/payments`);
  assert.equal(owner.status, 201); assert.equal(owner.body.data.replayed, false); assert.equal(paymentSubmission.key, first.requestKey);
  assert.equal(first.request.amountNative, 2); assert.equal(first.request.currency, 'USD'); assert.equal(payment.amountNative, '2.00'); assert.equal(payment.baseAmount, '14.29');
  assert.equal(cents(payment.baseAmount), (200n * 14300n + 2002n / 2n) / 2002n);
  assert.equal(payment.submittedByUserId, actors.recorder.id); assert.equal(payment.purchaseReceiptId, receiptId);
  assert.equal(payment.paymentAccountRef, first.request.paymentAccountRef); assert.equal(payment.externalTransactionRef, first.request.externalTransactionRef);
  assert.equal(payment.evidenceRef, first.request.evidenceRef); assert.equal(payment.method, first.request.method); assert.equal(payment.date, `${first.request.date}T00:00:00.000Z`); assert.equal(payment.note, first.request.note);
  assert.equal(paymentSubmission.fingerprint, hash({ schema: 'supplier-payment-facts/v1', purchaseReceiptId: receiptId, submittedByUserId: actors.recorder.id,
    amountNative: '2.00', currency: 'USD', method: payment.method, date: payment.date, paymentAccountRef: payment.paymentAccountRef,
    externalTransactionRef: payment.externalTransactionRef, evidenceRef: payment.evidenceRef, note: payment.note }));
  assert.equal(paymentSubmission.allocationBasis.payableSnapshotJson, receipt.payableSnapshotJson);
  // supplierPaymentHash uses JSON serialization even for a string. The receipt
  // journal hash is not the raw-text hash used for QC plans or idempotency keys.
  assert.equal(paymentSubmission.allocationBasis.receiptSubmissionHash, hash(JSON.stringify(rawReceipt.submissionJson)));
  assert.equal(paymentSubmission.allocationBasis.paidAmountNativeBefore, '0.00'); assert.equal(paymentSubmission.allocationBasis.paidAmountBaseBefore, '0.00');
  assert.equal(e.afterOwner.payments.length, 1); assert.equal(e.afterOwner.payments[0].status, 'draft'); assert.deepEqual(e.afterReadback, e.afterOwnerDenied);
  assert.deepEqual(recovery.beforeRefreshIntent, recovery.intentAtReadbackDelivery); assert.equal(recovery.afterReadbackIntent, null);
  assert.equal(recovery.beforeRefreshIntent.key, first.requestKey); assert.equal(recovery.beforeRefreshIntent.userId, String(actors.recorder.id));
  assert.equal(recovery.beforeRefreshIntent.receiptId, String(receiptId)); assert.equal(recovery.beforeRefreshIntent.facts.amountNative, '2.00');
  assert.equal(recovery.disabledFieldCount, 7); assert.equal(recovery.editableFieldsBeforeReadback, 0); assert.equal(recovery.realReload, true);
  assert.deepEqual(recovery.fieldValues, ['2.00', first.request.date, first.request.method, first.request.paymentAccountRef, first.request.externalTransactionRef, first.request.evidenceRef, first.request.note]);
  const clocks = recovery.transportOrderNs.map(BigInt); assert.equal(clocks.length, 4); assert(clocks.every((value, i) => !i || value > clocks[i - 1]));
  assert.equal(recovery.independentReadback.status, 200); assert.equal(recovery.independentReadback.body.data.payments.length, 1);
  assert.deepEqual(recovery.independentReadback.body.data.payments[0].submission, paymentSubmission);
  assert.equal(e.browserRequests.filter(r => r.job === 'recorder' && r.method === 'POST' && r.endpoint === first.endpoint).length, 1);
  assert.deepEqual(audit(paymentSubmission.auditId, actors.recorder.id, 'SUPPLIER_PAYMENT_DRAFTED', 'supplier_payment', payment.id), {
    schema: 'supplier-payment-submit-audit/v1', paymentId: payment.id, purchaseReceiptId: receiptId, submissionKeyHash: hash(first.requestKey),
    fingerprint: paymentSubmission.fingerprint, paymentHash: hash(payment), allocationHash: hash(paymentSubmission.allocationBasis) });
  const verify = e.verifyWrite, decision = verify.body.data.verification;
  assert.equal(verify.status, 200); assert.equal(verify.method, 'POST'); assert.equal(verify.instance, 1); assert.equal(verify.actorId, actors.verifier.id);
  assert.equal(verify.endpoint, `/api/procurement/supplier-payments/${payment.id}/verify`); assert.deepEqual(verify.request, {});
  assert.equal(decision.verifiedByUserId, actors.verifier.id); assert.equal(decision.submittedByUserId, actors.recorder.id);
  assert.equal(decision.qualityCheckId, inspection.id); assert.equal(decision.qualityRevision, 1); assert.equal(decision.qualityReviewerUserId, actors.qa.id);
  assert.equal(decision.amountNative, '2.00'); assert.equal(decision.baseAmount, '14.29'); assert.equal(decision.paymentId, payment.id); assert.equal(decision.draftAuditId, paymentSubmission.auditId);
  const verificationFacts = { ...decision }; delete verificationFacts.auditId;
  assert.deepEqual(audit(decision.auditId, actors.verifier.id, 'SUPPLIER_PAYMENT_VERIFIED', 'supplier_payment', payment.id), {
    schema: 'supplier-payment-decision-audit/v1', paymentId: payment.id, purchaseReceiptId: receiptId, decisionHash: hash(verificationFacts) });
  assert.equal(e.after.payments.length, 1); const rawPayment = e.after.payments[0]; assert.equal(rawPayment.status, 'verified');
  assert.equal(rawPayment.id, payment.id); assert.equal(rawPayment.purchaseReceiptId, receiptId);
  assert.equal(rawPayment.requestKey, first.requestKey); assert.equal(cents(rawPayment.amountNative), 200n); assert.equal(cents(rawPayment.baseAmount), 1429n);
  assert.equal(rawPayment.submittedByUserId, actors.recorder.id); assert.equal(rawPayment.verifiedByUserId, actors.verifier.id);
  assert.deepEqual(JSON.parse(rawPayment.submissionJson), paymentSubmission); assert.deepEqual(JSON.parse(rawPayment.verificationJson), decision);
  assert.equal(e.after.audits.filter(a => a.resource === 'supplier_payment' && a.resourceId === payment.id).length, 2);
  assert.equal(e.after.audits.filter(a => a.resource === 'incoming_quality' && a.resourceId === inspection.id).length, 2);
  for (const rows of [e.readbacks.quality, e.readbacks.payments]) assert.deepEqual(rows.map(r => r.instance), [0, 1]);
  assert.deepEqual(e.readbacks.quality[0].data, e.readbacks.quality[1].data); assert.deepEqual(e.readbacks.payments[0].data, e.readbacks.payments[1].data);
  for (const row of e.readbacks.quality) { assertRedactedQuality(row.data); assert.deepEqual(row.data.plan, plan);
    assert.equal(row.data.receipt.qualityStatus, 'released'); assert.equal(row.data.qualityChecks[0].id, inspection.id);
    assert.equal(row.data.qualityChecks[0].reviewedByUserId, actors.qa.id); }
  for (const row of e.readbacks.payments) { const b = row.data; assert.equal(b.payableAmountNative, '20.02'); assert.equal(b.payableAmountBase, '143.00');
    assert.equal(b.paidAmountNative, '2.00'); assert.equal(b.paidAmountBase, '14.29'); assert.equal(b.outstandingAmountNative, '18.02'); assert.equal(b.outstandingAmountBase, '128.71');
    assert.equal(b.payments.length, 1); assert.equal(b.payments[0].id, payment.id); assert.equal(b.paymentEligibility.eligible, true); }
  for (const request of e.browserRequests.filter(r => ['qc', 'qa'].includes(r.job))) {
    assert(!/^\/api\/(orders|suppliers|finance|collections)(\/|$)/.test(request.endpoint));
    assert(!/^\/api\/procurement\/(orders|suppliers|payables|supplier-payments)(\/|$)/.test(request.endpoint));
    assert(!/^\/api\/procurement\/receipts\/\d+\/payments$/.test(request.endpoint));
  }
  assert.deepEqual(e.screenshots.map(s => s.job), Object.keys(definitions));
  for (const shot of e.screenshots) { assert(shot.screenshot.endsWith('.png')); assert.equal(shot.actorId, actors[shot.job].id);
    assert.equal(shot.dialogCount, 0); assert.equal(shot.unobscured, true); assert(shot.text.includes(receipt.receiptNo)); assertCjkRasterEvidence(shot.font);
    if (['recorder', 'verifier'].includes(shot.job)) assert.deepEqual(shot.amounts, [
      { label: '实收应付', text: '20.02 USD 143.00 CNY账面' }, { label: '已核实外部付款', text: '2.00 USD 14.29 CNY账面' },
      { label: '未核销应付', text: '18.02 USD 128.71 CNY账面' },
    ]); }
  assert.deepEqual(recovery.unknownScreenshot.amounts, [
    { label: '实收应付', text: '20.02 USD 143.00 CNY账面' }, { label: '已核实外部付款', text: '0.00 USD 0.00 CNY账面' },
    { label: '未核销应付', text: '20.02 USD 143.00 CNY账面' },
  ], 'An unverified committed draft must not be displayed as paid');
  assert.deepEqual(e.errors, []); assert(e.expectedTransportErrors.length >= 1);
  for (const r of e.expectedTransportErrors) { assert.equal(r.job, 'recorder'); assert.equal(r.endpoint, first.endpoint);
    assert(/net::ERR_(FAILED|CONNECTION_FAILED)/.test(r.message));
    if (r.kind === 'console') assert.equal(new URL(r.locationUrl).pathname, first.endpoint);
    else { assert.equal(r.kind, 'requestfailed'); assert.equal(r.method, 'POST'); } }
  const reloadStart = BigInt(recovery.reloadWindowStartNs), reloadEnd = BigInt(recovery.reloadWindowEndNs); assert(reloadEnd > reloadStart);
  for (const r of e.recoveryCancelledTelemetry) { assert.equal(r.job, 'recorder'); assert.equal(r.method, 'POST'); assert.equal(r.endpoint, '/api/rum/vitals');
    assert.equal(r.message, 'net::ERR_ABORTED'); assert.equal(r.duringForcedReload, true); assert(BigInt(r.observedNs) > reloadStart && BigInt(r.observedNs) < reloadEnd); }
  return true;
}
module.exports = { definitions, deniedOperations, assertRedactedQuality, verifyPurchaseQualityBrowserProof };
