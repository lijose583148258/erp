import { getOrderFulfillment, FulfillmentShipment } from './orderFulfillment';
import { getCommercialFulfillmentStatus } from './orderCommercialState';

const items = [{ id: 1, productName: 'Resin', quantity: 100, unit: 'kg' }];
const delivered = (quantity: number, extra: Partial<FulfillmentShipment> = {}): FulfillmentShipment => ({
  orderItemId: 1, quantity, unit: 'kg', status: 'delivered',
  receipts: [{ acceptedQuantity: quantity, rejectedQuantity: 0, unit: 'kg' }], ...extra,
});
describe('quantity-based order fulfillment', () => {
  it.each([0.000001, 0.0000001])('never certifies an unshipped micro demand %s', quantity => {
    expect(getOrderFulfillment({ items: [{ id: 1, quantity, unit: 'kg' }], shipments: [] }))
      .toMatchObject({ fullyDelivered: false, hasUnallocated: true, lines: [{ outstandingQuantity: quantity }] });
    expect(getOrderFulfillment({ items: [...items, { id: 2, quantity, unit: 'kg' }], shipments: [delivered(100)] }).fullyDelivered).toBe(false);
    expect(getOrderFulfillment({ items: [{ id: 1, quantity, unit: 'kg' }], shipments: [delivered(quantity)] }).fullyDelivered).toBe(true);
  });
  it('tolerates floating point sum noise without treating a real shortage as delivered', () => {
    const snapshot = { items: [{ id: 1, quantity: 0.3, unit: 'kg' }], shipments: [delivered(0.1), delivered(0.2)] };
    expect(getOrderFulfillment(snapshot)).toMatchObject({ fullyDelivered: true, needsReview: false });
  });
  it('keeps 60 kg owed after the only shipment delivers 40/100, even with stale delivered status', () => {
    const order = { items, shipments: [delivered(40)], status: 'delivered' };
    expect(getOrderFulfillment(order)).toMatchObject({ fullyDelivered: false, needsReview: false, hasUnallocated: true,
      lines: [{ orderedQuantity: 100, allocatedQuantity: 40, acceptedQuantity: 40, outstandingQuantity: 60, unallocatedQuantity: 60 }] });
    expect(getCommercialFulfillmentStatus(order)).toBe('partially_delivered');
  });
  it('allows presale demand without requiring present stock and completes only after both deliveries', () => {
    expect(getOrderFulfillment({ items, shipments: [] })).toMatchObject({ fullyDelivered: false, hasUnallocated: true, needsReview: false });
    const order = { items, shipments: [delivered(40), delivered(60)] };
    expect(getOrderFulfillment(order)).toMatchObject({ fullyDelivered: true, hasUnallocated: false });
    expect(getCommercialFulfillmentStatus(order)).toBe('delivered');
  });
  it('does not treat allocation or dispatched quantity as customer acceptance', () => {
    for (const status of ['pending', 'in_transit']) {
      const result = getOrderFulfillment({ items, shipments: [delivered(100, { status, receipts: [] })] });
      expect(result).toMatchObject({ fullyDelivered: false, hasUnallocated: false, lines: [{ outstandingQuantity: 100 }] });
    }
  });
  it('does not close an in-transit shipment solely from receipt quantity', () => {
    expect(getOrderFulfillment({ items, shipments: [delivered(100, { status: 'in_transit' })] }).fullyDelivered).toBe(false);
  });
  it('keeps distinct lines and units separate, including gift demand', () => {
    const order = { items: [...items, { id: 2, productName: 'Gift', quantity: 2, unit: 'drum' }], shipments: [delivered(100)] };
    expect(getOrderFulfillment(order)).toMatchObject({ fullyDelivered: false, lines: [{ outstandingQuantity: 0, unit: 'kg' }, { outstandingQuantity: 2, unit: 'drum' }] });
  });
  it.each([
    { orderItemId: null }, { orderItemId: 999 }, { unit: 'drum' }, { quantity: Number.NaN }, { receipts: [] },
    { receipts: [{ acceptedQuantity: 100, rejectedQuantity: 0, unit: 'drum' }] },
    { receipts: [{ acceptedQuantity: -1, rejectedQuantity: 0, unit: 'kg' }] },
  ])('requires review for missing/invalid lineage or receipt evidence: %j', extra => {
    expect(getOrderFulfillment({ items, shipments: [delivered(100, extra)] })).toMatchObject({ fullyDelivered: false, needsReview: true });
  });
  it('rejects overdelivery and never counts rejected amounts toward closure', () => {
    expect(getOrderFulfillment({ items, shipments: [delivered(101)] })).toMatchObject({ fullyDelivered: false, needsReview: true });
    expect(getOrderFulfillment({ items, shipments: [delivered(100, { status: 'exception', receipts: [{ acceptedQuantity: 40, rejectedQuantity: 60, unit: 'kg' }] })] }))
      .toMatchObject({ fullyDelivered: false, needsReview: true, lines: [{ acceptedQuantity: 40, outstandingQuantity: 60 }] });
  });
  it.each(['cancelled', 'reversed', 'void'])('ignores %s shipments and preserves their obligation', status => {
    expect(getOrderFulfillment({ items, shipments: [delivered(100, { status })] })).toMatchObject({ fullyDelivered: false, lines: [{ outstandingQuantity: 100, unallocatedQuantity: 100 }] });
  });
  it('fails closed for empty legacy orders and does not let cached status certify delivery', () => {
    expect(getOrderFulfillment({})).toMatchObject({ fullyDelivered: false, needsReview: true });
    expect(getCommercialFulfillmentStatus({ status: 'delivered', shipments: [{ status: 'delivered' }] })).not.toBe('delivered');
  });
});
