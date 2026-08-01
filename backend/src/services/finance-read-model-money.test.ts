import { calculateMilestoneAmounts } from './collection-query.service';
import { resolveBaseAmount, resolvePortionBaseAmount } from './finance-summary.service';

describe('finance read-model money precision', () => {
  it('resolves direct and exchange-derived base amounts at currency precision', () => {
    expect(resolveBaseAmount({ amount: '0.1', exchangeRate: '3' })).toBe(0.3);
    expect(resolveBaseAmount({ amount: '1.005', exchangeRate: '1' })).toBe(1.01);
    expect(resolveBaseAmount({ amount: '9', baseAmount: '1.005', exchangeRate: '7' })).toBe(1.01);
    expect(resolveBaseAmount({ amount: '0.1', baseAmount: 0, exchangeRate: '3' })).toBe(0.3);
  });

  it('prorates an order base amount without binary division drift', () => {
    expect(resolvePortionBaseAmount({
      portionAmount: 1,
      totalAmount: 3,
      totalBaseAmount: '100.01',
    })).toBe(33.34);
    expect(resolvePortionBaseAmount({
      portionAmount: '0.1',
      totalAmount: '1',
      exchangeRate: '3',
    })).toBe(0.3);
  });

  it('calculates milestone target, verified sum, and remaining amount through one decimal boundary', () => {
    expect(calculateMilestoneAmounts({
      explicitAmount: null,
      contractTotalAmount: '100.01',
      percentage: '33.3333',
      verifiedPayments: [{ amount: '0.1' }, { amount: '0.2' }],
    })).toEqual({
      targetAmount: 33.34,
      paidAmount: 0.3,
      remainingAmount: 33.04,
    });

    expect(calculateMilestoneAmounts({
      explicitAmount: '1.005',
      contractTotalAmount: 0,
      percentage: 0,
      verifiedPayments: [{ amount: '2' }],
    })).toEqual({
      targetAmount: 1.01,
      paidAmount: 2,
      remainingAmount: 0,
    });
  });
});
