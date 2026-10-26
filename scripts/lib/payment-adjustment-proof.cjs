const assert = require('node:assert/strict');
const cents = value => { assert(Number.isFinite(Number(value)), 'Finite ledger amounts required'); return Math.round(Number(value) * 100); };
const expectedStages = [ ['initial-verified',300], ['pending-not-applied',300], ['positive-adjustment-applied',350],
  ['cancelled-pending-excluded',350], ['later-payment-preserves-adjustment',450], ['original-and-inverse-net-zero',400],
  ['later-payment-after-adjustment-reversal',500], ['negative-adjustment-applied',460], ['later-payment-preserves-negative-adjustment',560],
  ['negative-original-and-inverse-net-zero',600], ['overbalance-before',400], ['overbalance-rejected-rollback',400], ['other-order-does-not-leak',600] ];
function verifyPaymentAdjustmentProof(evidence, { requireBarter = true, requireBrowser = requireBarter } = {}) {
  assert.equal(evidence?.version, 'payment-adjustment-reconciliation/v1');
  assert.equal(evidence.stages?.length, expectedStages.length, 'Every prior/new stage is required');
  for (const [[label, expected], s] of expectedStages.map((entry, i) => [entry, evidence.stages[i]])) {
    assert.equal(s.label, label); assert.equal(cents(s.expected), expected * 100); assert.equal(cents(s.canonical), expected * 100);
    assert.equal(s.order.id, label.startsWith('overbalance-') ? evidence.capacityOrderId : evidence.orderId);
    const cash = s.order.paymentRecords.filter(p => p.status === 'verified').reduce((sum, p) => sum + cents(p.amount), 0);
    const applied = s.adjustments.filter(a => a.domain === 'finance' && a.appliedAt && ['posted','reversed'].includes(a.status))
      .reduce((sum, a) => sum + cents(a.amountDelta || 0), 0);
    assert.equal(cash + applied, expected * 100, `${label}: recompute from raw facts, not a passed flag`);
    assert.equal(cents(s.order.paidAmount), expected * 100); assert.equal(s.order.paymentStatus, 'partial');
    assert.equal(s.readbacks.length, 2); assert(s.readbacks.every(r => r.id === s.order.id && cents(r.paidAmount) === expected * 100 && r.paymentStatus === 'partial'));
    assert(s.adjustments.every(a => a.orderId === s.order.id), 'No unrelated order contribution');
  }
  const stage = label => evidence.stages.find(s => s.label === label);
  const cancelled = stage('cancelled-pending-excluded').adjustments.find(a => a.id === evidence.cancelledId);
  assert.equal(cancelled.status, 'reversed'); assert.equal(cancelled.appliedAt, null);
  const final = stage('negative-original-and-inverse-net-zero');
  for (const [originalId, reverseId] of [[evidence.correctionId,evidence.correctionReversalId], [evidence.negativeId,evidence.negativeReversalId]]) {
    const original = final.adjustments.find(a => a.id === originalId), inverse = final.adjustments.find(a => a.id === reverseId);
    assert(original?.appliedAt && inverse?.appliedAt); assert.equal(original.status, 'reversed'); assert.equal(inverse.status, 'posted');
    assert.equal(cents(original.amountDelta) + cents(inverse.amountDelta), 0);
  }
  assert.deepEqual(final.order.paymentRecords.find(p => p.id === evidence.originalPaymentId), evidence.originalPayment);
  assert.equal(final.order.paymentRecords.length, 4); assert(final.order.paymentRecords.every(p => p.status === 'verified'));
  assert.equal(evidence.verifiedAudits.length, 4);
  for (const p of final.order.paymentRecords) assert.equal(evidence.verifiedAudits.filter(a => a.resource === 'payment' && a.action === 'PAYMENT_VERIFIED' && a.resourceId === p.id).length, 1);
  const before = stage('overbalance-before'), after = stage('overbalance-rejected-rollback');
  assert.equal(evidence.overbalance.response.status, 409); assert.equal(evidence.overbalance.auditCount, 0); assert.equal(evidence.overbalance.eventCount, 0);
  assert.deepEqual(after.order, before.order); assert.deepEqual(after.adjustments, before.adjustments);
  assert.equal(after.order.paymentRecords.find(p => p.id === evidence.overbalance.pendingId).status, 'pending');
  if (requireBarter) {
    const b = evidence.barterRebuild; assert(b, 'Actual API barter rebuild/reversal proof required');
    assert.equal(cents(b.posted.order.paidAmount), 16000); assert.equal(cents(b.reversed.order.paidAmount), 1000);
    assert.equal(b.posted.settlement.status, 'posted'); assert.equal(b.reversed.settlement.status, 'reversed');
    assert.equal(b.posted.order.paymentRecords.length, 1); assert.equal(b.reversed.order.paymentRecords.length, 1);
    const original = b.posted.order.paymentRecords[0], reversed = b.reversed.order.paymentRecords[0];
    assert.equal(original.status, 'verified'); assert.equal(reversed.status, 'reversed'); assert.equal(cents(original.amount), 15000);
    if (original.updatedAt) assert(Date.parse(reversed.updatedAt) >= Date.parse(original.updatedAt), 'Lifecycle metadata cannot move backwards');
    assert.deepEqual({ ...reversed, status: original.status, ...(original.updatedAt ? { updatedAt: original.updatedAt } : {}) }, original, 'Only barter payment lifecycle/updatedAt change; financial facts remain');
    assert.equal(b.adjustments.length, 1); assert.equal(cents(b.adjustments[0].amountDelta), 1000); assert(b.adjustments[0].appliedAt);
    assert.equal(b.readbacks.length, 2); assert(b.readbacks.every(r => r.id === b.reversed.order.id && cents(r.paidAmount) === 1000));
  }
  if (requireBrowser) {
    assert.equal(evidence.browserReadbacks?.length, 2, 'Two independent finance browser readbacks required');
    assert.equal(new Set(evidence.browserReadbacks.map(s => s.actorId)).size, 2);
    assert.equal(new Set(evidence.browserReadbacks.map(s => s.instance)).size, 2);
    for (const s of evidence.browserReadbacks) {
      assert.equal(s.role, 'finance'); assert.equal(s.orderId, evidence.orderId); assert.equal(cents(s.paidAmount), 45000);
      assert.equal(s.amountVisible, true); assert(s.path); assert.match(s.text, /累计已收/); assert.match(s.text, /450\.00/);
      require('./browser-cjk-font-guard.cjs').assertCjkRasterEvidence(s.font);
    }
    assert.deepEqual(evidence.browserErrors, []);
  }
  return { stages: expectedStages.length, canonicalLedgerVerified: true, barterRebuildVerified: requireBarter };
}
module.exports = { verifyPaymentAdjustmentProof };
