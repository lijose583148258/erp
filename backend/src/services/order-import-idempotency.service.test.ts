import {
  buildOrderImportFingerprint,
  normalizeOrderImportIdempotencyKey,
  OrderImportIdempotencyService,
} from './order-import-idempotency.service';

describe('order import idempotency primitives', () => {
  it('builds the same fingerprint for semantically identical object key ordering', () => {
    const left = [{ customerId: 7, items: [{ productName: 'A', quantity: 2, unitPrice: 5 }] }];
    const right = [{ items: [{ unitPrice: 5, quantity: 2, productName: 'A' }], customerId: 7 }];

    expect(buildOrderImportFingerprint(left)).toBe(buildOrderImportFingerprint(right));
    expect(buildOrderImportFingerprint(left)).not.toBe(buildOrderImportFingerprint([
      { customerId: 7, items: [{ productName: 'A', quantity: 2, unitPrice: 6 }] },
    ]));
  });

  it('accepts only bounded caller-generated idempotency keys', () => {
    expect(normalizeOrderImportIdempotencyKey(' import:batch-001 ')).toBe('import:batch-001');
    expect(normalizeOrderImportIdempotencyKey('short')).toBeNull();
    expect(normalizeOrderImportIdempotencyKey('bad key with spaces')).toBeNull();
    expect(normalizeOrderImportIdempotencyKey(`x${'a'.repeat(80)}`)).toBeNull();
  });

  it('fails closed when a matching key is outside its replay window', async () => {
    const client = {
      orderImportBatch: {
        create: jest.fn(async () => { throw { code: 'P2002' }; }),
        findUnique: jest.fn(async () => ({
          id: 9,
          fingerprint: 'same',
          status: 'expired',
          resultJson: null,
          leaseExpiresAt: new Date(0),
        })),
        updateMany: jest.fn(),
      },
    };
    const service = new OrderImportIdempotencyService(client as never);

    await expect(service.claim(1, 'import:key-001', 'same')).resolves.toEqual({
      kind: 'conflict',
      message: 'The replay window for this Idempotency-Key has expired; use a new key.',
    });
    expect(client.orderImportBatch.updateMany).not.toHaveBeenCalled();
  });

  it('records an explicit completion timestamp with the replay result', async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const service = new OrderImportIdempotencyService({
      orderImportBatch: { updateMany },
    } as never);

    await service.complete(4, 'lease-4', { success: 1, failed: 0, errors: [] });

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 4, leaseToken: 'lease-4', status: 'processing' },
      data: expect.objectContaining({
        status: 'completed',
        completedAt: expect.any(Date),
        resultJson: JSON.stringify({ success: 1, failed: 0, errors: [] }),
      }),
    }));
  });
});
