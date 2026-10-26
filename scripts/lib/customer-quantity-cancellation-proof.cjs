// Independent arithmetic/readback checks, not imports of production fulfillment logic.
const assert = require('node:assert/strict');
const type = 'order_quantity_cancellation';
const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);
const eq = (actual, expected) => assert.deepEqual(actual, expected);

function verifyCustomerCancellation(r) {
  eq(r.status, 'passed'); assert(!r.error); assert(r.runId);
  const c = r.cancellation, before = c.before, order = before.order, line = order.items[0];
  eq(order.items.length, 1); eq(line.quantity, 100); eq(line.unit, 'kg'); eq(line.totalPrice, 1000);
  eq(order.finalAmount, 1000); eq(order.paidAmount, 400); eq(order.receivableAdjustmentAmount, 0);
  eq(order.currency, 'CNY'); eq(before.adjustments, []);
  eq(sum(order.paymentRecords, 'amount'), 400); assert(order.paymentRecords.every(p => p.status === 'verified'));
  eq(order.shipments.length, 1); const shipment = order.shipments[0];
  eq(shipment.orderItemId, line.id); eq(shipment.quantity, 40); eq(shipment.status, 'delivered');
  eq(sum(shipment.receipts, 'acceptedQuantity'), 40); eq(sum(shipment.receipts, 'rejectedQuantity'), 0);
  assert(before.balances.length > 0); assert(before.balances.every(b => b.quantity === 0));
  eq(before.cost.length, 2); eq(sum(before.cost, 'quantityDelta'), 0); eq(sum(before.cost, 'costAmountDelta'), 0);
  const unchanged = state => {
    for (const key of ['id', 'customerId', 'totalAmount', 'discountAmount', 'finalAmount', 'currency', 'paidAmount', 'items', 'shipments', 'paymentRecords']) eq(state.order[key], order[key]);
    eq(state.balances, before.balances); eq(state.cost, before.cost);
  };
  const credit = (row, status) => {
    eq(row.adjustmentType, type); eq(row.status, status); eq(row.orderId, order.id); eq(row.orderItemId, line.id);
    eq(row.cancelledQuantity, 60); eq(row.amount, 600); eq(row.currency, 'CNY'); eq(row.baseAmount, 600); eq(row.exchangeRate, 1);
    eq(row.createdBy, c.actors.sales);
    if (status !== 'pending') eq(row.postedBy, c.actors.finance);
  };
  const pending = c.pending; unchanged(pending.persisted); eq(pending.persisted.order.receivableAdjustmentAmount, 0);
  eq(pending.persisted.adjustments.length, 1); credit(pending.created, 'pending'); credit(pending.persisted.adjustments[0], 'pending');
  eq(pending.created.id, pending.persisted.adjustments[0].id); eq(pending.sent.orderItemId, line.id); eq(pending.sent.quantity, 60);
  eq(pending.persisted.adjustments[0].requestKey, pending.sent.idempotencyKey);
  eq(pending.created.reason, pending.sent.reason); eq(pending.replay.status, 201); eq(pending.replay.json.data.id, pending.created.id);
  const ack = c.lostAck;
  eq(ack.endpoint, `/orders/${order.id}/quantity-cancellations`); eq(ack.instance, 0); eq(ack.upstreamStatus, 201); eq(ack.upstreamId, pending.created.id);
  assert(ack.failure?.errorText); eq(ack.submitDisabled, true); assert(ack.failureText.includes('结果未确认'));
  assert(ack.recoveryText.includes(pending.created.adjustmentNo) && ack.recoveryText.includes('待财务过账'));
  assert([ack.receivedAt, ack.failedAt, ack.recoveredAt].every(Number.isFinite));
  assert(ack.receivedAt <= ack.failedAt && ack.failedAt <= ack.recoveredAt, 'ACK failure must follow commit response and precede recovery');
  assert(c.actors.sales !== c.actors.finance);
  const posted = c.financePost.data.adjustment; credit(posted, 'posted'); eq(posted.id, pending.created.id);
  eq(posted.creator.id, c.actors.sales); eq(posted.creator.role, 'sales'); eq(posted.poster.id, c.actors.finance); eq(posted.poster.role, 'finance');
  eq(c.financePost.success, true); eq(c.financePost.data.changed, true); unchanged(c.posted); eq(c.posted.adjustments.length, 1); credit(c.posted.adjustments[0], 'posted');
  eq(c.posted.order.receivableAdjustmentAmount, 600); eq(c.posted.order.paymentStatus, 'paid');
  const resolved = detail => {
    eq(Number(detail.id), order.id); eq(detail.fulfillment.fullyDelivered, false); eq(detail.fulfillment.fullyResolved, true); eq(detail.fulfillment.needsReview, false);
    eq(detail.fulfillment.lines.length, 1); const row = detail.fulfillment.lines[0];
    eq(row.orderItemId, line.id); eq(row.orderedQuantity, 100); eq(row.acceptedQuantity, 40); eq(row.cancelledQuantity, 60);
    eq(row.outstandingQuantity, 0); eq(row.unallocatedQuantity, 0);
  };
  eq(c.readbacks.length, 2); for (const d of c.readbacks) { resolved(d); eq(d.fulfillmentStatus, 'resolved_with_cancellation'); }
  for (const [name, text] of [['finance-cancellation-posted.png', '有效 400.00 CNY'], ['sales-cancellation-resolved.png', '已取消待交量 60 kg']]) {
    const shot = r.browserBounds.find(s => s.name === name); assert(shot?.notCovered); assert(shot.text.includes(text));
    assert(shot.rect.width > 0 && shot.rect.height > 0 && shot.rect.x >= 0 && shot.rect.y >= 0);
    assert(shot.rect.right <= 1440 && shot.rect.bottom <= 1000);
  }
  const rejected = [['foreign customer', 404, 'ORDER_CANCELLATION_NOT_FOUND'], ['exceeds unallocated', 409, 'ORDER_CANCELLATION_QUANTITY_EXCEEDED'],
    ['stale order version', 409, 'ORDER_CANCELLATION_STATE_CHANGED'], ['client-chosen price', 400], ['same key altered reason', 409, 'ORDER_CANCELLATION_IDEMPOTENCY_CONFLICT'],
    ['sales cannot post', 403], ['cannot ship cancelled quantity', 409], ['cannot omit line binding', 409], ['not a physical delivery', 409, 'ORDER_FULFILLMENT_INCOMPLETE'], ['cannot reopen closed order', 409]];
  eq(c.rejections.map(x => x.name), rejected.map(x => x[0]));
  for (const [index, [, status, code]] of rejected.entries()) { const row = c.rejections[index]; eq(row.status, status); eq(row.ok, false); if (code) eq(row.json.errorCode, code); }
  eq(c.replayPost.changed, false); eq(c.reversed.changed, true); credit(c.reversed.adjustment, 'reversed');
  eq(c.restored.receivableAdjustmentAmount, 0); eq(c.restored.fulfillment.fullyResolved, false); eq(c.restored.fulfillment.lines[0].outstandingQuantity, 60);
  eq(c.restored.fulfillment.lines[0].cancelledQuantity, 0); eq(c.completed.status, 'completed'); resolved(c.completed);
  unchanged(c.final); eq(c.final.order.status, 'completed'); eq(c.final.order.receivableAdjustmentAmount, 600);
  eq(c.final.adjustments.length, 2); credit(c.final.adjustments[0], 'reversed'); credit(c.final.adjustments[1], 'posted');
  eq(c.final.adjustments[0].id, pending.created.id); eq(c.final.adjustments[1].id, c.replacement.id); assert(c.replacement.id !== pending.created.id);
  const originalFields = ['id', 'orderId', 'orderItemId', 'cancelledQuantity', 'requestKey', 'requestFingerprint', 'amount', 'baseAmount', 'currency', 'evidenceJson', 'reason', 'createdBy', 'createdAt'];
  for (const key of originalFields) eq(c.final.adjustments[0][key], pending.persisted.adjustments[0][key]);
  const expectedAudit = [[pending.created.id, 'REQUEST', c.actors.sales], [pending.created.id, 'POST', c.actors.finance], [pending.created.id, 'REVERSE', c.actors.finance], [c.replacement.id, 'REQUEST', c.actors.sales], [c.replacement.id, 'POST', c.actors.finance]];
  eq(c.audit.map(a => [a.resourceId, a.action, a.userId]), expectedAudit.map(([id, action, actor]) => [id, `${action}_ORDER_QUANTITY_CANCELLATION`, actor]));
  eq(new Set(c.audit.map(a => a.id)).size, 5);
  eq(c.races.map(x => x.kind), ['double-post', 'post-vs-shipment']);
  for (const race of c.races) {
    eq(race.duplicates.length, 2); assert(race.duplicates.every(d => d.status === 201)); eq(race.duplicates[0].json.data.id, race.duplicates[1].json.data.id);
    const after = race.after, rows = after.receivableAdjustments, id = race.duplicates[0].json.data.id;
    eq(rows.length, 1); eq(rows[0].id, id); eq(rows[0].orderItemId, after.items[0].id); eq(rows[0].adjustmentType, type); eq(rows[0].cancelledQuantity, 70); eq(rows[0].amount, 700);
    eq(after.items, race.original.items); eq(after.finalAmount, 1000); eq(after.paidAmount, 0);
    const cancelled = rows[0].status === 'posted' ? 70 : 0, allocated = sum(after.shipments, 'quantity');
    eq(after.receivableAdjustmentAmount, cancelled * 10); assert(cancelled + allocated <= 100);
    eq(race.outcomes.length, 2);
    if (race.kind === 'double-post') { eq(race.outcomes.map(x => x.status), [200, 200]); eq(cancelled, 70); eq(race.outcomes.filter(x => x.json.data?.changed).length, 1); }
    else { eq(race.outcomes.filter(x => x.ok).length, 1); eq(race.outcomes.filter(x => x.status === 409).length, 1); assert((cancelled === 70 && allocated === 0) || (cancelled === 0 && allocated === 40)); }
    eq(race.audits.filter(a => a.action === 'REQUEST_ORDER_QUANTITY_CANCELLATION' && a.resourceId === id && a.userId === c.actors.sales).length, 1);
    eq(race.audits.filter(a => a.action === 'POST_ORDER_QUANTITY_CANCELLATION' && a.resourceId === id && a.userId === c.actors.finance).length, cancelled ? 1 : 0);
  }
  const b = c.boundaries;
  eq(b.before.paidAmount, 800); eq(b.refund.status, 409); eq(b.refund.json.errorCode, 'ORDER_CANCELLATION_REFUND_REQUIRED'); eq(b.afterRefund, b.before);
  eq(b.financialCredit.adjustmentType, 'credit_memo'); eq(b.financialReadback.receivableAdjustmentAmount, 100); eq(b.financialReadback.paidAmount, 800);
  eq(b.financialReadback.fulfillment.lines[0].cancelledQuantity, 0); eq(b.financialReadback.fulfillment.lines[0].outstandingQuantity, 100);
  eq(b.selfPost.status, 409); eq(b.selfPost.json.message, '取消申请必须由另一名财务审核。'); eq(b.afterSelfPost, b.beforeSelfPost);
  return { version: 'customer-quantity-cancellation/v1', ordered: 100, accepted: 40, cancelled: 60, originalAmount: 1000, cash: 400, credit: 600,
    lostAcknowledgementRecovered: true, independentFinance: true, concurrentCases: 2, reservationAccepted: false, refundsAccepted: false };
}
module.exports = { verifyCustomerCancellation };
