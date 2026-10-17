// Synthetic validator-unit evidence only. Never imported by a business executor.
const crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function paymentReversalApiProofFixture() {
  const orderId = 9, paymentId = 7, requestedBy = 10, reviewedBy = 11;
  const time = '2026-10-03T12:00:00.000Z';
  const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const originalPayment = { id: paymentId, orderId, amount: 300, currency: 'CNY', exchangeRate: 1, baseAmount: 300,
    method: 'bank_transfer', date: time, payerName: 'Synthetic original payer', isProxy: false,
    note: 'Synthetic original receipt', status: 'verified', verifiedBy: requestedBy, milestoneId: null,
    barterMetadata: null, createdAt: time, updatedAt: time };
  const originalFacts = { version: 'original-payment-facts/v1', ...Object.fromEntries([
    'id', 'orderId', 'amount', 'currency', 'exchangeRate', 'baseAmount', 'method', 'date', 'payerName', 'isProxy',
    'note', 'verifiedBy', 'milestoneId', 'createdAt',
  ].map(key => [key, originalPayment[key]])) };
  const effectId = uuid(3);
  const requests = ['rejected', 'posted'].map((status, index) => {
    const id = uuid(index + 1), requestKey = uuid(index + 10), reviewKey = uuid(index + 20);
    const requestAuditId = 22 + index * 2, reviewAuditId = 23 + index * 2;
    const reasonCategory = 'registration_error', reason = `Synthetic ${index ? 'corrected' : 'first'} original evidence`;
    const reviewNote = `Synthetic independent ${status} review`;
    const originalPaymentJson = JSON.stringify(originalFacts);
    const fingerprint = hash({ version: 'payment-reversal-request-facts/v1', paymentId, userId: requestedBy,
      reasonCategory, reason, original: originalPaymentJson });
    const requestReceipt = { version: 'payment-reversal-request/v1', requestId: id, requestKey, paymentId, orderId,
      requestedBy, amount: 300, currency: 'CNY', status: 'pending', auditId: requestAuditId, requestedAt: time, reasonCategory, reason };
    const reviewReceipt = { version: 'payment-reversal-review/v1', requestId: id, reviewKey, paymentId, orderId,
      reversalId: status === 'posted' ? effectId : null, status, requestedBy, reviewedBy,
      amount: status === 'posted' ? -300 : 0, currency: 'CNY', auditId: reviewAuditId, reviewedAt: time,
      beforePaidAmount: 350, afterPaidAmount: status === 'posted' ? 50 : 350 };
    return { id, requestKey, paymentId, activePaymentId: null, requestedBy, reasonCategory, reason, fingerprint,
      originalPaymentJson, requestReceiptJson: JSON.stringify(requestReceipt), requestAuditId, originalAuditId: 21,
      status, reviewKey, reviewFingerprint: hash({ version: 'payment-reversal-review-facts/v1', requestId: id,
        userId: reviewedBy, decision: status === 'posted' ? 'approve' : 'reject', note: reviewNote }),
      reviewedBy, reviewNote, reviewAuditId, reviewReceiptJson: JSON.stringify(reviewReceipt), reviewedAt: time, createdAt: time };
  });
  const formatRequest = (r, pending = false) => ({ id: r.id, paymentId, status: pending ? 'pending' : r.status,
    requestedBy, reasonCategory: r.reasonCategory, reason: r.reason, createdAt: r.createdAt,
    reviewedBy: pending ? null : reviewedBy, reviewNote: pending ? null : r.reviewNote, reviewedAt: pending ? null : r.reviewedAt,
    originalPayment: originalFacts, requestReceipt: JSON.parse(r.requestReceiptJson), reviewReceipt: pending ? null : JSON.parse(r.reviewReceiptJson) });
  const currentOrder = paidAmount => ({ id: orderId, currency: 'CNY', finalAmount: 1000, receivableAdjustmentAmount: 0, paidAmount, paymentStatus: 'partial' });
  const response = (r, replayed, status, pending = false) => ({ status, json: { success: true, data: { replayed,
    request: formatRequest(r, pending), receipt: JSON.parse(pending ? r.requestReceiptJson : r.reviewReceiptJson),
    currentOrder: currentOrder(pending || r.status === 'rejected' ? 350 : 50) } } });
  const originalRequestReceipt = JSON.parse(requests[0].requestReceiptJson);
  const rejection = response(requests[0], false, 200).json.data;
  const approval = response(requests[1], false, 200).json.data;
  const effect = { id: effectId, paymentId, requestId: requests[1].id, postedBy: reviewedBy, auditId: requests[1].reviewAuditId,
    amount: -300, currency: 'CNY', beforeStateJson: JSON.stringify({ orderId, paidAmount: 350, paymentStatus: 'partial' }),
    afterStateJson: JSON.stringify({ orderId, paidAmount: 50, paymentStatus: 'partial' }),
    receiptJson: requests[1].reviewReceiptJson, createdAt: time };
  const verifiedPayload = { id: uuid(30), type: 'payment.verified', resourceType: 'payment', resourceId: paymentId,
    occurredAt: time, data: { orderId, paymentId, amount: 300, currency: 'CNY', verifiedBy: requestedBy, auditId: 21 } };
  const reversedPayload = { id: uuid(31), type: 'payment.reversed', resourceType: 'payment', resourceId: paymentId,
    occurredAt: time, data: { paymentId, orderId, reversalId: effectId, requestId: requests[1].id, amount: -300, currency: 'CNY',
      requestedBy, reviewedBy, auditId: effect.auditId, beforePaidAmount: 350, afterPaidAmount: 50 } };
  const events = [verifiedPayload, reversedPayload].map((payload, index) => ({ id: index + 31,
    eventKey: `${payload.type}:${paymentId}`, eventType: payload.type, aggregateType: 'payment', aggregateId: String(paymentId),
    payloadJson: JSON.stringify(payload), createdAt: time, deliveries: [{ id: index + 41, eventId: index + 31,
      channel: 'realtime', destinationKey: 'finance-notifications', status: 'pending', attempts: 0 }] }));
  const audits = [{ id: 21, userId: requestedBy, action: 'PAYMENT_VERIFIED', resource: 'payment', resourceId: paymentId,
    details: JSON.stringify({ eventId: verifiedPayload.id, eventKey: events[0].eventKey,
      orderId, paymentId, amount: 300, currency: 'CNY', verifiedBy: requestedBy }), createdAt: time }];
  for (const r of requests) {
    audits.push({ id: r.requestAuditId, userId: requestedBy, action: 'PAYMENT_REVERSAL_REQUESTED', resource: 'payment', resourceId: paymentId,
      details: JSON.stringify({ requestId: r.id, orderId, amount: 300, currency: 'CNY', reasonCategory: r.reasonCategory,
        reason: r.reason, fingerprint: r.fingerprint, originalAuditId: 21 }), createdAt: time });
    const posted = r.status === 'posted';
    audits.push({ id: r.reviewAuditId, userId: reviewedBy, action: posted ? 'PAYMENT_REVERSED' : 'PAYMENT_REVERSAL_REJECTED',
      resource: 'payment', resourceId: paymentId, details: JSON.stringify({ requestId: r.id, reversalId: posted ? effectId : null,
        requestedBy, reviewedBy, decision: posted ? 'approve' : 'reject', note: r.reviewNote, orderId,
        amount: posted ? -300 : 0, currency: 'CNY', beforePaidAmount: 350, afterPaidAmount: posted ? 50 : 350 }), createdAt: time });
  }
  const labels = ['before-request', 'rejected-no-financial-effect', 'posted-original-cash-reversed',
    'original-entry-replays-do-not-restore', 'later-payment-kept-original-reversal-receipt'];
  const stages = labels.map((label, index) => {
    const paidAmount = [350, 350, 50, 50, 150][index];
    return { label, order: { ...currentOrder(paidAmount), paymentRecords: [{ ...originalPayment,
      status: index < 2 ? 'verified' : 'reversed' }, ...(index === 4 ? [{ ...originalPayment, id: 8, amount: 100, baseAmount: 100 }] : [])] },
    adjustments: [{ id: 51, orderId, domain: 'finance', targetType: 'order', targetId: orderId,
      amountDelta: 50, status: 'posted', appliedAt: time }], readbacks: [currentOrder(paidAmount), currentOrder(paidAmount)] };
  });
  const history = [0, 1].map(() => ({ paymentId, paymentStatus: 'reversed', originalPayment: originalFacts,
    eligibility: { allowed: false, errorCode: 'PAYMENT_REVERSAL_INVALID_STATE' }, currentOrder: currentOrder(150),
    requests: requests.map(r => formatRequest(r)), reversal: { id: effect.id, requestId: effect.requestId, amount: effect.amount,
      currency: effect.currency, postedBy: effect.postedBy, auditId: effect.auditId, postedAt: effect.createdAt,
      receipt: JSON.parse(effect.receiptJson) } }));
  const immutableDenials = ['original-amount', 'original-date', 'original-verifier', 'original-revive', 'request-receipt',
    'effect-amount', 'effect-delete', 'original-audit', 'reversal-audit-delete', 'original-delete']
    .map(label => ({ label, code: 'P2010', message: 'PAYMENT_REVERSAL_IMMUTABLE' }));
  const immutableSha256 = hash({ payment: stages.at(-1).order.paymentRecords[0], requests, effects: [effect], audits });
  // JSON round-trip matches independent serialized report objects; no shared
  // in-memory aliases can accidentally make a mutation test affect two facts.
  return JSON.parse(JSON.stringify({ version: 'payment-reversal-api/v1', scope: 'Synthetic validator unit fixture, not real business evidence',
    orderId, paymentId, originalPayment, stages, originalRequestReceipt,
    firstRequestId: requests[0].id, acceptedRequestId: requests[1].id,
    firstRequest: response(requests[0], false, 201, true),
    requestSameKeyRace: [response(requests[0], false, 201, true), response(requests[0], true, 200, true)],
    requestDifferentKeyRace: [response(requests[1], false, 201, true), { status: 409, json: { success: false, errorCode: 'PAYMENT_REVERSAL_ALREADY_PENDING' } }],
    rejection, approval, approvalRace: [response(requests[1], false, 200), response(requests[1], true, 200)],
    requests, reversals: [effect], audits, events, history, immutableDenials,
    immutableBeforeSha256: immutableSha256, immutableAfterSha256: immutableSha256,
    pendingPaymentRequest: { status: 409 }, strictBodyRequest: { status: 400 } }));
}
module.exports = { paymentReversalApiProofFixture };
