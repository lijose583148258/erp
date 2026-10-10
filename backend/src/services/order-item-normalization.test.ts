import {
  buildOrderItemsAndTotals,
  calculateOrderFinalAmount,
  calculateOrderOutstanding,
} from './order-item-normalization';

describe('order item normalization', () => {
  it('persists packagingSpec into the canonical specification column', () => {
    const result = buildOrderItemsAndTotals([{
      productName: 'Resin A',
      packagingSpec: '25kg/drum',
      quantity: 5,
      unit: 'kg',
      unitPrice: 99,
    }]);

    expect(result.totalAmount).toBe(495);
    expect(result.orderItems).toEqual([
      expect.objectContaining({
        productName: 'Resin A',
        specification: '25kg/drum',
        quantity: 5,
        unitPrice: 99,
        totalPrice: 495,
      }),
    ]);
  });

  it('keeps an explicit specification ahead of the frontend alias', () => {
    const result = buildOrderItemsAndTotals([{
      productName: 'Resin B',
      specification: 'canonical-spec',
      packagingSpec: 'frontend-alias',
      quantity: 1,
      unitPrice: 2,
    }]);

    expect(result.orderItems[0].specification).toBe('canonical-spec');
  });

  it('rounds each monetary line with decimal half-up rules before summing the order', () => {
    const result = buildOrderItemsAndTotals([
      { productName: 'Resin A', quantity: 1, unitPrice: 1.005 },
      { productName: 'Resin B', quantity: 3, unitPrice: 0.1 },
      { productName: 'Resin C', quantity: 1, unitPrice: 0.2 },
    ]);

    expect(result.orderItems.map(item => item.totalPrice)).toEqual([1.01, 0.3, 0.2]);
    expect(result.totalAmount).toBe(1.51);
  });

  it('calculates discount and paid balances without binary-float drift', () => {
    expect(calculateOrderFinalAmount(0.3, 0.1)).toBe(0.2);
    expect(calculateOrderOutstanding(0.3, 0.1)).toBe(0.2);
    expect(calculateOrderOutstanding(0.3, 0.30000000000000004)).toBe(0);
  });
});
