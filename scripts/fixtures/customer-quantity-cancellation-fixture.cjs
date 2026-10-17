// Synthetic verifier unit input only. Never used by a runtime audit or as acceptance evidence.
function cancellationFixture(stamp = {}) {
  const copy = structuredClone;
  const actors = { sales: 2, finance: 3 };
  const line = { id: 11, quantity: 100, totalPrice: 1000, unit: 'kg' };
  const before = { order: { id: 1, customerId: 10, totalAmount: 1000, discountAmount: 0, finalAmount: 1000, paidAmount: 400,
    currency: 'CNY', receivableAdjustmentAmount: 0, status: 'shipped', items: [line],
    paymentRecords: [{ id: 4, amount: 400, status: 'verified' }],
    shipments: [{ id: 5, orderItemId: 11, quantity: 40, status: 'delivered', receipts: [{ acceptedQuantity: 40, rejectedQuantity: 0 }] }] },
    adjustments: [], balances: [{ id: 6, quantity: 0 }], cost: [{ quantityDelta: 40, costAmountDelta: 400 }, { quantityDelta: -40, costAmountDelta: -400 }] };
  const sent = { orderItemId: 11, quantity: 60, idempotencyKey: 'synthetic-intent-1', reason: 'Customer cancelled remainder' };
  const credit = { id: 7, adjustmentNo: 'synthetic-credit-7', adjustmentType: 'order_quantity_cancellation', orderId: 1, orderItemId: 11, cancelledQuantity: 60,
    requestKey: sent.idempotencyKey, requestFingerprint: 'synthetic-hash', amount: 600, baseAmount: 600, currency: 'CNY', exchangeRate: 1,
    reason: sent.reason, createdBy: 2, status: 'pending', createdAt: '2026-01-01', evidenceJson: '{}' };
  const pending = copy(before); pending.adjustments = [copy(credit)];
  const postedCredit = { ...credit, status: 'posted', postedBy: 3, creator: { id: 2, role: 'sales' }, poster: { id: 3, role: 'finance' } };
  const posted = copy(before); Object.assign(posted.order, { receivableAdjustmentAmount: 600, paymentStatus: 'paid' }); posted.adjustments = [copy(postedCredit)];
  const restored = { id: 1, receivableAdjustmentAmount: 0, fulfillment: { fullyResolved: false, fullyDelivered: false, needsReview: false,
    lines: [{ orderItemId: 11, orderedQuantity: 100, acceptedQuantity: 40, cancelledQuantity: 0, outstandingQuantity: 60, unallocatedQuantity: 60 }] } };
  const readback = copy(restored); readback.fulfillmentStatus = 'resolved_with_cancellation'; readback.fulfillment.fullyResolved = true;
  Object.assign(readback.fulfillment.lines[0], { cancelledQuantity: 60, outstandingQuantity: 0, unallocatedQuantity: 0 });
  const reversed = { ...postedCredit, status: 'reversed' }, replacement = { ...postedCredit, id: 8, requestKey: 'synthetic-intent-2' };
  const final = copy(posted); final.order.status = 'completed'; final.adjustments = [copy(reversed), replacement];
  const c = { actors, before, pending: { created: credit, sent, persisted: pending, replay: { status: 201, json: { data: credit } } },
    lostAck: { endpoint: '/orders/1/quantity-cancellations', instance: 0, upstreamStatus: 201, upstreamId: 7, receivedAt: 1, failedAt: 2, recoveredAt: 3,
      failure: { errorText: 'net::ERR_FAILED' }, submitDisabled: true, failureText: '结果未确认', recoveryText: 'synthetic-credit-7 待财务过账' },
    financePost: { success: true, data: { changed: true, adjustment: postedCredit } }, posted, readbacks: [copy(readback), copy(readback)],
    replayPost: { changed: false }, reversed: { changed: true, adjustment: reversed }, restored, replacement,
    completed: { ...readback, status: 'completed' }, final,
    audit: [[7, 'REQUEST', 2], [7, 'POST', 3], [7, 'REVERSE', 3], [8, 'REQUEST', 2], [8, 'POST', 3]].map(([resourceId, action, userId], i) => ({ id: i + 1, resourceId, userId, action: action + '_ORDER_QUANTITY_CANCELLATION' })),
    rejections: [['foreign customer', 404, 'ORDER_CANCELLATION_NOT_FOUND'], ['exceeds unallocated', 409, 'ORDER_CANCELLATION_QUANTITY_EXCEEDED'],
      ['stale order version', 409, 'ORDER_CANCELLATION_STATE_CHANGED'], ['client-chosen price', 400], ['same key altered reason', 409, 'ORDER_CANCELLATION_IDEMPOTENCY_CONFLICT'],
      ['sales cannot post', 403], ['cannot ship cancelled quantity', 409], ['cannot omit line binding', 409], ['not a physical delivery', 409, 'ORDER_FULFILLMENT_INCOMPLETE'], ['cannot reopen closed order', 409]]
      .map(([name, status, errorCode]) => ({ name, status, ok: false, json: { errorCode } })),
    races: ['double-post', 'post-vs-shipment'].map((kind, i) => {
      const id = 20 + i, row = { ...postedCredit, id, orderId: 2 + i, orderItemId: 12 + i, cancelledQuantity: 70, amount: 700 };
      const items = [{ ...line, id: 12 + i }];
      return { kind, original: { items }, duplicates: [0, 1].map(() => ({ status: 201, json: { data: { id } } })),
        outcomes: [{ status: 200, ok: true, json: { data: { changed: true } } }, kind === 'double-post' ? { status: 200, ok: true, json: { data: { changed: false } } } : { status: 409, ok: false }],
        after: { items: copy(items), finalAmount: 1000, paidAmount: 0, receivableAdjustmentAmount: 700, receivableAdjustments: [row], shipments: [] },
        audits: [['REQUEST', 2], ['POST', 3]].map(([action, userId]) => ({ resourceId: id, userId, action: action + '_ORDER_QUANTITY_CANCELLATION' })) };
    }),
    boundaries: { before: { paidAmount: 800 }, afterRefund: { paidAmount: 800 }, refund: { status: 409, json: { errorCode: 'ORDER_CANCELLATION_REFUND_REQUIRED' } },
      financialCredit: { adjustmentType: 'credit_memo' }, financialReadback: { receivableAdjustmentAmount: 100, paidAmount: 800, fulfillment: { lines: [{ cancelledQuantity: 0, outstandingQuantity: 100 }] } },
      beforeSelfPost: { paidAmount: 800, receivableAdjustmentAmount: 100 }, afterSelfPost: { paidAmount: 800, receivableAdjustmentAmount: 100 },
      selfPost: { status: 409, json: { message: '取消申请必须由另一名财务审核。' } } } };
  return copy({ ...stamp, status: 'passed', runId: 'synthetic-cancellation', cancellation: c,
    browserBounds: [['finance-cancellation-posted.png', '有效 400.00 CNY'], ['sales-cancellation-resolved.png', '已取消待交量 60 kg']]
      .map(([name, text]) => ({ name, text, notCovered: true, rect: { x: 20, y: 20, width: 100, height: 100, right: 120, bottom: 120 } })) });
}
module.exports = { cancellationFixture };
