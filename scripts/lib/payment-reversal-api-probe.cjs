const assert = require('node:assert/strict'), crypto = require('node:crypto');
const { ensureReleasedMaterial } = require('./material-audit-fixture.cjs');

async function paymentReversalApiProbe(ctx, signal) {
  const { request, dataOf, actors, prisma, runId } = ctx;
  const e = { version: 'payment-reversal-api/v1', scope: 'Original full CNY cash reversal API/database prerequisite; not browser/cloud acceptance', stages: [] };
  const call = (endpoint, actor, data, instance = 0) => request(endpoint, { actor, data, instance, method: 'POST', signal });
  try {
    const customer = dataOf(await call('/customers', actors.admin, { name: `${runId}-reversal`, nameZh: `${runId}-reversal`, creditLimit: 100000,
      termsDays: 30, segment: 'direct', poolState: 'private', salespersonId: actors.sales.id }));
    const m = await ensureReleasedMaterial({ request: (endpoint, opts) => request(endpoint, { ...opts, signal }),
      code: `${runId}-reversal`, name: `${runId}-reversal`, category: 'finished_good', unit: 'kg' });
    const order = dataOf(await call('/orders', actors.sales, { customerId: Number(customer.id), items: [{ materialId: m.id, productName: m.nameZh, quantity: 10, unit: 'kg', unitPrice: 100 }], paymentTerms: 30 }));
    e.orderId = Number(order.id);
    const registration = { idempotencyKey: crypto.randomUUID(), amount: 300, method: 'bank_transfer', payerName: 'Original reversal fixture', note: runId };
    const registered = await call(`/orders/${e.orderId}/payment`, actors.sales, registration); dataOf(registered); e.originalSubmissionReceipt = registered.json.paymentSubmission;
    e.paymentId = e.originalSubmissionReceipt.paymentId;
    dataOf(await call(`/orders/${e.orderId}/payment/${e.paymentId}/verify`, actors.finance1));
    dataOf(await call('/adjustments', actors.finance1, { domain: 'finance', targetType: 'order', orderId: e.orderId, amountDelta: 50, status: 'posted', reasonCategory: 'payment_correction', reason: `${runId} keep independent +50` }));
    const snapshot = async label => {
      const order = await prisma.order.findUnique({ where: { id: e.orderId }, include: { paymentRecords: { orderBy: { id: 'asc' } } } });
      const api = await Promise.all([0,1].map(async instance => dataOf(await request(`/orders/${e.orderId}`, { actor: actors.finance2, instance, signal }))));
      const adjustments = await prisma.adjustmentRecord.findMany({ where: { orderId: e.orderId }, orderBy: { id: 'asc' } });
      const s = { label, order, adjustments, readbacks: api.map(r => ({ id: Number(r.id), paidAmount: Number(r.paidAmount), paymentStatus: r.paymentStatus })) };
      e.stages.push(s); assert(api.every(r => Number(r.paidAmount) === Number(order.paidAmount))); return s;
    };
    const original = await snapshot('before-request'); e.originalPayment = original.order.paymentRecords[0]; assert.equal(Number(original.order.paidAmount), 350);
    const endpoint = `/collections/payments/${e.paymentId}/reversal-requests`;
    const facts = { requestKey: crypto.randomUUID(), reasonCategory: 'registration_error', reason: `${runId} wrong bank payment registration` };
    const firstRace = await Promise.all([0,1].map(instance => call(endpoint, actors.finance1, facts, instance)));
    e.requestSameKeyRace = firstRace;
    assert.deepEqual(firstRace.map(r => r.status).sort(), [200,201]);
    const first = firstRace.find(r => r.status === 201); e.firstRequest = first;
    const requested = dataOf(first); assert.equal(first.status, 201); e.originalRequestReceipt = requested.receipt; e.firstRequestId = requested.request.id;
    const repeat = dataOf(await call(endpoint, actors.finance1, facts, 1)); assert.deepEqual(repeat.receipt, e.originalRequestReceipt);
    assert.deepEqual(firstRace.map(r => dataOf(r).receipt), [e.originalRequestReceipt,e.originalRequestReceipt]);
    assert.equal((await call(endpoint, actors.finance2, { ...facts, requestKey: crypto.randomUUID() }, 1)).status, 409);
    assert.equal((await call(endpoint, actors.finance1, { ...facts, reason: 'changed immutable facts' })).status, 409);
    assert.equal((await call(endpoint, actors.sales, { ...facts, requestKey: crypto.randomUUID() })).status, 403);
    const review = (id, actor, payload, instance = 0) => call(`/collections/payment-reversal-requests/${id}/review`, actor, payload, instance);
    const reject = { reviewKey: crypto.randomUUID(), decision: 'reject', note: `${runId} rejected; submit corrected evidence` };
    assert.equal((await review(e.firstRequestId, actors.finance1, reject)).status, 403, 'A requester cannot review their own reversal, including admin paths');
    e.rejection = dataOf(await review(e.firstRequestId, actors.finance2, reject, 1));
    assert.deepEqual(dataOf(await review(e.firstRequestId, actors.finance2, reject)).receipt, e.rejection.receipt);
    assert.equal((await review(e.firstRequestId, actors.finance2, { ...reject, decision: 'approve' })).status, 409);
    assert.equal((await snapshot('rejected-no-financial-effect')).order.paidAmount, 350);
    const corrected = { ...facts, requestKey: crypto.randomUUID(), reason: `${runId} corrected original bank registration` };
    const otherCorrected = { ...corrected, requestKey: crypto.randomUUID() };
    const differentKeyRace = await Promise.all([corrected,otherCorrected].map((data, instance) => call(endpoint, actors.finance1, data, instance)));
    e.requestDifferentKeyRace = differentKeyRace; assert.deepEqual(differentKeyRace.map(r => r.status).sort(), [201,409]);
    const accepted = dataOf(differentKeyRace.find(r => r.status === 201)); e.acceptedRequestId = accepted.request.id;
    const approve = { reviewKey: crypto.randomUUID(), decision: 'approve', note: `${runId} independently confirmed original full payment` };
    e.approvalRace = await Promise.all([0,1].map(instance => review(e.acceptedRequestId, actors.finance2, approve, instance)));
    assert(e.approvalRace.every(r => r.status === 200));
    assert.deepEqual(e.approvalRace.map(r => dataOf(r).replayed).sort(), [false,true]);
    e.approval = dataOf(e.approvalRace.find(r => !dataOf(r).replayed));
    assert(e.approvalRace.every(r => JSON.stringify(dataOf(r).receipt) === JSON.stringify(e.approval.receipt)));
    assert.equal((await review(e.acceptedRequestId, actors.admin, { ...approve, reviewKey: crypto.randomUUID() })).status, 409);
    assert.equal((await review(e.acceptedRequestId, actors.finance1, approve)).status, 403);
    const posted = await snapshot('posted-original-cash-reversed'); assert.equal(posted.order.paidAmount, 50);
    const reversed = posted.order.paymentRecords.find(p => p.id === e.paymentId);
    assert.equal(reversed.status, 'reversed');
    assert.deepEqual({ ...reversed, status: e.originalPayment.status, updatedAt: e.originalPayment.updatedAt }, e.originalPayment, 'Original financial facts, verifier and date remain unchanged');
    assert.equal((await call(`/orders/${e.orderId}/payment/${e.paymentId}/verify`, actors.finance2)).status, 409);
    assert.equal((await call(`/collections/payments/${e.paymentId}/verify`, actors.finance2, undefined, 1)).status, 409);
    const originalReplay = await call(`/orders/${e.orderId}/payment`, actors.sales, registration, 1); dataOf(originalReplay);
    assert.deepEqual(originalReplay.json.paymentSubmission, e.originalSubmissionReceipt);
    assert.equal((await snapshot('original-entry-replays-do-not-restore')).order.paidAmount, 50);
    const newPayment = await call(`/orders/${e.orderId}/payment`, actors.sales, { ...registration, amount: 100, idempotencyKey: crypto.randomUUID() }); dataOf(newPayment);
    dataOf(await call(`/orders/${e.orderId}/payment/${newPayment.json.paymentSubmission.paymentId}/verify`, actors.finance1));
    const stableReplay = dataOf(await review(e.acceptedRequestId, actors.finance2, approve)); assert.deepEqual(stableReplay.receipt, e.approval.receipt);
    assert.equal((await snapshot('later-payment-kept-original-reversal-receipt')).order.paidAmount, 150);
    e.requests = await prisma.paymentReversalRequest.findMany({ where: { paymentId: e.paymentId }, orderBy: { createdAt: 'asc' } });
    e.reversals = await prisma.paymentReversal.findMany({ where: { paymentId: e.paymentId } });
    e.audits = await prisma.auditLog.findMany({ where: { resource: 'payment', resourceId: e.paymentId }, orderBy: { id: 'asc' } });
    e.events = await prisma.businessEvent.findMany({ where: { aggregateType: 'payment', aggregateId: String(e.paymentId) }, include: { deliveries: true }, orderBy: { id: 'asc' } });
    assert.equal(e.requests.length, 2); assert.deepEqual(e.requests.map(r => r.status).sort(), ['posted','rejected']); assert.equal(e.reversals.length, 1);
    assert.equal(Number(e.reversals[0].amount), -300); assert.equal(e.reversals[0].postedBy, actors.finance2.id);
    assert.equal(e.audits.filter(a => a.action === 'PAYMENT_REVERSED').length, 1);
    assert.equal(e.events.filter(v => v.eventKey === `payment.reversed:${e.paymentId}`).length, 1);
    const reversalEvent = e.events.find(v => v.eventKey === `payment.reversed:${e.paymentId}`), eventPayload = JSON.parse(reversalEvent.payloadJson);
    assert.equal(eventPayload.type, 'payment.reversed'); assert.equal(eventPayload.data.amount, -300);
    assert.equal(eventPayload.data.reversalId, e.reversals[0].id); assert.equal(eventPayload.data.auditId, e.reversals[0].auditId);
    const beforeTamper = JSON.stringify({ payment: await prisma.paymentRecord.findUnique({ where: { id: e.paymentId } }), requests: e.requests, effects: e.reversals, audits: e.audits });
    e.immutableBeforeSha256 = crypto.createHash('sha256').update(beforeTamper).digest('hex');
    e.immutableDenials = [];
    const deny = async (label, action) => {
      try { await action(); assert.fail(`${label}: immutable financial history was altered`); }
      catch (error) {
        assert(/PAYMENT_REVERSAL_|foreign key constraint/i.test(error.message), `${label}: must be a database guard, not an arbitrary rejected query: ${error.message}`);
        e.immutableDenials.push({ label, code: error.code, databaseCode: error.meta?.code, message: error.message });
      }
    };
    await deny('original-amount', () => prisma.paymentRecord.update({ where: { id: e.paymentId }, data: { amount: 301 } }));
    await deny('original-date', () => prisma.paymentRecord.update({ where: { id: e.paymentId }, data: { date: new Date('2026-01-01') } }));
    await deny('original-verifier', () => prisma.paymentRecord.update({ where: { id: e.paymentId }, data: { verifiedBy: actors.finance2.id } }));
    await deny('original-revive', () => prisma.paymentRecord.update({ where: { id: e.paymentId }, data: { status: 'verified' } }));
    await deny('request-receipt', () => prisma.paymentReversalRequest.update({ where: { id: e.acceptedRequestId }, data: { requestReceiptJson: '{}' } }));
    await deny('effect-amount', () => prisma.paymentReversal.update({ where: { id: e.reversals[0].id }, data: { amount: -1 } }));
    await deny('effect-delete', () => prisma.paymentReversal.delete({ where: { id: e.reversals[0].id } }));
    await deny('original-audit', () => prisma.auditLog.update({ where: { id: e.audits.find(a => a.action === 'PAYMENT_VERIFIED').id }, data: { details: '{}' } }));
    await deny('reversal-audit-delete', () => prisma.auditLog.delete({ where: { id: e.reversals[0].auditId } }));
    await deny('original-delete', () => prisma.paymentRecord.delete({ where: { id: e.paymentId } }));
    const afterTamper = JSON.stringify({ payment: await prisma.paymentRecord.findUnique({ where: { id: e.paymentId } }),
      requests: await prisma.paymentReversalRequest.findMany({ where: { paymentId: e.paymentId }, orderBy: { createdAt: 'asc' } }),
      effects: await prisma.paymentReversal.findMany({ where: { paymentId: e.paymentId } }),
      audits: await prisma.auditLog.findMany({ where: { resource: 'payment', resourceId: e.paymentId }, orderBy: { id: 'asc' } }) });
    assert.equal(afterTamper, beforeTamper); e.immutableAfterSha256 = crypto.createHash('sha256').update(afterTamper).digest('hex');
    e.history = await Promise.all([0,1].map(async instance => dataOf(await request(endpoint, { actor: actors.finance2, instance, signal }))));
    assert(e.history.every(h => h.paymentStatus === 'reversed' && !h.eligibility.allowed && h.currentOrder.paidAmount === 150
      && h.originalPayment.amount === 300 && h.requests.length === 2 && h.reversal.amount === -300));
    assert.equal((await call(endpoint, actors.finance1, { ...facts, requestKey: crypto.randomUUID() })).status, 409);
    const extra = await call(`/orders/${e.orderId}/payment`, actors.sales, { ...registration, amount: 10, idempotencyKey: crypto.randomUUID() }); dataOf(extra);
    e.pendingPaymentRequest = await call(`/collections/payments/${extra.json.paymentSubmission.paymentId}/reversal-requests`, actors.finance1, { ...facts, requestKey: crypto.randomUUID() });
    assert.equal(e.pendingPaymentRequest.status, 409);
    e.strictBodyRequest = await call(endpoint, actors.finance1, { ...facts, requestKey: crypto.randomUUID(), amount: -100 });
    assert.equal(e.strictBodyRequest.status, 400);
    return e;
  } catch (error) { error.evidence = e; throw error; }
}
module.exports = { paymentReversalApiProbe };
