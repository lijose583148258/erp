jest.mock('../config/database', () => ({ __esModule: true, default: {} }));
import { recordPaymentReversedEventTx, paymentReversalEventKey } from './payment-reversal-event.service';
import { requestReversalFingerprint, reviewReversalFingerprint } from './payment-reversal-receipts';

const instant = new Date('2026-10-03T12:00:00.000Z');
function fixture() {
  const facts = { reasonCategory: 'bank_return', reason: 'Bank returned original transfer' };
  const request = { id: 'request-id', requestKey: 'request-key', paymentId: 7, requestedBy: 1, ...facts,
    originalPaymentJson: JSON.stringify({ version: 'original-payment-facts/v1', id: 7, orderId: 9, amount: 300, currency: 'CNY', exchangeRate: 1 }),
    requestAuditId: 12, originalAuditId: 11, createdAt: instant, activePaymentId: null, status: 'posted', reviewKey: 'review-key',
    reviewedBy: 2, reviewAuditId: 13, reviewedAt: instant, reviewNote: 'Independently checked bank return',
    fingerprint: '', requestReceiptJson: '', reviewFingerprint: '', reviewReceiptJson: '' };
  request.fingerprint = requestReversalFingerprint(7, 1, facts as any, request.originalPaymentJson);
  request.requestReceiptJson = JSON.stringify({ version: 'payment-reversal-request/v1', requestId: request.id, requestKey: request.requestKey,
    paymentId: 7, orderId: 9, requestedBy: 1, amount: 300, currency: 'CNY', status: 'pending', auditId: 12,
    requestedAt: instant.toISOString(), ...facts });
  request.reviewFingerprint = reviewReversalFingerprint(request.id, 2, { decision: 'approve', note: request.reviewNote });
  request.reviewReceiptJson = JSON.stringify({ version: 'payment-reversal-review/v1', requestId: request.id, reviewKey: request.reviewKey,
    paymentId: 7, orderId: 9, reversalId: 'effect-id', status: 'posted', requestedBy: 1, reviewedBy: 2, amount: -300, currency: 'CNY',
    auditId: 13, reviewedAt: instant.toISOString(), beforePaidAmount: 350, afterPaidAmount: 50 });
  const effect = { id: 'effect-id', requestId: request.id, paymentId: 7, postedBy: 2, auditId: 13, amount: -300, currency: 'CNY',
    receiptJson: request.reviewReceiptJson, createdAt: instant,
    beforeStateJson: JSON.stringify({ orderId: 9, paidAmount: 350, paymentStatus: 'partial' }),
    afterStateJson: JSON.stringify({ orderId: 9, paidAmount: 50, paymentStatus: 'partial' }), request,
    payment: { id: 7, orderId: 9, status: 'reversed' } };
  const details = { requestId: request.id, reversalId: effect.id, requestedBy: 1, reviewedBy: 2, decision: 'approve',
    note: request.reviewNote, orderId: 9, amount: -300, currency: 'CNY', beforePaidAmount: 350, afterPaidAmount: 50 };
  const audit = { id: 13, action: 'PAYMENT_REVERSED', userId: 2, resource: 'payment', resourceId: 7, details: JSON.stringify(details) };
  const tx = { paymentReversal: { findUniqueOrThrow: jest.fn().mockResolvedValue(effect) },
    auditLog: { findUniqueOrThrow: jest.fn().mockResolvedValue(audit), create: jest.fn() },
    businessEvent: { create: jest.fn().mockResolvedValue({ id: 20 }) } };
  return { tx, effect, request, audit, details };
}
const oldEndpoints = process.env.AILAODA_WEBHOOK_ENDPOINTS;
afterEach(() => { if (oldEndpoints === undefined) delete process.env.AILAODA_WEBHOOK_ENDPOINTS; else process.env.AILAODA_WEBHOOK_ENDPOINTS = oldEndpoints; });

