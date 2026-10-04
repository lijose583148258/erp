jest.mock('../config/database', () => ({ __esModule: true, default: {} }));
jest.mock('./realtime-notification.service', () => ({ publishDurableRealtimeNotification: jest.fn().mockResolvedValue(undefined) }));
import { drainPaymentEventOutbox, paymentEventRetryDelay } from './payment-event-outbox.service';
import { paymentWebhookDestinations, recordPaymentVerifiedEventTx } from './payment-verification-event.service';
import { publishDurableRealtimeNotification } from './realtime-notification.service';

const instant = new Date('2026-10-02T00:00:00.000Z');
const event = { id: 'stable-event-id', type: 'payment.verified', resourceType: 'payment', resourceId: 7, occurredAt: instant.toISOString(),
  data: { paymentId: 7, orderId: 9, amount: 300, currency: 'CNY', auditId: 11, verifiedBy: 2 } };
const reversalEvent = { ...event, type: 'payment.reversed', data: { paymentId: 7, orderId: 9, amount: -300, currency: 'CNY', auditId: 12,
  reversalId: 'reversal-id', requestId: 'request-id', requestedBy: 1, reviewedBy: 2, beforePaidAmount: 350, afterPaidAmount: 50 } };
function fixture(payloadJson = JSON.stringify(event), storedOverrides: object = {}, candidateOverrides: object = {}) {
  const parsedType = (() => { try { return JSON.parse(payloadJson).type; } catch { return event.type; } })();
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const db = { businessEventDelivery: {
    findMany: jest.fn().mockResolvedValue([{ id: 1, eventId: 19, channel: 'webhook', destinationKey: 'target', attempts: 0,
      event: { id: 19, eventType: parsedType, eventKey: `${parsedType}:7`, aggregateType: 'payment', aggregateId: '7', createdAt: instant,
        payloadJson, ...storedOverrides }, ...candidateOverrides }]),
    updateMany,
  } };
  return { db: db as any, updateMany };
}

