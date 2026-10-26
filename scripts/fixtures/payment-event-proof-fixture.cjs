// Synthetic unit-test evidence only. Never used by the real audit executor.
function paymentEventProofFixture(provider = 'postgresql') {
  const id = 'unit-fixture-event'; const at = '2026-10-02T00:00:00.000Z';
  const facts = { payment: { id: 7, orderId: 9, status: 'verified', amount: 300 }, order: { id: 9, paidAmount: 300, paymentStatus: 'partial' },
    audits: [{ id: 11, details: JSON.stringify({ eventId: id }) }],
    events: [{ id: 12, eventKey: 'payment.verified:7', payloadJson: JSON.stringify({ id, data: { auditId: 11 } }) }] };
  const font = { missingSignatures: ['missing1','missing2'], glyphs: Array.from({ length: 8 }, (_, i) => ({ signature: `glyph${i}`, inkPixels: 10 })) };
  const frame = { id, resourceId: 7 };
  return { provider, paymentId: 7, orderId: 9, errors: [],
    browser: [1,2].map((actorId, instance) => ({ actorId, instance, role: 'finance', pendingVisible: true })),
    browserVerification: { httpStatus: 200, entry: 'collections' },
    restart: { killed: 2, restarted: 2, signal: 'SIGKILL', databaseRestarted: false },
    claimBeforeCrash: { status: 'sending', leaseToken: 'original-lease', leaseExpiresAt: at },
    claimAfterKill: { status: 'sending', leaseToken: 'original-lease' },
    deliveryAfterRecovery: { status: 'delivered', attempts: 3, leaseToken: null, leaseExpiresAt: null, deliveredAt: '2026-10-02T00:00:31.000Z' },
    beforeSnapshot: structuredClone(facts), finalSnapshot: structuredClone(facts),
    crossEntryReplays: Array.from({ length: 8 }, (_, i) => ({ httpStatus: 200, entry: i%2 ? 'collections':'orders', instance: i%2 })),
    apiReadbacks: [0,1].map(instance => ({ instance, paidAmount: 300, paymentStatus: 'partial', paymentCount: 1 })),
    deliveryReceipts: ['realtime','webhook'].map(channel => ({ eventId: 12, channel, status: 'delivered' })),
    receiver: { attempts: [503,'ack-withheld',202].map(status => ({ status, eventId: id, digest: 'same-payload', signatureValid: true })),
      accepted: [{ eventId: id, digest: 'same-payload', amount: 300, effects: 1 }] },
    screenshots: [1,2].map(actorId => ({ actorId, path: `unit-fixture-${actorId}.png`, loadingHidden: true, unobscured: true, statusVisible: true, amountVisible: true, text: '已核销 300', font: structuredClone(font) })),
    frames: provider === 'postgresql' ? [[frame],[frame]] : [[frame],[]] };
}
module.exports = { paymentEventProofFixture };
