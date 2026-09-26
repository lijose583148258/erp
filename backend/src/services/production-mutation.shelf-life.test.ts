import { calculateBatchExpiryDate } from './production-mutation.service';

describe('production batch shelf-life policy', () => {
  it('calculates expiry from the governed BOM shelf-life value', () => {
    const productionDate = new Date('2026-01-31T12:00:00.000Z');
    expect(calculateBatchExpiryDate(productionDate, 180).toISOString())
      .toBe('2026-07-30T12:00:00.000Z');
  });

  it.each([undefined, null, 0, -1, 3651, 1.5, 'unknown'])(
    'rejects missing or invalid shelf-life value %p',
    (value) => {
      expect(() => calculateBatchExpiryDate(new Date('2026-01-01T00:00:00.000Z'), value))
        .toThrow('BOM 缺少有效的保质期天数');
    },
  );
});