describe('payment event durable delivery', () => {
  const oldEndpoints = process.env.AILAODA_WEBHOOK_ENDPOINTS;
  afterEach(() => { if (oldEndpoints === undefined) delete process.env.AILAODA_WEBHOOK_ENDPOINTS; else process.env.AILAODA_WEBHOOK_ENDPOINTS = oldEndpoints; jest.restoreAllMocks(); });

  it('claims conditionally and acknowledges with the same lease token', async () => {
    const { db, updateMany } = fixture();
    const send = jest.fn().mockResolvedValue({ ok: true });
    expect(await drainPaymentEventOutbox({ db, now: () => instant, send })).toMatchObject({ claimed: 1, delivered: 1 });
    expect(send.mock.calls[0][1]).toEqual(event);
    const claim = updateMany.mock.calls[0][0];
    expect(claim.where.OR).toHaveLength(2);
    expect(claim.data.leaseExpiresAt.getTime() - instant.getTime()).toBe(30_000);
    expect(updateMany.mock.calls[1][0].where).toEqual({ id: 1, status: 'sending', leaseToken: claim.data.leaseToken });
  });
  it('losing worker does not send', async () => {
    const { db, updateMany } = fixture(); updateMany.mockResolvedValue({ count: 0 });
    const send = jest.fn();
    expect((await drainPaymentEventOutbox({ db, send })).claimed).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
  it('failure stays pending, backs off and does not persist sensitive errors', async () => {
    const { db, updateMany } = fixture();
    await drainPaymentEventOutbox({ db, now: () => instant, send: async () => ({ ok: false, errorCode: 'https://user:secret@example.invalid' }) });
    expect(updateMany.mock.calls[1][0].data).toMatchObject({ status: 'pending', lastErrorCode: 'DELIVERY_ERROR', nextAttemptAt: new Date(instant.getTime() + 1000) });
    expect(paymentEventRetryDelay(10000)).toBe(300_000);
  });
  it('send exception cannot turn into a successful receipt', async () => {
    const { db, updateMany } = fixture();
    expect((await drainPaymentEventOutbox({ db, send: async () => { throw new Error('secret'); } })).deferred).toBe(1);
    expect(updateMany.mock.calls[1][0].data.lastErrorCode).toBe('DELIVERY_ERROR');
  });
  it('acknowledgment database failure is not swallowed as delivery success', async () => {
    const { db, updateMany } = fixture(); updateMany.mockResolvedValueOnce({ count: 1 }).mockRejectedValueOnce(new Error('db-down'));
    await expect(drainPaymentEventOutbox({ db, send: async () => ({ ok: true }) })).rejects.toThrow('db-down');
  });
  it('stale worker cannot overwrite a newer lease', async () => {
    const { db, updateMany } = fixture(); updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect(await drainPaymentEventOutbox({ db, send: async () => ({ ok: true }) })).toMatchObject({ delivered: 0, leaseLost: 1 });
  });
  it('invalid stored payload is retained without making network calls', async () => {
    const { db } = fixture('{"type":"payment.verified"}'); const send = jest.fn();
    expect((await drainPaymentEventOutbox({ db, send })).deferred).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });
  it('shutdown stops before claiming another row', async () => {
    const { db, updateMany } = fixture();
    await drainPaymentEventOutbox({ db, shouldStop: () => true });
    expect(updateMany).not.toHaveBeenCalled();
  });
  it('removed destination is visibly pending, not rerouted or declared delivered', async () => {
    process.env.AILAODA_WEBHOOK_ENDPOINTS = '';
    const { db, updateMany } = fixture();
    expect((await drainPaymentEventOutbox({ db })).deferred).toBe(1);
    expect(updateMany.mock.calls[1][0].data.lastErrorCode).toBe('DESTINATION_NOT_CONFIGURED');
  });
  it('snapshots one hashed destination per URL without storing secrets', async () => {
    process.env.AILAODA_WEBHOOK_ENDPOINTS = JSON.stringify([
      { url: 'https://example.invalid', secret: 'first' },
      { url: 'https://example.invalid/', secret: 'second' },
      { url: 'https://example.invalid/other', events: ['order.created'] },
    ]);
    expect(paymentWebhookDestinations().size).toBe(1);
    const tx = {
      paymentRecord: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 7, orderId: 9, amount: 300, currency: 'CNY', status: 'verified' }) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 11 }) },
      businessEvent: { create: jest.fn().mockResolvedValue({ id: 12 }) },
    };
    await recordPaymentVerifiedEventTx(tx as any, 7, 2);
    const data = tx.businessEvent.create.mock.calls[0][0].data;
    expect(data.eventKey).toBe('payment.verified:7');
    expect(data.deliveries.create).toHaveLength(2);
    expect(JSON.stringify(data)).not.toMatch(/first|second|https/);
    expect(JSON.parse(data.payloadJson).id).toBe(JSON.parse(tx.auditLog.create.mock.calls[0][0].data.details).eventId);
    expect(JSON.parse(data.payloadJson).data.auditId).toBe(11);
  });
  it('audit failure prevents any event write', async () => {
    const tx = {
      paymentRecord: { findUniqueOrThrow: jest.fn().mockResolvedValue({ status: 'verified' }) },
      auditLog: { create: jest.fn().mockRejectedValue(new Error('audit failed')) },
      businessEvent: { create: jest.fn() },
    };
    await expect(recordPaymentVerifiedEventTx(tx as any, 7, 2)).rejects.toThrow('audit failed');
    expect(tx.businessEvent.create).not.toHaveBeenCalled();
  });
});

