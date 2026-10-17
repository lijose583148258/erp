const crypto = require('node:crypto');
const copy = value => JSON.parse(JSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const textHash = value => crypto.createHash('sha256').update(value).digest('hex');

// Entirely synthetic verifier input, not runtime, browser, database or cloud proof.
function purchaseQualityPayablesApiProofFixture(provider = 'sqlite') {
  const date = '2026-10-14T00:00:00.000Z', buyer = 5, approver = 6, recorder = 3, verifier = 4, qc = 7;
  const binding = { revision: 0, supplierId: 1, materialId: 1, unit: 'kg', quantity: 3, price: 10.01, currency: 'USD', exchangeRate: 0.14 };
  const terms = { evidenceRef: 'SYNTHETIC-QUOTE', taxTreatment: 'none_or_third_party', supplierTaxAmount: 0, supplierChargesAmount: 0 };
  const plan = { specificationRef: 'SYNTHETIC-SPEC', specificationRevision: 'R1', characteristics: [{ code: 'PH', name: 'pH', valueType: 'numeric', unit: null,
    lowerLimit: '7', upperLimit: '8', targetText: null, testMethod: 'Synthetic calibrated meter', required: true, sortOrder: 0 }] };
  const quoteJson = JSON.stringify({ schema: 'supplier-payable-basis/v1', binding, terms, amountNative: 30.03, amountBase: 214.5 });
  const planJson = JSON.stringify({ schema: 'purchase-incoming-quality/v1', binding, plan });
  const created = { id: '1', status: 'pending', revision: 0, supplierPayableBasisJson: quoteJson, incomingQualityPlanJson: planJson };
  const approved = { ...created, status: 'approved' };
  const ok = (data, status = 200) => ({ status, json: { success: true, data } });
  const e = { version: 'purchase-quality-payables-api/v1', provider, requests: [],
    setup: { buyerId: buyer, approverId: approver, created, approved, creationRequest: { ...binding, status: 'pending', supplierPayableTerms: terms, incomingQualityPlan: plan },
      creationResponse: ok(created, 201), approvalRequest: { status: 'approved', expectedRevision: 0 }, approvalResponse: ok(approved) },
    receiptAudits: [
      { id: 10, userId: buyer, action: 'CREATE', resource: 'purchase_order', resourceId: 1, details: JSON.stringify({ schema: 'purchase-create/v1', after: created,
        source: { supplierPayableHash: textHash(quoteJson), incomingQualityHash: textHash(planJson) } }) },
      { id: 11, userId: approver, action: 'STATUS_CHANGE', resource: 'purchase_order', resourceId: 1, details: JSON.stringify({ schema: 'purchase-status/v2', revision: 0,
        from: 'pending', to: 'approved', isSourceApproval: true, sourceAuditId: 10, supplierPayableHash: textHash(quoteJson), incomingQualityHash: textHash(planJson) }) },
    ], unrelatedBefore: { receipts: [], entries: [], movements: [], costs: [], customerPayments: [], financeAdjustments: [] } };
  for (const quantity of [1, 2]) {
    const receiptNo = `SYNTHETIC-R${quantity}`, batchNo = `PO-1-RCV-${receiptNo}`;
    const payableSnapshotJson = JSON.stringify({ schema: 'purchase-receipt-payable/v1', purchaseOrderId: 1, receiptNo, supplierBatchNo: 'SYNTHETIC-SUPPLIER-LOT', batchNo,
      source: { sourceAuditId: 10, approvalAuditId: 11, supplierPayableBasisJson: quoteJson }, allocation: { amountNative: quantity === 1 ? '10.01' : '20.02', amountBase: quantity === 1 ? '71.50' : '143.00' } });
    const receipt = { id: quantity, purchaseOrderId: 1, receiptNo, quantity, acceptedQuantity: quantity, rejectedQuantity: 0, unit: 'kg', batchNo, stockEntryRef: batchNo,
      supplierBatchNo: 'SYNTHETIC-SUPPLIER-LOT', batchId: 20 + quantity, payableAmountNative: quantity === 1 ? '10.01' : '20.02',
      payableAmountBase: quantity === 1 ? '71.50' : '143.00', payableSnapshotJson, incomingQualityPlanJson: planJson };
    const facts = { purchaseOrderId: 1, receivedBy: buyer, quantity, acceptedQuantity: quantity, rejectedQuantity: 0,
      batchNo: receipt.supplierBatchNo, receivedAt: null, discrepancyReason: null, discrepancyType: 'short_shipped', note: null, expectedRevision: 0 };
    const submission = { schema: 'purchase-receipt-submission/v2', key: `synthetic-receipt-${quantity}`, fingerprint: hash({ schema: 'purchase-receipt-facts/v2', ...facts }), auditId: 11 + quantity, facts, receipt };
    e[`receipt${quantity}`] = { submission };
    e.unrelatedBefore.receipts.push({ ...receipt, submissionKey: submission.key, submissionFingerprint: submission.fingerprint, submissionJson: JSON.stringify(submission) });
    e.receiptAudits.push({ id: submission.auditId, userId: buyer, action: 'CREATE_RECEIPT', resource: 'purchase_order', resourceId: 1, details: JSON.stringify({
      schema: 'purchase-receipt-audit/v2', receiptId: receipt.id, receiptNo, submissionKeyHash: textHash(submission.key), fingerprint: submission.fingerprint, receiptHash: hash(receipt) }) });
    e.unrelatedBefore.entries.push({ id: quantity, entryNo: `SYNTHETIC-STK-${quantity}`, sourceRef: batchNo, sourceType: 'procurement_receipt', direction: 'inbound', status: 'posted' });
    e.unrelatedBefore.movements.push({ id: quantity, entryId: quantity, batchNo, quantityBefore: 0, quantityDelta: quantity, quantityAfter: quantity });
    e.unrelatedBefore.costs.push({ id: quantity, batchId: receipt.batchId, sourceRef: `SYNTHETIC-STK-${quantity}`, quantityDelta: quantity, costAmountDelta: quantity * 71.5 });
  }
  const receipt = e.receipt1.submission.receipt;
  e.unrelatedAfter = copy(e.unrelatedBefore);
  e.preQA = { purchaseReceiptId: 1, currency: 'USD', payableAmountNative: '10.01', payableAmountBase: '71.50', paidAmountNative: '0.00', paidAmountBase: '0.00',
    outstandingAmountNative: '10.01', outstandingAmountBase: '71.50', paymentEligibility: { eligible: false, reason: 'INCOMING_QA_RELEASE_REQUIRED' }, payments: [] };
  const qcRequests = [], qualityRows = [], qcAudits = [], qaAudits = [];
  for (const [index, numeric] of ['6.5', '7.5000', '7.6'].entries()) {
    const normalized = numeric === '7.5000' ? '7.5' : numeric, inspectorUserId = index === 0 ? 1 : qc, revision = index + 1;
    const request = { sampleNo: `SYNTHETIC-SAMPLE-${revision}`, measurements: [{ code: 'PH', unit: null, measuredNumeric: numeric, measuredText: null, instrumentNo: 'SYNTHETIC-METER' }], note: 'Synthetic QC input' };
    qcRequests.push(request);
    const { sortOrder: ignoredSort, ...characteristic } = plan.characteristics[0]; if (ignoredSort !== 0) throw Error('Synthetic plan');
    const inspection = { id: 30 + index, checkNo: `SYNTHETIC-QC-${revision}`, purchaseReceiptId: 1, revision, sampleNo: request.sampleNo,
      measurements: [{ ...characteristic, ...request.measurements[0], measuredNumeric: normalized, result: index === 0 ? 'fail' : 'pass' }], note: request.note,
      inspectorUserId, checkedAt: date, result: index === 0 ? 'fail' : 'pass', planHash: textHash(planJson) };
    const submission = { schema: 'incoming-quality-submission/v1', key: `synthetic-qc-${revision}`, fingerprint: hash({ schema: 'incoming-quality-facts/v1', purchaseReceiptId: 1,
      inspectorUserId, sampleNo: request.sampleNo, measurements: [{ ...request.measurements[0], measuredNumeric: normalized }], note: request.note }), auditId: 50 + index * 2, inspection };
    const review = { schema: 'incoming-quality-review/v1', auditId: 51 + index * 2, checkId: inspection.id, purchaseReceiptId: 1, revision, decision: index === 0 ? 'rejected' : 'released',
      reviewedByUserId: approver, reviewedAt: date, reason: `Synthetic independent QA ${revision}`, inspectionHash: hash(inspection) };
    e[['failedQC', 'passingQC', 'retestQC'][index]] = { submission, replayed: false };
    e[['failedDecision', 'release', 'retestRelease'][index]] = { review, replayed: false };
    qualityRows.push({ id: inspection.id, checkNo: inspection.checkNo, sampleNo: inspection.sampleNo, note: inspection.note, checkedAt: inspection.checkedAt, purchaseReceiptId: 1, revision, requestKey: submission.key, fingerprint: submission.fingerprint, submissionJson: JSON.stringify(submission),
      measurementsJson: JSON.stringify(inspection.measurements), inspectorUserId, result: inspection.result, status: 'submitted', reviewJson: null, reviewedByUserId: null, reviewedAt: null, reviewNote: null, decision: null });
    qcAudits.push({ id: submission.auditId, userId: inspectorUserId, action: 'CREATE_INCOMING_QC', resource: 'incoming_quality', resourceId: inspection.id, details: JSON.stringify({
      schema: 'incoming-quality-submit-audit/v1', requestKeyHash: textHash(submission.key), fingerprint: submission.fingerprint, inspectionHash: hash(inspection), purchaseReceiptId: 1 }) });
    const { auditId: ignoredAudit, ...reviewFacts } = review; if (!ignoredAudit) throw Error('Synthetic QA');
    qaAudits.push({ id: review.auditId, userId: approver, action: 'REVIEW_INCOMING_QC', resource: 'incoming_quality', resourceId: inspection.id, details: JSON.stringify({
      schema: 'incoming-quality-review-audit/v1', reviewHash: hash(reviewFacts), checkId: inspection.id, purchaseReceiptId: 1 }) });
  }
  const reviews = [e.failedDecision.review, e.release.review, e.retestRelease.review];
  const releasedRow = index => ({ ...qualityRows[index], status: reviews[index].decision, reviewJson: JSON.stringify(reviews[index]), reviewedByUserId: approver,
    reviewedAt: reviews[index].reviewedAt, reviewNote: reviews[index].reason, decision: reviews[index].decision });
  e.qualityStages = [
    ['failed-qc-quarantined', 'quarantine', [true]], ['passing-retest-held', 'hold', [true, false]], ['independent-qa-released', 'released', [true, true]],
    ['new-retest-held', 'hold', [true, true, false]], ['old-qa-replay-still-held', 'hold', [true, true, false]], ['latest-qa-released', 'released', [true, true, true]],
  ].map(([label, qualityStatus, reviewed]) => ({ label, batch: { id: 21, batchNo: receipt.batchNo, stockQuantity: 1, unit: 'kg', qualityStatus, updatedAt: date },
    checks: reviewed.map((isReviewed, index) => isReviewed ? releasedRow(index) : qualityRows[index]), audits: reviewed.flatMap((isReviewed, index) => isReviewed ? [qcAudits[index], qaAudits[index]] : [qcAudits[index]]) }));
  e.qualityReadback = { receipt: { qualityStatus: 'released' }, plan, qualityChecks: [1, 0].map(index => ({ id: qualityRows[index].id, status: reviews[index].decision, result: qualityRows[index].result })) };
  e.oldQaReplay = { review: e.release.review, replayed: true };
  e.unknownCandidate = { purchaseReceiptId: 1, state: 'history_unreconciled', payableAmountNative: null, outstandingAmountNative: null };
  const paymentInputs = [], submissions = [], decisions = [], rows = [], audits = [];
  const native = ['1.00', '1.00', '8.01', '8.01'], base = ['7.14', '7.15', '57.21', '57.21'];
  let paidNative = '0.00', paidBase = '0.00';
  for (let index = 0; index < 4; index++) {
    const flow = ['FIRST', 'SECOND', 'FINAL', 'FINAL'][index], paymentId = 40 + index;
    const input = { amountNative: Number(native[index]), currency: 'USD', method: 'bank_transfer', date: date.slice(0, 10), paymentAccountRef: 'Synthetic-Account-MixedCase',
      externalTransactionRef: `Synthetic-${flow}`, evidenceRef: `SYNTHETIC-ARCHIVE-${flow}`, note: 'Synthetic external payment registration' }; paymentInputs.push(input);
    const payment = { id: paymentId, paymentNo: `SYNTHETIC-PAY-${index}`, purchaseReceiptId: 1, amountNative: native[index], currency: 'USD', baseAmount: base[index],
      method: input.method, date, paymentAccountRef: input.paymentAccountRef, externalTransactionRef: input.externalTransactionRef, evidenceRef: input.evidenceRef,
      note: input.note, submittedByUserId: recorder, createdAt: date };
    const facts = { purchaseReceiptId: 1, submittedByUserId: recorder, amountNative: payment.amountNative, currency: payment.currency, method: payment.method, date,
      paymentAccountRef: payment.paymentAccountRef, externalTransactionRef: payment.externalTransactionRef, evidenceRef: payment.evidenceRef, note: payment.note };
    const submission = { schema: 'supplier-payment-submission/v1', key: `synthetic-payment-${index}`, fingerprint: hash({ schema: 'supplier-payment-facts/v1', ...facts }),
      auditId: 100 + index * 2, status: 'draft', payment, allocationBasis: { payableSnapshotJson: receipt.payableSnapshotJson,
        receiptSubmissionHash: hash(e.unrelatedBefore.receipts[0].submissionJson), paidAmountNativeBefore: paidNative, paidAmountBaseBefore: paidBase } };
    submissions.push(submission);
    const cancelled = index === 2;
    const afterNative = ['1.00', '2.00', '2.00', '10.01'][index], afterBase = ['7.14', '14.29', '14.29', '71.50'][index];
    const decision = cancelled ? { schema: 'supplier-payment-cancellation/v1', paymentId, purchaseReceiptId: 1, cancelledByUserId: recorder, cancelledAt: date,
      reason: 'Synthetic corrected external advice', draftAuditId: submission.auditId, auditId: 101 + index * 2 } : { schema: 'supplier-payment-verification/v1', paymentId,
      purchaseReceiptId: 1, amountNative: payment.amountNative, baseAmount: payment.baseAmount, currency: 'USD', submittedByUserId: recorder, verifiedByUserId: verifier,
      verifiedAt: date, auditId: 101 + index * 2, draftAuditId: submission.auditId, qualityCheckId: index === 0 ? 31 : 32, qualityRevision: index === 0 ? 2 : 3,
      qualityReviewerUserId: approver, paidAmountNativeBefore: paidNative, paidAmountBaseBefore: paidBase, paidAmountNativeAfter: afterNative, paidAmountBaseAfter: afterBase };
    decisions.push(decision);
    rows.push({ ...payment, amountNative: Number(payment.amountNative), baseAmount: Number(payment.baseAmount), status: cancelled ? 'cancelled' : 'verified',
      requestKey: submission.key, fingerprint: submission.fingerprint, submissionJson: JSON.stringify(submission), verifiedByUserId: cancelled ? null : verifier,
      verifiedAt: cancelled ? null : date, verificationJson: JSON.stringify(decision) });
    const { auditId: ignoredId, ...decisionFacts } = decision; if (!ignoredId) throw Error('Synthetic payment audit');
    audits.push({ id: submission.auditId, userId: recorder, action: 'SUPPLIER_PAYMENT_DRAFTED', resource: 'supplier_payment', resourceId: paymentId, details: JSON.stringify({
      schema: 'supplier-payment-submit-audit/v1', paymentId, purchaseReceiptId: 1, submissionKeyHash: textHash(submission.key), fingerprint: submission.fingerprint, paymentHash: hash(payment), allocationHash: hash(submission.allocationBasis) }) },
    { id: decision.auditId, userId: cancelled ? recorder : verifier, action: cancelled ? 'SUPPLIER_PAYMENT_CANCELLED' : 'SUPPLIER_PAYMENT_VERIFIED', resource: 'supplier_payment', resourceId: paymentId,
      details: JSON.stringify({ schema: 'supplier-payment-decision-audit/v1', paymentId, purchaseReceiptId: 1, decisionHash: hash(decisionFacts) }) });
    paidNative = afterNative; paidBase = afterBase;
  }
  const dto = index => ({ ...submissions[index].payment, status: rows[index].status, submission: submissions[index],
    verification: index === 2 ? null : decisions[index], cancellation: index === 2 ? decisions[index] : null });
  e.finalDatabase = { rows, audits };
  e.beforeAuditFault = { rows: rows.map((row, index) => index === 3 ? { ...row, status: 'draft', verificationJson: null, verifiedByUserId: null, verifiedAt: null } : row), audits: audits.slice(0, -1) };
  e.afterAuditFault = copy(e.beforeAuditFault);
  e.finalReadbacks = [0, 1].map(() => ({ purchaseReceiptId: 1, currency: 'USD', payableAmountNative: '10.01', payableAmountBase: '71.50', paidAmountNative: '10.01', paidAmountBase: '71.50',
    outstandingAmountNative: '0.00', outstandingAmountBase: '0.00', payments: rows.map((_, index) => dto(index)) }));
  e.cancellation = { cancellation: decisions[2], replayed: false }; e.cancelReplay = { cancellation: decisions[2], replayed: true };
  const draft = (index, replayed = false) => ({ payment: { ...dto(index), status: 'draft', verification: null }, submission: submissions[index], replayed });
  const verified = (index, replayed = false) => ({ payment: dto(index), verification: decisions[index], replayed });
  const paymentPath = '/procurement/receipts/1/payments', qualityPath = '/procurement/receipts/1/quality-checks';
  const add = (method, endpoint, status, actorId, instance, body, input = null, key = null) => {
    const result = status < 400 ? ok(body, status) : { status, json: { success: false, ...(body ? { errorCode: body } : {}) } };
    const row = { endpoint, actorId, instance, method, data: input, key, ...result }; e.requests.push(row); return row;
  };
  const postDraft = (index, instance, replayed = false) => add('POST', paymentPath, 201, recorder, instance, draft(index, replayed), paymentInputs[index], submissions[index].key);
  const postVerify = (index, instance, replayed = false) => add('POST', `/procurement/supplier-payments/${40 + index}/verify`, 200, verifier, instance, verified(index, replayed), {});
  for (const n of [1, 2]) add('POST', '/procurement/orders/1/receipts', 201, buyer, 0, e[`receipt${n}`], { expectedRevision: 0 }, e[`receipt${n}`].submission.key);
  add('GET', paymentPath, 200, recorder, 0, e.preQA);
  e.concurrentDraft = [postDraft(0, 0), postDraft(0, 1, true)].map(copy);
  add('POST', paymentPath, 409, recorder, 0, 'SUPPLIER_PAYMENT_KEY_CONFLICT', { ...paymentInputs[0], amountNative: 2 }, submissions[0].key);
  add('POST', paymentPath, 409, verifier, 0, 'SUPPLIER_PAYMENT_KEY_CONFLICT', paymentInputs[0], submissions[0].key);
  add('POST', paymentPath, 409, recorder, 0, 'SUPPLIER_PAYMENT_DRAFT_PENDING', paymentInputs[0], 'synthetic-other-key');
  add('POST', '/procurement/supplier-payments/40/verify', 403, recorder, 0, 'SUPPLIER_PAYMENT_SELF_VERIFY_FORBIDDEN', {});
  add('POST', '/procurement/supplier-payments/40/verify', 409, verifier, 1, 'INCOMING_QA_RELEASE_REQUIRED', {});
  add('GET', paymentPath, 403, qc, 0); add('GET', paymentPath, 200, recorder, 0, { ...e.preQA, payments: [draft(0).payment] });
  add('POST', qualityPath, 201, 1, 0, e.failedQC, qcRequests[0], e.failedQC.submission.key);
  add('POST', '/procurement/quality-checks/30/review', 409, approver, 1, 'INCOMING_QA_FAILED_INSPECTION', {});
  add('POST', '/procurement/quality-checks/30/review', 409, 1, 1, 'INCOMING_QA_INDEPENDENT_REVIEWER_REQUIRED', {});
  const review = index => add('POST', `/procurement/quality-checks/${30 + index}/review`, 200, approver, 1, { review: reviews[index], replayed: false }, { expectedRevision: index + 1, decision: reviews[index].decision, reason: reviews[index].reason });
  review(0); add('POST', qualityPath, 201, qc, 0, e.passingQC, qcRequests[1], e.passingQC.submission.key); review(1);
  add('GET', '/procurement/receipts/1/quality', 200, qc, 0, e.qualityReadback);
  e.concurrentVerify = [postVerify(0, 0), postVerify(0, 1, true)].map(copy);
  add('GET', paymentPath, 200, recorder, 0, { ...e.preQA, paidAmountBase: '7.14' });
  add('POST', qualityPath, 201, qc, 0, e.retestQC, qcRequests[2], e.retestQC.submission.key);
  e.originalPaymentReplay = verified(0, true); postVerify(0, 1, true);
  e.corruptedHistoricalQa = add('GET', paymentPath, 409, recorder, 0, 'INCOMING_QUALITY_EVIDENCE_INVALID');
  add('GET', '/procurement/payables?pageSize=50', 200, recorder, 0, { items: [e.unknownCandidate] });
  add('POST', '/procurement/quality-checks/31/review', 200, approver, 1, e.oldQaReplay, { expectedRevision: 2, decision: 'released', reason: reviews[1].reason });
  add('GET', paymentPath, 200, recorder, 0, { ...e.preQA, paymentEligibility: { eligible: false } }); postDraft(1, 1);
  add('POST', '/procurement/supplier-payments/41/verify', 409, verifier, 0, 'INCOMING_QA_RELEASE_REQUIRED', {}); review(2); postVerify(1, 0); postDraft(2, 0);
  add('POST', '/procurement/supplier-payments/42/cancel', 403, verifier, 0, 'SUPPLIER_PAYMENT_CANCEL_SCOPE_DENIED', {});
  add('POST', '/procurement/supplier-payments/42/cancel', 200, recorder, 0, e.cancellation, { reason: decisions[2].reason });
  add('POST', '/procurement/supplier-payments/42/cancel', 200, recorder, 1, e.cancelReplay, { reason: decisions[2].reason });
  add('POST', '/procurement/supplier-payments/42/cancel', 409, recorder, 0, 'SUPPLIER_PAYMENT_CANCEL_CONFLICT', {}); postDraft(3, 1);
  add('POST', '/procurement/supplier-payments/43/verify', 500, verifier, 1, 'SUPPLIER_PAYMENT_INTERNAL_ERROR', {}); postVerify(3, 1);
  add('POST', '/procurement/supplier-payments/43/cancel', 409, recorder, 0, 'SUPPLIER_PAYMENT_VERIFIED_CANNOT_CANCEL', {});
  add('POST', paymentPath, 409, recorder, 0, 'SUPPLIER_PAYMENT_EXCEEDS_PAYABLE', { ...paymentInputs[0], amountNative: 0.01 });
  add('POST', '/procurement/receipts/2/payments', 409, recorder, 1, 'SUPPLIER_PAYMENT_BANK_TRANSACTION_DUPLICATE', paymentInputs[0]);
  for (const instance of [0, 1]) add('GET', paymentPath, 200, recorder, instance, e.finalReadbacks[instance]);
  return copy(e);
}
module.exports = { purchaseQualityPayablesApiProofFixture };
