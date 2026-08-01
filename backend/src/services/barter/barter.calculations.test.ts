import {
  calculateBarterAgreementProgress,
  calculatePostedBarterTotals,
  computeItemValue,
  previewBarterSettlement,
} from './barter.calculations';

describe('barter decimal calculations', () => {
  it('multiplies quantity and valuation factors without binary-float drift', () => {
    expect(computeItemValue({
      side: 'our',
      itemName: 'Acrylic emulsion',
      unit: 'kg',
      quantity: 0.1,
      unitPrice: 0.2,
      qualityFactor: 100,
      lossFactor: 1,
    })).toBe(2);
  });

  it('aggregates both sides and derives the offset from quantized values', () => {
    const preview = previewBarterSettlement({
      settlementMode: 'mixed',
      items: [
        { side: 'our', itemName: 'A', unit: 'kg', quantity: 1, unitPrice: 0, marketValue: 0.1 },
        { side: 'our', itemName: 'B', unit: 'kg', quantity: 1, unitPrice: 0, marketValue: 0.2 },
        { side: 'counterparty', itemName: 'C', unit: 'kg', quantity: 1, unitPrice: 0, marketValue: 0.3 },
      ],
    });

    expect(preview.totalPartyAValue).toBe(0.3);
    expect(preview.totalPartyBValue).toBe(0.3);
    expect(preview.cashDifference).toBe(0);
    expect(preview.suggestedOffsetAmount).toBe(0.3);
  });

  it('excludes draft and reversed settlements from posted financial totals', () => {
    expect(calculatePostedBarterTotals([
      {
        status: 'posted',
        cashDifference: '0.1',
        offsetPostings: [{ offsetAmount: '0.1' }, { offsetAmount: '0.2' }],
      },
      {
        status: 'draft',
        cashDifference: '99',
        offsetPostings: [{ offsetAmount: '99' }],
      },
      {
        status: 'reversed',
        cashDifference: '88',
        offsetPostings: [{ offsetAmount: '88' }],
      },
    ])).toEqual({
      totalOffset: 0.3,
      totalCashDifference: 0.1,
    });
  });

  it('calculates remaining agreement value and caps completion after posted offsets', () => {
    expect(calculateBarterAgreementProgress('1', [
      { status: 'posted', offsetPostings: [{ offsetAmount: '0.1' }, { offsetAmount: '0.2' }] },
    ])).toEqual({
      agreedOffsetAmount: 1,
      executedOffsetAmount: 0.3,
      remainingOffsetAmount: 0.7,
      completionRatio: 0.3,
    });

    expect(calculateBarterAgreementProgress('1', [
      { status: 'posted', offsetPostings: [{ offsetAmount: '1.01' }] },
    ])).toEqual({
      agreedOffsetAmount: 1,
      executedOffsetAmount: 1.01,
      remainingOffsetAmount: 0,
      completionRatio: 1,
    });
  });
});