describe('payment reversal outbox identity and immutable payload binding (mock transport only)', () => {
  test('a valid reversal uses its own type and exact immutable before/after balance', async () => {
    const { db } = fixture(JSON.stringify(reversalEvent));
    const send = jest.fn().mockResolvedValue({ ok: true });
    expect(await drainPaymentEventOutbox({ db, now: () => instant, send })).toMatchObject({ delivered: 1, deferred: 0 });
    expect(send).toHaveBeenCalledWith(expect.anything(), reversalEvent);
    expect(db.businessEventDelivery.findMany.mock.calls[0][0].where.event.eventType.in).toEqual(['payment.verified', 'payment.reversed']);
  });

  test.each([
    { eventType: 'payment.verified' }, { eventKey: 'payment.verified:7' }, { eventKey: 'payment.reversed:8' },
    { eventKey: null }, { aggregateType: 'order' }, { aggregateId: '8' }, { aggregateId: '07' }, { id: 20 },
    { createdAt: new Date(instant.getTime() + 1) }, { createdAt: '2026-10-02T00:00:00.000Z' },
  ])('corrupt durable event owner %p stays pending without sending', async overrides => {
    const { db, updateMany } = fixture(JSON.stringify(reversalEvent), overrides);
    const send = jest.fn();
    expect((await drainPaymentEventOutbox({ db, send })).deferred).toBe(1);
    expect(send).not.toHaveBeenCalled();
    expect(updateMany.mock.calls[1][0].data).toMatchObject({ status: 'pending', lastErrorCode: 'DELIVERY_ERROR' });
  });

  test.each([
    { paymentId: 8 }, { paymentId: '7' }, { orderId: 0 }, { orderId: Number.MAX_SAFE_INTEGER + 1 }, { auditId: null },
    { amount: 300 }, { amount: 0 }, { amount: -300.001 }, { amount: -Number.MAX_SAFE_INTEGER }, { currency: 'USD' },
    { requestedBy: undefined }, { reviewedBy: undefined }, { requestedBy: 2 }, { requestedBy: 0 }, { reviewedBy: '2' },
    { reversalId: '' }, { reversalId: '../path' }, { requestId: null }, { requestId: ' ' },
    { beforePaidAmount: 300 }, { afterPaidAmount: 51 }, { beforePaidAmount: -1 }, { afterPaidAmount: -1 },
    { beforePaidAmount: 350.001 }, { afterPaidAmount: 50.001 }, { afterPaidAmount: undefined },
  ])('corrupt reversal financial or actor facts %p are not delivered', async overrides => {
    const { db } = fixture(JSON.stringify({ ...reversalEvent, data: { ...reversalEvent.data, ...overrides } }));
    const send = jest.fn();
    expect((await drainPaymentEventOutbox({ db, send })).deferred).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  test.each([{ resourceId: 8 }, { resourceId: '7' }, { resourceType: 'order' }, { data: [] }, { id: '../unsafe-id' },
    { occurredAt: '2026-10-02T01:00:00+01:00' }])('corrupt envelope %p is not accepted', async overrides => {
    const { db } = fixture(JSON.stringify({ ...reversalEvent, ...overrides }));
    const send = jest.fn();
    expect((await drainPaymentEventOutbox({ db, send })).deferred).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  test('delivery FK and included event ID must match', async () => {
    const { db } = fixture(JSON.stringify(reversalEvent), {}, { eventId: 20 });
    const send = jest.fn();
    expect((await drainPaymentEventOutbox({ db, send })).deferred).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  test.each([0.29, 1.1, 10.01])('decimal cents %p are validated without binary-point false failures', async amount => {
    const data = { ...reversalEvent.data, amount: -amount, beforePaidAmount: amount, afterPaidAmount: 0 };
    const { db } = fixture(JSON.stringify({ ...reversalEvent, data }));
    expect((await drainPaymentEventOutbox({ db, send: async () => ({ ok: true }) })).delivered).toBe(1);
  });

  test.each([{ verifiedBy: undefined }, { auditId: 0 }, { paymentId: 8 }, { amount: -1 }, { amount: 0 }, { amount: 1.001 }, { currency: '' }])(
    'old verified transport also fails closed for malformed payload %p', async overrides => {
      const { db } = fixture(JSON.stringify({ ...event, data: { ...event.data, ...overrides } }));
      const send = jest.fn();
      expect((await drainPaymentEventOutbox({ db, send })).deferred).toBe(1);
      expect(send).not.toHaveBeenCalled();
    });

  test.each([
    ['payment.reversed', 'Payment reversed', 'warning'], ['payment.verified', 'Payment verified', 'success'],
  ])('realtime %s retains own type/title/severity, not a fake verification', async (type, title, severity) => {
    const payload = type === 'payment.reversed' ? reversalEvent : event;
    const { db } = fixture(JSON.stringify(payload), {}, { channel: 'realtime', destinationKey: 'finance-notifications' });
    jest.mocked(publishDurableRealtimeNotification).mockClear();
    expect((await drainPaymentEventOutbox({ db })).delivered).toBe(1);
    expect(publishDurableRealtimeNotification).toHaveBeenCalledWith(expect.objectContaining({ id: payload.id, type, title, severity, resourceId: 7 }));
  });
});