test('event factory binds one reversal, reuses existing audit, and writes only to the supplied transaction', async () => {
  process.env.AILAODA_WEBHOOK_ENDPOINTS = '';
  const { tx, effect } = fixture();
  expect(await recordPaymentReversedEventTx(tx as any, effect.id)).toEqual({ id: 20 });
  const data = tx.businessEvent.create.mock.calls[0][0].data;
  const payload = JSON.parse(data.payloadJson);
  expect(data).toMatchObject({ eventKey: paymentReversalEventKey(7), eventType: 'payment.reversed', aggregateType: 'payment', aggregateId: '7', createdAt: instant });
  expect(payload).toMatchObject({ type: 'payment.reversed', resourceType: 'payment', resourceId: 7, occurredAt: instant.toISOString(),
    data: { paymentId: 7, orderId: 9, reversalId: effect.id, requestId: effect.requestId, amount: -300, currency: 'CNY', requestedBy: 1,
      reviewedBy: 2, auditId: 13, beforePaidAmount: 350, afterPaidAmount: 50 } });
  expect(payload.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(tx.auditLog.create).not.toHaveBeenCalled();
  expect(data.deliveries.create).toEqual([{ channel: 'realtime', destinationKey: 'finance-notifications' }]);
});

test('reversal subscriptions are distinct from verified-only subscriptions and snapshot no secrets', async () => {
  process.env.AILAODA_WEBHOOK_ENDPOINTS = JSON.stringify([
    { url: 'https://example.invalid/reversal', secret: 'first-secret', events: ['payment.reversed'] },
    { url: 'https://example.invalid/reversal', secret: 'second-secret', events: ['payment.reversed'] },
    { url: 'https://example.invalid/verified', secret: 'third-secret', events: ['payment.verified'] },
  ]);
  const { tx, effect } = fixture();
  await recordPaymentReversedEventTx(tx as any, effect.id);
  const data = tx.businessEvent.create.mock.calls[0][0].data;
  expect(data.deliveries.create).toHaveLength(2);
  expect(data.deliveries.create[1]).toMatchObject({ channel: 'webhook', destinationKey: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(JSON.stringify(data)).not.toMatch(/https|first-secret|second-secret|third-secret/);
});

test.each([{ id: 8 }, { orderId: 10 }, { status: 'verified' }, { status: 'pending' }])('unbound original payment %p cannot generate an event', async override => {
  const { tx, effect } = fixture(); effect.payment = { ...effect.payment, ...override };
  await expect(recordPaymentReversedEventTx(tx as any, effect.id)).rejects.toThrow('PAYMENT_EVENT_REQUIRES_POSTED_REVERSAL');
  expect(tx.businessEvent.create).not.toHaveBeenCalled();
});

test.each([{ id: 14 }, { action: 'PAYMENT_VERIFIED' }, { userId: 3 }, { resource: 'order' }, { resourceId: 8 },
  { details: null }, { details: 'null' }, { details: '[]' }, { details: '{' }])('unbound original reversal audit %p cannot generate an event', async override => {
  const { tx, effect, audit } = fixture(); tx.auditLog.findUniqueOrThrow.mockResolvedValue({ ...audit, ...override } as any);
  await expect(recordPaymentReversedEventTx(tx as any, effect.id)).rejects.toThrow('PAYMENT_EVENT_REQUIRES_POSTED_REVERSAL');
  expect(tx.businessEvent.create).not.toHaveBeenCalled();
});

test.each([{ requestId: 'other-request' }, { reversalId: 'other-effect' }, { requestedBy: 2 }, { reviewedBy: 3 }, { decision: 'reject' },
  { note: 'Different review note' }, { orderId: 10 }, { amount: -299 }, { currency: 'USD' }, { beforePaidAmount: 351 }, { afterPaidAmount: 51 }])(
  'corrupt audit details %p cannot generate a financial notification', async override => {
    const { tx, effect, audit, details } = fixture(); audit.details = JSON.stringify({ ...details, ...override });
    await expect(recordPaymentReversedEventTx(tx as any, effect.id)).rejects.toThrow('PAYMENT_EVENT_REQUIRES_POSTED_REVERSAL');
    expect(tx.businessEvent.create).not.toHaveBeenCalled();
  });

test('corrupt immutable effect fails before audit lookup or event insertion', async () => {
  const { tx, effect } = fixture(); effect.amount = -299;
  await expect(recordPaymentReversedEventTx(tx as any, effect.id)).rejects.toMatchObject({ code: 'PAYMENT_REVERSAL_RECEIPT_INVALID' });
  expect(tx.auditLog.findUniqueOrThrow).not.toHaveBeenCalled(); expect(tx.businessEvent.create).not.toHaveBeenCalled();
});

test('audit unavailable and event insertion failure propagate to the owning transaction', async () => {
  const f = fixture(); f.tx.auditLog.findUniqueOrThrow.mockRejectedValue(new Error('audit unavailable'));
  await expect(recordPaymentReversedEventTx(f.tx as any, f.effect.id)).rejects.toThrow('audit unavailable');
  expect(f.tx.businessEvent.create).not.toHaveBeenCalled();
  const g = fixture(); g.tx.businessEvent.create.mockRejectedValue(new Error('outbox database unavailable'));
  await expect(recordPaymentReversedEventTx(g.tx as any, g.effect.id)).rejects.toThrow('outbox database unavailable');
  expect(g.tx.auditLog.create).not.toHaveBeenCalled();
});
