const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ensureReleasedMaterial } = require('./material-audit-fixture.cjs');

// Supporting money invariant, NOT an original-payment reversal acceptance.
async function paymentAdjustmentReconciliation(ctx, signal) {
  const { request, dataOf, actors, prisma, runId } = ctx;
  const evidence = { version: 'payment-adjustment-reconciliation/v1',
    scope: 'Applied paid-amount adjustments survive later cash verification; not payment reversal/browser acceptance', stages: [] };
  try {
    const customer = dataOf(await request('/customers', { method: 'POST', signal, data: {
      name: `${runId}-reconcile`, nameZh: `${runId}-reconcile`, creditLimit: 100000, termsDays: 30,
      segment: 'direct', poolState: 'private', salespersonId: actors.sales.id,
    } }));
    const material = await ensureReleasedMaterial({ request: (endpoint, opts) => request(endpoint, { ...opts, signal }),
      code: `${runId}-reconcile`, name: `${runId}-reconcile`, category: 'finished_good', unit: 'kg' });
    const makeOrder = async () => Number(dataOf(await request('/orders', { actor: actors.sales, method: 'POST', signal, data: {
      customerId: Number(customer.id), items: [{ materialId: material.id, productName: material.nameZh, quantity: 10, unit: 'kg', unitPrice: 100 }], paymentTerms: 30,
    } })).id);
    const orderId = await makeOrder(); evidence.orderId = orderId;
    const submit = async (id, amount) => {
      const r = await request(`/orders/${id}/payment`, { actor: actors.sales, method: 'POST', signal,
        data: { idempotencyKey: crypto.randomUUID(), amount, method: 'bank_transfer', note: runId } });
      dataOf(r); assert(r.json.paymentSubmission?.paymentId); return r.json.paymentSubmission.paymentId;
    };
    const verify = async (id, paymentId) => request(`/orders/${id}/payment/${paymentId}/verify`, { actor: actors.finance2, instance: 1, method: 'POST', signal });
    const adjust = async (id, amountDelta, status) => dataOf(await request('/adjustments', { actor: actors.finance1, method: 'POST', signal,
      data: { domain: 'finance', targetType: 'order', orderId: id, amountDelta, status, reasonCategory: 'payment_correction', reason: `${runId} applied correction` } })).adjustment;
    const reverse = async id => dataOf(await request(`/adjustments/${id}/reverse`, { actor: actors.finance2, instance: 1, method: 'POST', signal, data: { note: `${runId} reverse adjustment only` } }));
    const capture = async (label, id, expected) => {
      const order = await prisma.order.findUnique({ where: { id }, include: { paymentRecords: { orderBy: { id: 'asc' } } } });
      const adjustments = await prisma.adjustmentRecord.findMany({ where: { orderId: id }, orderBy: { id: 'asc' } });
      const readbacks = await Promise.all([0, 1].map(async instance => dataOf(await request(`/orders/${id}`, { actor: actors.finance2, instance, signal }))));
      const canonical = order.paymentRecords.filter(p => p.status === 'verified').reduce((sum, p) => sum + Math.round(Number(p.amount) * 100), 0)
        + adjustments.filter(a => a.domain === 'finance' && a.appliedAt && ['posted', 'reversed'].includes(a.status))
          .reduce((sum, a) => sum + Math.round(Number(a.amountDelta || 0) * 100), 0);
      const state = { label, order, adjustments, readbacks: readbacks.map(r => ({ id: Number(r.id), paidAmount: Number(r.paidAmount), paymentStatus: r.paymentStatus })), expected, canonical: canonical / 100 };
      evidence.stages.push(state);
      assert.equal(canonical, expected * 100, `${label}: independent ledger equation`);
      assert.equal(Math.round(Number(order.paidAmount) * 100), expected * 100, `${label}: applied adjustment must not disappear`);
      assert(readbacks.every(r => Math.round(Number(r.paidAmount) * 100) === expected * 100), `${label}: both application readbacks`);
      return state;
    };
    const originalPaymentId = await submit(orderId, 300); evidence.originalPaymentId = originalPaymentId;
    dataOf(await verify(orderId, originalPaymentId));
    const initial = await capture('initial-verified', orderId, 300);
    evidence.originalPayment = initial.order.paymentRecords[0];
    const correction = await adjust(orderId, 50, 'pending'); evidence.correctionId = Number(correction.id);
    await capture('pending-not-applied', orderId, 300);
    dataOf(await request(`/adjustments/${correction.id}/apply`, { actor: actors.finance2, method: 'POST', signal }));
    await capture('positive-adjustment-applied', orderId, 350);
    const cancelled = await adjust(orderId, 70, 'pending'); evidence.cancelledId = Number(cancelled.id);
    await reverse(cancelled.id);
    await capture('cancelled-pending-excluded', orderId, 350);
    const secondId = await submit(orderId, 100); dataOf(await verify(orderId, secondId));
    const adjusted = await capture('later-payment-preserves-adjustment', orderId, 450);
    if (process.env.ROUND2_BROWSER === 'true') {
      await require('./payment-adjustment-browser.cjs').paymentAdjustmentBrowser(ctx, adjusted.order, originalPaymentId, evidence, signal);
    }
    const reversal = await reverse(correction.id); evidence.correctionReversalId = Number(reversal.reverse.id);
    await capture('original-and-inverse-net-zero', orderId, 400);
    const thirdId = await submit(orderId, 100); dataOf(await verify(orderId, thirdId));
    await capture('later-payment-after-adjustment-reversal', orderId, 500);
    const negative = await adjust(orderId, -40, 'posted'); evidence.negativeId = Number(negative.id);
    await capture('negative-adjustment-applied', orderId, 460);
    const fourthId = await submit(orderId, 100); dataOf(await verify(orderId, fourthId));
    await capture('later-payment-preserves-negative-adjustment', orderId, 560);
    const negativeReverse = await reverse(negative.id); evidence.negativeReversalId = Number(negativeReverse.reverse.id);
    const final = await capture('negative-original-and-inverse-net-zero', orderId, 600);
    assert.deepEqual(final.order.paymentRecords.find(p => p.id === originalPaymentId), evidence.originalPayment, 'Original verified payment facts must remain intact');
    evidence.verifiedAudits = await prisma.auditLog.findMany({ where: { resource: 'payment', resourceId: { in: final.order.paymentRecords.map(p => p.id) }, action: 'PAYMENT_VERIFIED' }, orderBy: { id: 'asc' } });
    assert.equal(evidence.verifiedAudits.length, 4);

    const capacityId = await makeOrder(); evidence.capacityOrderId = capacityId;
    const baseId = await submit(capacityId, 300); dataOf(await verify(capacityId, baseId));
    const pendingId = await submit(capacityId, 700); await adjust(capacityId, 100, 'posted');
    const before = await capture('overbalance-before', capacityId, 400);
    const rejected = await verify(capacityId, pendingId);
    evidence.overbalance = { pendingId, response: rejected,
      auditCount: await prisma.auditLog.count({ where: { action: 'PAYMENT_VERIFIED', resource: 'payment', resourceId: pendingId } }),
      eventCount: await prisma.businessEvent.count({ where: { eventKey: `payment.verified:${pendingId}` } }) };
    assert.equal(rejected.status, 409, 'Cash plus applied adjustment must not exceed effective receivable');
    const after = await capture('overbalance-rejected-rollback', capacityId, 400);
    assert.deepEqual(after.order, before.order); assert.deepEqual(after.adjustments, before.adjustments);
    assert.equal(evidence.overbalance.auditCount, 0); assert.equal(evidence.overbalance.eventCount, 0);
    assert.equal(after.order.paymentRecords.find(p => p.id === pendingId).status, 'pending');
    await capture('other-order-does-not-leak', orderId, 600);
    return evidence;
  } catch (error) { error.evidence = evidence; throw error; }
}
module.exports = { paymentAdjustmentReconciliation };
