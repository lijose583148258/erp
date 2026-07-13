import {
  buildWebhookSignature,
  parseWebhookEndpoints,
  publishWebhookEvent,
} from './webhook.service';

describe('webhook.service', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.useFakeTimers();
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('parses JSON and delimited endpoint configuration safely', () => {
    expect(parseWebhookEndpoints('https://example.test/a, http://example.test/b')).toHaveLength(2);
    expect(parseWebhookEndpoints('ftp://example.test/a')).toHaveLength(0);
    expect(parseWebhookEndpoints(JSON.stringify([
      { url: 'https://example.test/a', events: ['order.created'] },
      { url: 'not-a-url' },
    ]))).toEqual([{ url: 'https://example.test/a', events: ['order.created'] }]);
  });

  it('builds stable HMAC signatures over timestamp and body', () => {
    expect(buildWebhookSignature('secret', '2026-07-09T00:00:00.000Z', '{"ok":true}'))
      .toBe(buildWebhookSignature('secret', '2026-07-09T00:00:00.000Z', '{"ok":true}'));
    expect(buildWebhookSignature('secret', '2026-07-09T00:00:00.000Z', '{"ok":true}'))
      .not.toBe(buildWebhookSignature('other', '2026-07-09T00:00:00.000Z', '{"ok":true}'));
  });

  it('publishes matching events without blocking the caller', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 202 });
    global.fetch = fetchMock as unknown as typeof fetch;
    process.env.AILAODA_WEBHOOK_SECRET = 'shared-secret';
    process.env.AILAODA_WEBHOOK_ENDPOINTS = JSON.stringify([
      { url: 'https://example.test/orders', events: ['order.created'] },
      { url: 'https://example.test/payments', events: ['payment.verified'] },
    ]);

    const queued = publishWebhookEvent({
      type: 'order.created',
      resourceType: 'order',
      resourceId: 123,
      data: { orderNo: 'ORD-1' },
    });

    expect(queued).toBe(1);
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['x-ailaoda-event']).toBe('order.created');
    expect(init.headers['x-ailaoda-signature']).toMatch(/^sha256=/);
  });
});
