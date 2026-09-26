import { calculateVerifiedPaymentState } from './collection-state.service';

describe('collection state money precision', () => {
  it('treats 0.1 plus 0.2 as an exactly paid 0.3 order', () => {
    expect(calculateVerifiedPaymentState({
      verifiedPayments: [{ amount: '0.1' }, { amount: '0.2' }],
      finalAmount: '0.3',
    })).toEqual({
      paidAmount: 0.3,
      effectiveReceivableAmount: 0.3,
      exceedsOutstanding: false,
      paymentStatus: 'paid',
    });
  });

  it('accepts exact split verification and rejects an aggregate overpayment', () => {
    expect(calculateVerifiedPaymentState({
      verifiedPayments: [{ amount: '400' }, { amount: '600' }],
      finalAmount: '1000',
    }).exceedsOutstanding).toBe(false);

    expect(calculateVerifiedPaymentState({
      verifiedPayments: [{ amount: '700' }, { amount: '700' }],
      finalAmount: '1000',
    })).toMatchObject({
      paidAmount: 1400,
      effectiveReceivableAmount: 1000,
      exceedsOutstanding: true,
      paymentStatus: 'paid',
    });
  });

  it('applies receivable adjustments before deciding payment status', () => {
    expect(calculateVerifiedPaymentState({
      verifiedPayments: [{ amount: '899.99' }],
      finalAmount: '1000',
      receivableAdjustmentAmount: '100',
    })).toMatchObject({
      paidAmount: 899.99,
      effectiveReceivableAmount: 900,
      exceedsOutstanding: false,
      paymentStatus: 'partial',
    });

    expect(calculateVerifiedPaymentState({
      verifiedPayments: [{ amount: '900' }],
      finalAmount: '1000',
      receivableAdjustmentAmount: '100',
    })).toMatchObject({
      exceedsOutstanding: false,
      paymentStatus: 'paid',
    });
  });
});
