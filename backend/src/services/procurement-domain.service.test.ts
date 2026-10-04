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
    const second = resolveReceiptCostAmount(order, 1, 1);
    const final = resolveReceiptCostAmount(order, 1, 2);

    expect([first, second, final]).toEqual([33.33, 33.33, 33.34]);
    expect(first + second + final).toBe(100);
  });
});
