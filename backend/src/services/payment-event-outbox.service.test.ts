jest.mock('../config/database', () => ({ __esModule: true, default: {} }));
jest.mock('./realtime-notification.service', () => ({ publishDurableRealtimeNotification: jest.fn().mockResolvedValue(undefined) }));
import { drainPaymentEventOutbox, paymentEventRetryDelay } from './payment-event-outbox.service';
import { paymentWebhookDestinations, recordPaymentVerifiedEventTx } from './payment-verification-event.service';

const instant = new Date('2026-10-02T00:00:00.000Z');
const event = { id: 'stable-event-id', type: 'payment.verified', resourceType: 'payment', resourceId: 7, occurredAt: instant.toISOString(), data: { orderId: 9 } };
function fixture(payloadJson = JSON.stringify(event)) {
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const db = { businessEventDelivery: {
    findMany: jest.fn().mockResolvedValue([{ id: 1, channel: 'webhook', destinationKey: 'target', attempts: 0, event: { payloadJson } }]),
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
