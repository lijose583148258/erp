const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { ensureReleasedMaterial } = require('./material-audit-fixture.cjs');

async function paymentSubmitProbe(ctx, signal) {
  const { request, dataOf, actors, prisma, runId } = ctx;
  const customer = dataOf(await request('/customers', { method: 'POST', signal, data: {
    name: `${runId}-submission`, nameZh: `${runId}-submission`, creditLimit: 100000, termsDays: 30,
    segment: 'direct', poolState: 'private', salespersonId: actors.sales.id,
  } }));
  const material = await ensureReleasedMaterial({ request: (endpoint, opts) => request(endpoint, { ...opts, signal }),
    code: `${runId}-submission`, name: `${runId}-submission`, category: 'finished_good', unit: 'kg' });
  const order = dataOf(await request('/orders', { actor: actors.sales, method: 'POST', signal, data: {
    customerId: Number(customer.id), items: [{ materialId: material.id, productName: material.nameZh, quantity: 10, unit: 'kg', unitPrice: 100 }], paymentTerms: 30,
  } }));
  const orderId = Number(order.id), key = crypto.randomUUID();
  const payload = { amount: 300, method: 'bank_transfer', payerName: 'Durable submission fixture', note: runId, idempotencyKey: key };
  const burst = await Promise.all(Array.from({ length: 8 }, (_, i) => request(`/orders/${orderId}/payment`, { actor: actors.sales, instance: i % 2, method: 'POST', signal, data: payload })));
  const first = burst[0]; dataOf(first);
  const originalReceipt = first.json.paymentSubmission;
  assert(originalReceipt && burst.every(r => r.status === 200 && JSON.stringify(r.json.paymentSubmission) === JSON.stringify(originalReceipt)));
  assert.equal(burst.filter(r => r.json.replayed === false).length, 1);
  const snapshot = async () => ({
    payments: await prisma.paymentRecord.findMany({ where: { orderId }, orderBy: { id: 'asc' } }),
    submissions: await prisma.paymentSubmission.findMany({ where: { payment: { orderId } }, orderBy: { id: 'asc' } }),
    audits: await prisma.auditLog.findMany({ where: { resource: 'order', resourceId: orderId, action: 'PAYMENT_SUBMITTED' }, orderBy: { id: 'asc' } }),
    order: await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, paidAmount: true, paymentStatus: true, updatedAt: true } }),
  });
  const before = await snapshot();
  const started = Date.now(); await delay(16000, undefined, { signal });
  const second = await request(`/orders/${orderId}/payment`, { actor: actors.sales, instance: 1, method: 'POST', signal, data: payload });
  const payments = await prisma.paymentRecord.findMany({ where: { orderId }, orderBy: { id: 'asc' } });
  const audits = await prisma.auditLog.findMany({ where: { resource: 'order', resourceId: orderId, action: 'PAYMENT_SUBMITTED' }, orderBy: { id: 'asc' } });
  const evidence = { scope: 'Durable API registration + real lost browser acknowledgement + dual app restart; not database-server restart', orderId, key,
    provider: process.env.AUDIT_PRISMA_PROVIDER || 'sqlite', originalReceipt, burst, before,
    elapsedMs: Date.now() - started, responses: [first, second], payments, audits, negatives: [] };
  try { assert.equal(second.status, 200); assert.equal(payments.length, 1, 'One persisted request must create exactly one payment');
    assert.equal(audits.length, 1); assert.deepEqual(second.json.paymentSubmission, originalReceipt); assert.deepEqual(await snapshot(), before);
    for (const [label, data, actor] of [['changed-amount', { ...payload, amount: 301 }, actors.sales], ['changed-method', { ...payload, method: 'cash' }, actors.sales],
      ['changed-date', { ...payload, date: '2026-10-04' }, actors.sales], ['changed-note', { ...payload, note: 'other' }, actors.sales],
      ['changed-payer', { ...payload, payerName: 'other' }, actors.sales], ['changed-proxy', { ...payload, isProxy: true }, actors.sales], ['different-principal', payload, actors.finance1],
      ['missing-key', { amount: 300, method: 'bank_transfer' }, actors.sales]]) {
      const r = await request(`/orders/${orderId}/payment`, { actor, instance: 1, method: 'POST', signal, data });
      evidence.negatives.push({ label, status: r.status, code: r.json.errorCode }); assert.equal(r.status, label === 'missing-key' ? 400 : 409);
    }
    const otherOrder = dataOf(await request('/orders', { actor: actors.sales, method: 'POST', signal, data: {
      customerId: Number(customer.id), items: [{ materialId: material.id, productName: material.nameZh, quantity: 10, unit: 'kg', unitPrice: 100 }], paymentTerms: 30,
    } }));
    const otherId = Number(otherOrder.id);
    const foreign = await request(`/orders/${otherId}/payment`, { actor: actors.sales, instance: 1, method: 'POST', signal, data: payload });
    assert.equal(foreign.status, 409); assert.equal(await prisma.paymentRecord.count({ where: { orderId: otherId } }), 0);
    assert.equal(await prisma.auditLog.count({ where: { resource: 'order', resourceId: otherId, action: 'PAYMENT_SUBMITTED' } }), 0);
    evidence.negatives.push({ label: 'different-order', status: foreign.status, code: foreign.json.errorCode, paymentCount: 0, auditCount: 0 });
    const makeOrder = async () => dataOf(await request('/orders', { actor: actors.sales, method: 'POST', signal, data: {
      customerId: Number(customer.id), items: [{ materialId: material.id, productName: material.nameZh, quantity: 10, unit: 'kg', unitPrice: 100 }], paymentTerms: 30,
    } }));
    const raceOrder = await makeOrder(), collisionKey = crypto.randomUUID(), collisionIds = [otherId, Number(raceOrder.id)];
    const collide = await Promise.all(collisionIds.map((id, instance) => request(`/orders/${id}/payment`, { actor: actors.sales, instance, method: 'POST', signal,
      data: { ...payload, amount: 100, idempotencyKey: collisionKey } })));
    assert.deepEqual(collide.map(r => r.status).sort(), [200,409]);
    evidence.crossOrderRace = { statuses: collide.map(r => r.status), orderIds: collisionIds,
      paymentCount: await prisma.paymentRecord.count({ where: { orderId: { in: collisionIds } } }),
      auditCount: await prisma.auditLog.count({ where: { resource: 'order', resourceId: { in: collisionIds }, action: 'PAYMENT_SUBMITTED' } }),
      identityCount: await prisma.paymentSubmission.count({ where: { requestKey: collisionKey } }) };
    const capacityOrder = await makeOrder(), capacityId = Number(capacityOrder.id);
    const contend = await Promise.all([0,1].map(instance => request(`/orders/${capacityId}/payment`, { actor: actors.sales, instance, method: 'POST', signal,
      data: { ...payload, amount: 600, idempotencyKey: crypto.randomUUID() } })));
    assert.deepEqual(contend.map(r => r.status).sort(), [200,409]);
    evidence.capacityRace = { statuses: contend.map(r => r.status), orderId: capacityId,
      paymentCount: await prisma.paymentRecord.count({ where: { orderId: capacityId } }),
      auditCount: await prisma.auditLog.count({ where: { resource: 'order', resourceId: capacityId, action: 'PAYMENT_SUBMITTED' } }),
      identityCount: await prisma.paymentSubmission.count({ where: { payment: { orderId: capacityId } } }),
      amount: Number((await prisma.paymentRecord.aggregate({ where: { orderId: capacityId }, _sum: { amount: true } }))._sum.amount) };
    const capacity = await request(`/orders/${orderId}/payment`, { actor: actors.sales, instance: 1, method: 'POST', signal,
      data: { ...payload, amount: 800, idempotencyKey: crypto.randomUUID() } });
    assert.equal(capacity.status, 409); evidence.negatives.push({ label: 'pending-capacity', status: capacity.status, code: capacity.json.errorCode });
    assert.deepEqual(await snapshot(), before);
    const genuine = await request(`/orders/${orderId}/payment`, { actor: actors.sales, instance: 1, method: 'POST', signal, data: { ...payload, idempotencyKey: crypto.randomUUID() } });
    dataOf(genuine); evidence.genuineSecondReceipt = genuine.json.paymentSubmission;
    assert.notEqual(evidence.genuineSecondReceipt.paymentId, originalReceipt.paymentId); evidence.twoGenuine = await snapshot(); assert.equal(evidence.twoGenuine.payments.length, 2);
    for (const id of [originalReceipt.paymentId, evidence.genuineSecondReceipt.paymentId]) dataOf(await request(`/orders/${orderId}/payment/${id}/verify`, { actor: actors.finance1, method: 'POST', signal }));
    evidence.afterVerification = await snapshot();
    const verifiedReplay = await request(`/orders/${orderId}/payment`, { actor: actors.sales, instance: 1, method: 'POST', signal, data: payload });
    assert.equal(verifiedReplay.status, 200); assert.deepEqual(verifiedReplay.json.paymentSubmission, originalReceipt); assert.deepEqual(await snapshot(), evidence.afterVerification);
    evidence.verifiedReplay = verifiedReplay;
    await require('./enterprise-round2-payment-submit-browser.cjs').paymentSubmitBrowser(ctx, order, snapshot, evidence, signal);
    evidence.immutabilityGuards = [];
    for (const action of ['UPDATE "payment_submissions" SET "result_json"=\'{}\' WHERE "payment_id"=', 'DELETE FROM "payment_submissions" WHERE "payment_id"=']) {
      let rejected = false;
      try { await prisma.$executeRawUnsafe(`${action}${originalReceipt.paymentId}`); } catch (error) { rejected = String(error.message).includes('PAYMENT_SUBMISSION_IMMUTABLE'); }
      assert(rejected, 'Database must reject changing or deleting an accepted submission identity'); evidence.immutabilityGuards.push({ operation: action.startsWith('UPDATE') ? 'update' : 'delete', rejected });
    }
    assert.deepEqual(await snapshot(), evidence.finalSnapshot);
    evidence.proof = require('./payment-submission-proof.cjs').verifyPaymentSubmissionProof(evidence, evidence.provider);
    return evidence;
  } catch (error) { error.evidence = evidence; throw error; }
}
module.exports = { paymentSubmitProbe };
