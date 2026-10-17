import {
  calculatePurchaseValuation,
  resolveReceiptCostAmount,
} from './procurement-domain.service';

describe('procurement landed-cost precision', () => {
  it('calculates line value without binary multiplication drift', () => {
    expect(calculatePurchaseValuation({
      quantity: '3',
      price: '0.1',
      currency: 'CNY',
    })).toMatchObject({
      taxAmount: 0,
      landedCostAmount: 0.3,
      landedUnitCost: 0.1,
    });
  });

  it('converts foreign currency before applying tax and base-currency extra costs', () => {
    expect(calculatePurchaseValuation({
      quantity: 1,
      price: 100,
      currency: 'USD',
      exchangeRate: 7,
      taxRate: 10,
      freightCost: '0.1',
      dutyCost: '0.2',
      insuranceCost: '0.3',
      otherCost: '0.4',
    })).toEqual({
      currency: 'USD',
      exchangeRate: 7,
      taxRate: 10,
      taxAmount: 1.43,
      freightCost: 0.1,
      dutyCost: 0.2,
      insuranceCost: 0.3,
      otherCost: 0.4,
      landedCostAmount: 16.72,
      landedUnitCost: 16.72,
    });
  });

  it('assigns the rounding residual to the final receipt so split receipts conserve total cost', () => {
    const order = {
      quantity: 3,
      landedCostAmount: 100,
      landedUnitCost: 33.33,
      price: 0,
    };
    const first = resolveReceiptCostAmount(order, 1, 0);
    const second = resolveReceiptCostAmount(order, 1, 1, first);
    const final = resolveReceiptCostAmount(order, 1, 2, Math.round((first + second) * 100) / 100);

    expect([first, second, final]).toEqual([33.33, 33.34, 33.33]);
    expect(first + second + final).toBe(100);
  });

  it('conserves one currency unit across six fractional physical receipts', () => {
    const order = { quantity: 3, price: 1 / 3, landedCostAmount: 1, landedUnitCost: 0.33 };
    let postedCents = 0;
    const costs = Array.from({ length: 6 }, (_, index) => {
      const cost = resolveReceiptCostAmount(order, 0.5, index * 0.5, postedCents / 100);
      postedCents += Math.round(cost * 100); return cost;
    });
    expect(costs).toEqual([0.17, 0.16, 0.17, 0.17, 0.16, 0.17]);
    expect(costs.reduce((sum, value) => sum + Math.round(value * 100), 0)).toBe(100);
  });

  it('preserves actual legacy cents instead of substituting the ideal preceding fraction', () => {
    expect(resolveReceiptCostAmount({ quantity: 3, landedCostAmount: 100, landedUnitCost: 33.33 }, 1, 2, 66.66)).toBe(33.34);
  });

  it('does not consume the rejected physical quantity as a full-cost final receipt', () => {
    expect(resolveReceiptCostAmount({ quantity: 10, landedCostAmount: 100 }, 2, 3, 30)).toBe(20);
  });

  it('preserves a valid explicit zero cost, but refuses a repair-default zero for priced goods', () => {
    expect(resolveReceiptCostAmount({ quantity: 3, price: 0, landedCostAmount: 0 }, 1)).toBe(0);
    expect(() => resolveReceiptCostAmount({ quantity: 3, price: 1, landedCostAmount: 0 }, 1)).toThrow('COST_BASIS_REQUIRED');
    expect(() => resolveReceiptCostAmount({ quantity: 3, landedCostAmount: 0 }, 1)).toThrow('COST_BASIS_REQUIRED');
  });

  it.each([undefined, null, NaN, Infinity, -1, 0.001, Number.MAX_SAFE_INTEGER])('rejects missing or invalid cost basis %s', amount => {
    expect(() => resolveReceiptCostAmount({ quantity: 3, landedCostAmount: amount }, 1)).toThrow('COST_BASIS_REQUIRED');
  });

  it.each([undefined, NaN, Infinity, -1, 0.001, Number.MAX_SAFE_INTEGER])('requires actual safe cent history after earlier receipt: %s', actual => {
    expect(() => resolveReceiptCostAmount({ quantity: 3, landedCostAmount: 100 }, 1, 1, actual)).toThrow('COST_RECONCILIATION_REQUIRED');
  });

  it('rejects negative corrective inbound and a cost history with no physical predecessor', () => {
    const order = { quantity: 3, landedCostAmount: 1 };
    expect(() => resolveReceiptCostAmount(order, 0.1, 1, 0.5)).toThrow('COST_RECONCILIATION_REQUIRED');
    expect(() => resolveReceiptCostAmount(order, 1, 0, 0.01)).toThrow('COST_RECONCILIATION_REQUIRED');
    expect(() => resolveReceiptCostAmount(order, 1, 3, 1)).toThrow('EXCEEDS_REMAINING');
  });

  it.each([[0, 0], [-1, 0], [NaN, 0], [Infinity, 0], [1, -1], [1, NaN]])('rejects invalid quantity or preceding amount (%s, %s)', (delta, before) => {
    expect(() => resolveReceiptCostAmount({ quantity: 3, landedCostAmount: 1 }, delta, before, 0)).toThrow('COST_RECONCILIATION_REQUIRED');
  });
});
