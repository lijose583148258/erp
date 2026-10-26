import { getOrderFulfillment } from './orderFulfillment';

const fixture = () => ({
  items: [{ id: 1, quantity: 100, unit: 'kg' }],
  shipments: [{ orderItemId: 1, quantity: 40, unit: 'kg', status: 'delivered',
    receipts: [{ acceptedQuantity: 40, rejectedQuantity: 0, unit: 'kg' }] }],
  receivableAdjustments: [{ id: 9, adjustmentType: 'order_quantity_cancellation', status: 'posted', orderItemId: 1, cancelledQuantity: 60 }],
});

describe('explicit customer quantity cancellation, not financial-only credits', () => {
  it('resolves 40 delivered + 60 cancelled without pretending that 100 was delivered', () => {
    const order = fixture(); const original = JSON.stringify(order);
    expect(getOrderFulfillment(order)).toMatchObject({ fullyDelivered: false, fullyResolved: true, needsReview: false,
      hasUnallocated: false, lines: [{ orderedQuantity: 100, acceptedQuantity: 40, cancelledQuantity: 60, outstandingQuantity: 0, unallocatedQuantity: 0 }] });
    expect(JSON.stringify(order)).toBe(original);
  });
  it.each(['pending', 'reversed', 'rejected'])('does not apply a %s cancellation', status => {
    const order = fixture(); order.receivableAdjustments[0].status = status;
    expect(getOrderFulfillment(order)).toMatchObject({ fullyResolved: false, lines: [{ cancelledQuantity: 0, outstandingQuantity: 60 }] });
  });
  it('does not interpret an ordinary credit memo as a quantity cancellation', () => {
    const order = fixture(); order.receivableAdjustments[0].adjustmentType = 'credit_memo';
    expect(getOrderFulfillment(order)).toMatchObject({ fullyResolved: false, lines: [{ cancelledQuantity: 0, outstandingQuantity: 60 }] });
  });
  it('resolves a completely cancelled undelivered line without claiming delivery', () => {
    const order = fixture(); order.shipments = []; order.receivableAdjustments[0].cancelledQuantity = 100;
    expect(getOrderFulfillment(order)).toMatchObject({ fullyResolved: true, fullyDelivered: false, hasAccepted: false, hasUnallocated: false });
  });
  it.each([0, -1, NaN, Infinity, 61])('fails closed on invalid/excess cancellation %s', quantity => {
    const order = fixture(); order.receivableAdjustments[0].cancelledQuantity = quantity;
    expect(getOrderFulfillment(order)).toMatchObject({ needsReview: true, fullyResolved: false, fullyDelivered: false });
  });
  it('does not cancel a quantity that has already been allocated to another shipment', () => {
    const order = fixture(); order.shipments.push({ orderItemId: 1, quantity: 10, unit: 'kg', status: 'pending', receipts: [] });
    expect(getOrderFulfillment(order)).toMatchObject({ needsReview: true, fullyResolved: false });
  });
  it('rejects a cancellation bound to a different/missing line', () => {
    const order = fixture(); order.receivableAdjustments[0].orderItemId = 99;
    expect(getOrderFulfillment(order)).toMatchObject({ needsReview: true, fullyResolved: false });
  });
  it('rejects duplicate credit-row observations rather than counting twice', () => {
    const order = fixture(); order.receivableAdjustments[0].cancelledQuantity = 30;
    order.receivableAdjustments.push({ ...order.receivableAdjustments[0] });
    expect(getOrderFulfillment(order)).toMatchObject({ needsReview: true, fullyResolved: false });
  });
  it('keeps legitimate micro-quantity cancellations visible', () => {
    const order = fixture(); order.items[0].quantity = 1e-12; order.shipments = []; order.receivableAdjustments[0].cancelledQuantity = 1e-12;
    expect(getOrderFulfillment(order)).toMatchObject({ fullyResolved: true, fullyDelivered: false, lines: [{ cancelledQuantity: 1e-12 }] });
  });
});
