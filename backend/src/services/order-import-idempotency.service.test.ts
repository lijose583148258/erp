import {
  buildOrderImportFingerprint,
  normalizeOrderImportIdempotencyKey,
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
});
