import { buildOrderItemsAndTotals } from './order-item-normalization';

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
});
