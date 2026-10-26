import { quoteOrderQuantityCancellation, type CancellationOrderSnapshot } from './orderCancellation';

const fixture = (): CancellationOrderSnapshot => ({
  items: [{ id: 1, quantity: 100, unit: 'kg', totalPrice: 1000 }],
  shipments: [{ orderItemId: 1, quantity: 40, unit: 'kg', status: 'delivered', receipts: [{ acceptedQuantity: 40, rejectedQuantity: 0, unit: 'kg' }] }],
  receivableAdjustments: [], totalAmount: 1000, discountAmount: 0, finalAmount: 1000, paidAmount: 400, receivableAdjustmentAmount: 0,
});
const posted = (quantity: number, amount: number, id = 9, orderItemId = 1) => ({ id, adjustmentType: 'order_quantity_cancellation', status: 'posted', orderItemId, cancelledQuantity: quantity, amount, baseAmount: amount });

describe('quantity cancellation amount comes from original commercial facts', () => {
  it.each([null, 0, -1, Infinity, NaN])('fails closed on invalid original foreign exchange rate %s', rate => {
    const order = fixture(); Object.assign(order, { currency: 'USD', lockedExchangeRate: rate, baseAmount: 1000 });
    expect(() => quoteOrderQuantityCancellation(order, 1, 60)).toThrow('ORDER_CANCELLATION_PRICING_REVIEW_REQUIRED');
  });
  it('rejects inconsistent original foreign base amounts rather than rewriting them', () => {
    const order = fixture(); Object.assign(order, { currency: 'USD', lockedExchangeRate: 0.5, baseAmount: 1000 });
    expect(() => quoteOrderQuantityCancellation(order, 1, 60)).toThrow('ORDER_CANCELLATION_PRICING_REVIEW_REQUIRED');
  });
  it('credits exactly600 for unallocated60 and preserves the1000 original', () => {
    const order = fixture(), original = JSON.stringify(order);
    expect(quoteOrderQuantityCancellation(order, 1, 60)).toMatchObject({ quantity: 60, amount: 600, originalQuantity: 100, unit: 'kg' });
    expect(JSON.stringify(order)).toBe(original);
  });
  it('does not touch actual cash to conceal a required refund', () => {
    const order = fixture(); order.paidAmount = 1000;
    expect(() => quoteOrderQuantityCancellation(order, 1, 60)).toThrow('ORDER_CANCELLATION_REFUND_REQUIRED');
  });
  it('does not double-credit an existing ordinary credit memo', () => {
    const order = fixture(); order.receivableAdjustmentAmount = 600;
    order.receivableAdjustments = [{ id: 3, adjustmentType: 'credit_memo', status: 'posted', amount: 600 }];
    expect(() => quoteOrderQuantityCancellation(order, 1, 60)).toThrow('ORDER_CANCELLATION_REFUND_REQUIRED');
  });
  it.each([0, -1, 61, NaN, Infinity])('rejects invalid/excess quantity %s', quantity => {
    expect(() => quoteOrderQuantityCancellation(fixture(), 1, quantity)).toThrow('ORDER_CANCELLATION_QUANTITY_EXCEEDED');
  });
  it('does not cancel already pending, dispatched or accepted allocations', () => {
    const order = fixture(); order.shipments!.push({ orderItemId: 1, quantity: 1, unit: 'kg', status: 'pending', receipts: [] });
    expect(() => quoteOrderQuantityCancellation(order, 1, 60)).toThrow('ORDER_CANCELLATION_QUANTITY_EXCEEDED');
  });
  it('uses cumulative rounding for three repeated one-unit cancellations', () => {
    const order = fixture(); order.items = [{ id: 1, quantity: 3, unit: 'kg', totalPrice: 1 }]; order.shipments = [];
    order.totalAmount = 1; order.finalAmount = 1; order.paidAmount = 0;
    const amounts: number[] = [];
    for (let i = 0; i < 3; i++) {
      const quote = quoteOrderQuantityCancellation(order, 1, 1); amounts.push(quote.amount);
      order.receivableAdjustments.push(posted(1, quote.amount, i + 1));
      order.receivableAdjustmentAmount = Math.round((order.receivableAdjustmentAmount + quote.amount) * 100) / 100;
    }
    expect(amounts).toEqual([0.33, 0.34, 0.33]); expect(order.receivableAdjustmentAmount).toBe(1);
  });
  it('distributes total discount once, independent of query order and cancellation order', () => {
    const order = fixture(); order.shipments = []; order.paidAmount = 0;
    order.items = [3, 1, 2].map(id => ({ id, quantity: 1, unit: 'kg', totalPrice: 0.01 }));
    order.totalAmount = 0.03; order.discountAmount = 0.01; order.finalAmount = 0.02;
    const amounts = [3, 1, 2].map((id, index) => {
      const quote = quoteOrderQuantityCancellation(order, id, 1);
      order.receivableAdjustments.push(posted(1, quote.amount, index + 1, id));
      order.receivableAdjustmentAmount = Math.round((order.receivableAdjustmentAmount + quote.amount) * 100) / 100;
      return quote.amount;
    });
    expect(amounts).toEqual([0.01, 0.01, 0]); expect(order.receivableAdjustmentAmount).toBe(0.02);
  });
  it('permits a free-of-charge line cancellation without inventing cash or a minimum charge', () => {
    const order = fixture(); order.items[0].totalPrice = 0; order.totalAmount = 0; order.finalAmount = 0; order.paidAmount = 0;
    expect(quoteOrderQuantityCancellation(order, 1, 60).amount).toBe(0);
  });
  it('rejects corrupted original totals', () => {
    const order = fixture(); order.finalAmount = 999;
    expect(() => quoteOrderQuantityCancellation(order, 1, 60)).toThrow('ORDER_CANCELLATION_PRICING_REVIEW_REQUIRED');
  });
  it('rejects a posted cancellation whose quantity/credit relation was changed', () => {
    const order = fixture(); order.receivableAdjustments = [posted(10, 99)]; order.receivableAdjustmentAmount = 99;
    expect(() => quoteOrderQuantityCancellation(order, 1, 50)).toThrow('ORDER_CANCELLATION_PRICING_REVIEW_REQUIRED');
  });
});
