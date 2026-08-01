import { computeItemValue, previewBarterSettlement } from './barter.calculations';

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
});
