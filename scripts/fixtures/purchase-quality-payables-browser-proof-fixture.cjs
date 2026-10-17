const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { definitions, deniedOperations } = require('../lib/purchase-quality-payables-browser-proof.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

// Entirely synthetic contract data: no browser, database, CJK raster, screenshot,
// cloud or business-obligation acceptance is represented by these unit cases.
function fixture(receiptOverride) {
  const runId = 'synthetic-browser-contract', receiptId = 2, checkId = 30, paymentId = 40;
  const actors = Object.entries(definitions).map(([job, d], index) => ({ job, id: 101 + index, role: `synthetic_${job}`, ...copy(d) }));
  const people = Object.fromEntries(actors.map(a => [a.job, a]));
  const plan = receiptOverride ? JSON.parse(receiptOverride.incomingQualityPlanJson).plan : { specificationRef: 'SYNTHETIC-SPEC', specificationRevision: 'R1', characteristics: [{ code: 'PH', name: 'pH', valueType: 'numeric',
    unit: null, lowerLimit: '7', upperLimit: '8', targetText: null, testMethod: 'Synthetic calibrated pH meter', required: true, sortOrder: 0 }] };
  const receipt = receiptOverride ? copy(receiptOverride) : { id: receiptId, purchaseOrderId: 1, receiptNo: 'SYNTHETIC-R2', quantity: 2, acceptedQuantity: 2, rejectedQuantity: 0,
    unit: 'kg', batchNo: 'PO-1-RCV-SYNTHETIC-R2', supplierBatchNo: 'SYNTHETIC-SUPPLIER-LOT', batchId: 22,
    payableAmountNative: '20.02', payableAmountBase: '143.00', incomingQualityPlanJson: JSON.stringify({ schema: 'purchase-incoming-quality/v1', plan }),
    payableSnapshotJson: JSON.stringify({ schema: 'purchase-receipt-payable/v1', currency: 'USD', allocation: { amountNative: '20.02', amountBase: '143.00' } }) };
  const request = { sampleNo: 'SYNTHETIC-SAMPLE', measurements: [{ code: 'PH', unit: null, measuredNumeric: '7.5', measuredText: null, instrumentNo: `${runId}-browser-PH-1` }],
    note: 'Synthetic contract measurement' };
  const { sortOrder: ignoredSortOrder, ...characteristic } = plan.characteristics[0]; assert.equal(ignoredSortOrder, 0);
  const measured = { ...characteristic, measuredNumeric: '7.5', measuredText: null, instrumentNo: `${runId}-browser-PH-1`, result: 'pass' };
  const inspection = { id: checkId, checkNo: 'SYNTHETIC-IQC', purchaseReceiptId: receiptId, revision: 1, sampleNo: request.sampleNo, measurements: [measured],
    note: request.note, inspectorUserId: people.qc.id, checkedAt: '2026-10-14T01:00:00.000Z', result: 'pass', planHash: hash(receipt.incomingQualityPlanJson) };
  const qcSubmission = { schema: 'incoming-quality-submission/v1', key: 'synthetic-qc-key', fingerprint: hash({ schema: 'incoming-quality-facts/v1', purchaseReceiptId: receiptId,
    inspectorUserId: people.qc.id, sampleNo: request.sampleNo, measurements: request.measurements, note: request.note }), auditId: 10, inspection };
  const reason = 'Synthetic independent QA contract', reviewFacts = { schema: 'incoming-quality-review/v1', checkId, purchaseReceiptId: receiptId, revision: 1,
    decision: 'released', reviewedByUserId: people.qa.id, reviewedAt: '2026-10-14T01:01:00.000Z', reason, inspectionHash: hash(inspection) };
  const review = { ...reviewFacts, auditId: 11 };
  const rawCheck = { id: checkId, checkNo: inspection.checkNo, purchaseReceiptId: receiptId, revision: 1, status: 'submitted', result: 'pass', sampleNo: request.sampleNo,
    measurementsJson: JSON.stringify(inspection.measurements), note: request.note, inspectorUserId: people.qc.id, checkedAt: inspection.checkedAt,
    requestKey: qcSubmission.key, fingerprint: qcSubmission.fingerprint, submissionJson: JSON.stringify(qcSubmission), reviewedByUserId: null, reviewedAt: null,
    reviewNote: null, decision: null, reviewJson: null };
  const qcAudit = { id: 10, userId: people.qc.id, action: 'CREATE_INCOMING_QC', resource: 'incoming_quality', resourceId: checkId, details: JSON.stringify({
    schema: 'incoming-quality-submit-audit/v1', requestKeyHash: hash(qcSubmission.key), fingerprint: qcSubmission.fingerprint, inspectionHash: hash(inspection), purchaseReceiptId: receiptId }) };
  const qaAudit = { id: 11, userId: people.qa.id, action: 'REVIEW_INCOMING_QC', resource: 'incoming_quality', resourceId: checkId,
    details: JSON.stringify({ schema: 'incoming-quality-review-audit/v1', reviewHash: hash(reviewFacts), checkId, purchaseReceiptId: receiptId }) };
  const paymentRequest = { amountNative: 2, currency: 'USD', method: 'bank_transfer', date: '2026-10-14', paymentAccountRef: 'Synthetic-Account-MixedCase',
    externalTransactionRef: 'Synthetic-Advice-MixedCase', evidenceRef: 'SYNTHETIC-ARCHIVE', note: 'Synthetic contract payment evidence' };
  const payment = { id: paymentId, paymentNo: 'SYNTHETIC-SP', purchaseReceiptId: receiptId, amountNative: '2.00', currency: 'USD', baseAmount: '14.29',
    method: paymentRequest.method, date: `${paymentRequest.date}T00:00:00.000Z`, paymentAccountRef: paymentRequest.paymentAccountRef,
    externalTransactionRef: paymentRequest.externalTransactionRef, evidenceRef: paymentRequest.evidenceRef, note: paymentRequest.note,
    submittedByUserId: people.recorder.id, createdAt: '2026-10-14T01:02:00.000Z' };
  const receiptJournal = JSON.stringify({ schema: 'purchase-receipt-submission/v2', receipt });
  const allocationBasis = { payableSnapshotJson: receipt.payableSnapshotJson, receiptSubmissionHash: hash(JSON.stringify(receiptJournal)), paidAmountNativeBefore: '0.00', paidAmountBaseBefore: '0.00' };
  const paymentFacts = { purchaseReceiptId: receiptId, submittedByUserId: people.recorder.id, amountNative: '2.00', currency: 'USD', method: payment.method,
    date: payment.date, paymentAccountRef: payment.paymentAccountRef, externalTransactionRef: payment.externalTransactionRef, evidenceRef: payment.evidenceRef, note: payment.note };
  const paymentSubmission = { schema: 'supplier-payment-submission/v1', key: 'synthetic-payment-key', fingerprint: hash({ schema: 'supplier-payment-facts/v1', ...paymentFacts }),
    payment, allocationBasis, auditId: 12, status: 'draft' };
  const verificationFacts = { schema: 'supplier-payment-verification/v1', paymentId, purchaseReceiptId: receiptId, amountNative: '2.00', baseAmount: '14.29', currency: 'USD',
    submittedByUserId: people.recorder.id, verifiedByUserId: people.verifier.id, verifiedAt: '2026-10-14T01:03:00.000Z', draftAuditId: 12,
    qualityCheckId: checkId, qualityRevision: 1, qualityReviewerUserId: people.qa.id, paidAmountNativeBefore: '0.00', paidAmountBaseBefore: '0.00',
    paidAmountNativeAfter: '2.00', paidAmountBaseAfter: '14.29' };
  const verification = { ...verificationFacts, auditId: 13 };
  const paymentAudit = { id: 12, userId: people.recorder.id, action: 'SUPPLIER_PAYMENT_DRAFTED', resource: 'supplier_payment', resourceId: paymentId,
    details: JSON.stringify({ schema: 'supplier-payment-submit-audit/v1', paymentId, purchaseReceiptId: receiptId, submissionKeyHash: hash(paymentSubmission.key),
      fingerprint: paymentSubmission.fingerprint, paymentHash: hash(payment), allocationHash: hash(allocationBasis) }) };
  const verifyAudit = { id: 13, userId: people.verifier.id, action: 'SUPPLIER_PAYMENT_VERIFIED', resource: 'supplier_payment', resourceId: paymentId,
    details: JSON.stringify({ schema: 'supplier-payment-decision-audit/v1', paymentId, purchaseReceiptId: receiptId, decisionHash: hash(verificationFacts) }) };
  const before = { order: { id: 1, status: 'received' }, receipts: [{ ...receipt, submissionJson: receiptJournal }], batches: [{ id: 22, stockQuantity: 2, unit: 'kg', qualityStatus: 'hold', updatedAt: '2026-10-14T00:00:00.000Z' }],
    balances: [{ id: 1, quantity: 2 }], entries: [{ id: 1 }], movements: [{ id: 1, quantityDelta: 2 }], costs: [{ id: 1, costAmountDelta: 143 }],
    customerPayments: [], receivableAdjustments: [], qualityChecks: [], payments: [], audits: [] };
  const afterQC = copy(before); afterQC.qualityChecks.push(rawCheck); afterQC.audits.push(qcAudit);
  const afterQA = copy(afterQC); Object.assign(afterQA.qualityChecks[0], { status: 'released', reviewedByUserId: people.qa.id, reviewedAt: review.reviewedAt,
    reviewNote: reason, decision: 'released', reviewJson: JSON.stringify(review) }); afterQA.batches[0].qualityStatus = 'released'; afterQA.audits.push(qaAudit);
  const afterOwner = copy(afterQA); afterOwner.payments.push({ ...payment, status: 'draft', requestKey: paymentSubmission.key, fingerprint: paymentSubmission.fingerprint,
    submissionJson: JSON.stringify(paymentSubmission), verifiedByUserId: null, verifiedAt: null, verificationJson: null }); afterOwner.audits.push(paymentAudit);
  const after = copy(afterOwner); Object.assign(after.payments[0], { status: 'verified', verifiedByUserId: people.verifier.id,
    verifiedAt: verification.verifiedAt, verificationJson: JSON.stringify(verification) }); after.audits.push(verifyAudit);
  const dto = { ...payment, status: 'verified', verifiedByUserId: people.verifier.id, verifiedAt: verification.verifiedAt, submission: paymentSubmission, verification, cancellation: null };
  const paymentRead = { purchaseReceiptId: receiptId, currency: 'USD', payableAmountNative: '20.02', payableAmountBase: '143.00', paidAmountNative: '2.00', paidAmountBase: '14.29',
    outstandingAmountNative: '18.02', outstandingAmountBase: '128.71', paymentEligibility: { eligible: true, reason: null }, payments: [dto] };
  const qualityRead = { receipt: { id: receiptId, receiptNo: receipt.receiptNo, qualityStatus: 'released' }, plan,
    qualityChecks: [{ id: checkId, revision: 1, reviewedByUserId: people.qa.id }] };
  const pending = { schema: 'supplier-payment-intent/v1', userId: String(people.recorder.id), receiptId: String(receiptId), key: paymentSubmission.key,
    facts: { ...paymentRequest, amountNative: '2.00' } };
  const path = `/api/procurement/receipts/${receiptId}/payments`;
  const font = { glyphs: Array.from('采购版本变更数量').map((character, index) => ({ character, signature: `synthetic-${index}`, inkPixels: 1 })), missingSignatures: ['synthetic-missing-1', 'synthetic-missing-2'] };
  return { version: 'purchase-quality-payables-browser/v1', runId, seed: { receipt }, actors, frozenStandardText: `冻结标准：${plan.specificationRef} / ${plan.specificationRevision}`,
    browserProfiles: actors.map(a => ({ job: a.job, status: 200, endpoint: '/api/auth/me', actual: a })),
    browserRequests: [{ job: 'recorder', method: 'POST', endpoint: path }], denied: deniedOperations(receiptId, checkId, paymentId).map(d => ({ ...d, status: 403, body: { success: false, requiredPermissions: [d.permission] } })),
    before, afterDenied: copy(before), afterQC, afterQcDenied: copy(afterQC), afterQA, afterOwner, afterOwnerDenied: copy(afterOwner), afterReadback: copy(afterOwner), after,
    qcWrite: { endpoint: `/api/procurement/receipts/${receiptId}/quality-checks`, actorId: people.qc.id, method: 'POST', instance: 0,
      status: 201, requestKey: qcSubmission.key, request, body: { success: true, data: { submission: qcSubmission, replayed: false } } },
    qaWrite: { endpoint: `/api/procurement/quality-checks/${checkId}/review`, actorId: people.qa.id, method: 'POST', instance: 1, status: 200,
      request: { expectedRevision: 1, decision: 'released', reason }, body: { success: true, data: { review, replayed: false } } },
    lostAck: { firstRequest: { instance: 0, method: 'POST', endpoint: path, requestKey: paymentSubmission.key, request: paymentRequest },
      ownerResponse: { status: 201, body: { success: true, data: { payment: { ...dto, status: 'draft', verification: null }, submission: paymentSubmission, replayed: false } } },
      beforeRefreshIntent: pending, intentAtReadbackDelivery: copy(pending), afterReadbackIntent: null, disabledFieldCount: 7, editableFieldsBeforeReadback: 0, realReload: true,
      fieldValues: ['2.00', paymentRequest.date, paymentRequest.method, paymentRequest.paymentAccountRef, paymentRequest.externalTransactionRef, paymentRequest.evidenceRef, paymentRequest.note],
      transportOrderNs: ['1', '2', '5', '6'], reloadWindowStartNs: '3', reloadWindowEndNs: '4', unknownScreenshot: { amounts: [
        { label: '实收应付', text: '20.02 USD 143.00 CNY账面' }, { label: '已核实外部付款', text: '0.00 USD 0.00 CNY账面' },
        { label: '未核销应付', text: '20.02 USD 143.00 CNY账面' },
      ] }, independentReadback: { status: 200, body: { data: { payments: [{ ...dto, status: 'draft', verification: null }] } } } },
    verifyWrite: { endpoint: `/api/procurement/supplier-payments/${paymentId}/verify`, method: 'POST', instance: 1, actorId: people.verifier.id,
      status: 200, request: {}, body: { data: { payment: dto, verification, replayed: false } } },
    readbacks: { quality: [0, 1].map(instance => ({ instance, data: copy(qualityRead) })), payments: [0, 1].map(instance => ({ instance, data: copy(paymentRead) })) },
    screenshots: actors.map(a => ({ job: a.job, actorId: a.id, screenshot: `synthetic-${a.job}.png`, dialogCount: 0, unobscured: true, text: receipt.receiptNo, font,
      amounts: ['recorder', 'verifier'].includes(a.job) ? [{ label: '实收应付', text: '20.02 USD 143.00 CNY账面' },
        { label: '已核实外部付款', text: '2.00 USD 14.29 CNY账面' }, { label: '未核销应付', text: '18.02 USD 128.71 CNY账面' }] : null })),
    errors: [], expectedTransportErrors: [{ job: 'recorder', kind: 'requestfailed', method: 'POST', endpoint: path, message: 'net::ERR_CONNECTION_FAILED' }], recoveryCancelledTelemetry: [],
  };
}

module.exports = { fixture };
