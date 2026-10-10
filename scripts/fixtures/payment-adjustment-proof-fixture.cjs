// Synthetic contract-test data only. Never imported by an audit executor.
function paymentAdjustmentProofFixture() {
  const payment = (id, amount, status = 'verified', orderId = 1) => ({ id, orderId, amount, status });
  const adj = (id, amountDelta, status = 'posted', applied = true, orderId = 1) => ({ id, orderId, domain: 'finance', amountDelta, status, appliedAt: applied ? '2026-01-01T00:00:01Z' : null });
  const stages = [], add = (label, expected, payments, adjustments, orderId = 1) => stages.push({ label, expected, canonical: expected,
    order: { id: orderId, paidAmount: expected, paymentStatus: 'partial', paymentRecords: payments }, adjustments,
    readbacks: [0,1].map(() => ({ id: orderId, paidAmount: expected, paymentStatus: 'partial' })) });
  const cash = n => [300,100,100,100].slice(0,n).map((amount,i) => payment(i+1,amount));
  const positive = adj(1,50), cancelled = adj(2,70,'reversed',false);
  const reversedPositive = adj(1,50,'reversed'), inverse = adj(3,-50), negative = adj(4,-40), reversedNegative = adj(4,-40,'reversed'), negativeInverse = adj(5,40);
  add('initial-verified',300,cash(1),[]); add('pending-not-applied',300,cash(1),[adj(1,50,'pending',false)]);
  add('positive-adjustment-applied',350,cash(1),[positive]); add('cancelled-pending-excluded',350,cash(1),[positive,cancelled]);
  add('later-payment-preserves-adjustment',450,cash(2),[positive,cancelled]);
  add('original-and-inverse-net-zero',400,cash(2),[reversedPositive,cancelled,inverse]);
  add('later-payment-after-adjustment-reversal',500,cash(3),[reversedPositive,cancelled,inverse]);
  add('negative-adjustment-applied',460,cash(3),[reversedPositive,cancelled,inverse,negative]);
  add('later-payment-preserves-negative-adjustment',560,cash(4),[reversedPositive,cancelled,inverse,negative]);
  const finalAdjustments = [reversedPositive,cancelled,inverse,reversedNegative,negativeInverse];
  add('negative-original-and-inverse-net-zero',600,cash(4),finalAdjustments);
  for (const label of ['overbalance-before','overbalance-rejected-rollback']) add(label,400,[payment(5,300,'verified',2),payment(6,700,'pending',2)],[adj(6,100,'posted',true,2)],2);
  add('other-order-does-not-leak',600,cash(4),finalAdjustments);
  const barter = { order: { id: 3, paidAmount: 160, paymentRecords: [payment(7,150,'verified',3)] }, settlement: { status: 'posted' } };
  const font = { missingSignatures: ['missing1','missing2'], glyphs: Array.from({ length: 8 }, (_, i) => ({ signature: `glyph${i}`, inkPixels: 10 })) };
  return structuredClone({ version: 'payment-adjustment-reconciliation/v1', orderId: 1, capacityOrderId: 2,
    browserErrors: [], browserReadbacks: [1,2].map((actorId,instance) => ({ actorId, instance, role: 'finance', orderId: 1,
      paidAmount: 450, amountVisible: true, text: '累计已收 450.00', path: `synthetic-finance-${actorId}.png`, font })),
    originalPaymentId: 1, originalPayment: payment(1,300), correctionId: 1, cancelledId: 2, correctionReversalId: 3, negativeId: 4, negativeReversalId: 5,
    stages, verifiedAudits: [1,2,3,4].map(id => ({ resource: 'payment', resourceId: id, action: 'PAYMENT_VERIFIED' })),
    overbalance: { pendingId: 6, response: { status: 409 }, auditCount: 0, eventCount: 0 },
    barterRebuild: { posted: barter, reversed: { order: { id: 3, paidAmount: 10, paymentRecords: [payment(7,150,'reversed',3)] }, settlement: { status: 'reversed' } },
      adjustments: [adj(7,10,'posted',true,3)], readbacks: [0,1].map(() => ({ id: 3, paidAmount: 10 })) } });
}
module.exports = { paymentAdjustmentProofFixture };
