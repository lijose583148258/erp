import { claimShipmentOrder } from './shipment-order-guard.service';

const input = { orderId: 7, customerId: 9, orderItemId: 11, quantity: 60 };
const partialSnapshot = () => ({
  items: [{ id: 11, quantity: 100, unit: 'kg' }],
  shipments: [{ orderItemId: 11, quantity: 40, unit: 'kg', status: 'delivered',
    receipts: [{ acceptedQuantity: 40, rejectedQuantity: 0, unit: 'kg' }] }],
});
const makeDb = (status = 'delivered', extra = {}) => {
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const findUnique = jest.fn()
    .mockResolvedValueOnce({ status, customerId: 9, shipmentHold: false, ...extra })
    .mockResolvedValue(partialSnapshot());
  return { order: { updateMany, findUnique } };
};

describe('claimShipmentOrder', () => {
  it.each(['confirmed', 'shipped'])('locks and validates a %s order without rewriting its status', async status => {
    const db = makeDb(status);
    await expect(claimShipmentOrder(db as never, input)).resolves.toBeUndefined();
    expect(db.order.updateMany).toHaveBeenCalledWith({ where: { id: 7 }, data: { updatedAt: expect.any(Date) } });
    expect(db.order.findUnique).toHaveBeenCalledTimes(1);
    expect(db.order.findUnique).toHaveBeenCalledWith({ where: { id: 7 }, select: { status: true, customerId: true, shipmentHold: true } });
    expect(db.order.updateMany.mock.invocationCallOrder[0]).toBeLessThan(db.order.findUnique.mock.invocationCallOrder[0]);
  });

  it('does not read an order when its row claim found nothing', async () => {
    const db = makeDb();
    db.order.updateMany.mockResolvedValue({ count: 0 });
    await expect(claimShipmentOrder(db as never, input)).rejects.toThrow('SHIPMENT_ORDER_NOT_FOUND');
    expect(db.order.findUnique).not.toHaveBeenCalled();
  });

  it('fails closed if the claimed order cannot be read', async () => {
    const db = makeDb();
    db.order.findUnique.mockReset().mockResolvedValue(null);
    await expect(claimShipmentOrder(db as never, input)).rejects.toThrow('SHIPMENT_ORDER_NOT_FOUND');
  });

  it.each(['cancelled', 'completed', 'pending', 'draft', 'unknown'])('rejects a %s order before allocation', async status => {
    const db = makeDb(status);
    await expect(claimShipmentOrder(db as never, input)).rejects.toThrow('SHIPMENT_ORDER_STATUS_INVALID');
    expect(db.order.findUnique).toHaveBeenCalledTimes(1);
  });

  it.each(['confirmed', 'shipped', 'delivered'])('rejects a mismatched customer on %s', async status => {
    const db = makeDb(status, { customerId: 10 });
    await expect(claimShipmentOrder(db as never, input)).rejects.toThrow('SHIPMENT_ORDER_CUSTOMER_MISMATCH');
    expect(db.order.findUnique).toHaveBeenCalledTimes(1);
  });

  it.each(['confirmed', 'shipped', 'delivered'])('honors shipment hold on %s', async status => {
    const db = makeDb(status, { shipmentHold: true });
    await expect(claimShipmentOrder(db as never, input)).rejects.toThrow('SHIPMENT_ORDER_ON_HOLD');
    expect(db.order.findUnique).toHaveBeenCalledTimes(1);
  });

  it('allows exactly the evidenced 60 kg remainder of a historical delivered order after the shared row lock', async () => {
    const db = makeDb();
    await expect(claimShipmentOrder(db as never, input)).resolves.toBeUndefined();
    expect(db.order.findUnique).toHaveBeenCalledTimes(2);
    expect(db.order.updateMany.mock.invocationCallOrder[0]).toBeLessThan(db.order.findUnique.mock.invocationCallOrder[1]);
    expect(db.order.updateMany).toHaveBeenCalledTimes(1);
    expect(db.order.updateMany.mock.calls[0][0].data).not.toHaveProperty('status');
  });

  it('allows a smaller replacement allocation without requiring stock or a status rewrite', async () => {
    await expect(claimShipmentOrder(makeDb() as never, { ...input, quantity: 20 })).resolves.toBeUndefined();
  });

  it('tolerates binary floating-point subtraction but not business quantity differences', async () => {
    const db = makeDb();
    const snapshot = partialSnapshot();
    snapshot.items[0].quantity = 0.3;
    snapshot.shipments[0].quantity = 0.1;
    snapshot.shipments[0].receipts[0].acceptedQuantity = 0.1;
    db.order.findUnique.mockResolvedValue(snapshot);
    await expect(claimShipmentOrder(db as never, { ...input, quantity: 0.2 })).resolves.toBeUndefined();
  });

  it.each([undefined, null, 999])('requires an exact historical line binding, not %s', async orderItemId => {
    await expect(claimShipmentOrder(makeDb() as never, { ...input, orderItemId }))
      .rejects.toThrow('SHIPMENT_ORDER_FULFILLMENT_REVIEW_REQUIRED');
  });

  it('rejects legacy delivered records lacking receipt evidence', async () => {
    const db = makeDb();
    const snapshot = partialSnapshot();
    snapshot.shipments[0].receipts = [];
    db.order.findUnique.mockResolvedValue(snapshot);
    await expect(claimShipmentOrder(db as never, input)).rejects.toThrow('SHIPMENT_ORDER_FULFILLMENT_REVIEW_REQUIRED');
  });

  it('rejects unresolved rejection evidence even when a line has an unallocated remainder', async () => {
    const db = makeDb();
    const snapshot = partialSnapshot();
    snapshot.shipments[0].status = 'exception';
    snapshot.shipments[0].receipts[0] = { acceptedQuantity: 30, rejectedQuantity: 10, unit: 'kg' };
    db.order.findUnique.mockResolvedValue(snapshot);
    await expect(claimShipmentOrder(db as never, input)).rejects.toThrow('SHIPMENT_ORDER_FULFILLMENT_REVIEW_REQUIRED');
  });

  it.each([60.0000001, 61, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid or excessive historical remainder %s', async quantity => {
    await expect(claimShipmentOrder(makeDb() as never, { ...input, quantity }))
      .rejects.toThrow('SHIPMENT_ORDER_ITEM_QUANTITY_EXCEEDED');
  });

  it('does not reopen a fully delivered line', async () => {
    const db = makeDb();
    const snapshot = partialSnapshot();
    snapshot.items[0].quantity = 40;
    db.order.findUnique.mockResolvedValue(snapshot);
    await expect(claimShipmentOrder(db as never, { ...input, quantity: 0.0000001 }))
      .rejects.toThrow('SHIPMENT_ORDER_ITEM_QUANTITY_EXCEEDED');
  });

  it('does not use a fixed epsilon to overallocate a micro-quantity line', async () => {
    const db = makeDb();
    const snapshot = partialSnapshot();
    snapshot.items[0].quantity = 0.000001;
    snapshot.shipments[0].quantity = 0.0000004;
    snapshot.shipments[0].receipts[0].acceptedQuantity = 0.0000004;
    db.order.findUnique.mockResolvedValue(snapshot);
    await expect(claimShipmentOrder(db as never, { ...input, quantity: 0.000001 }))
      .rejects.toThrow('SHIPMENT_ORDER_ITEM_QUANTITY_EXCEEDED');
  });

  it('still allows the actual remainder of a micro-quantity line', async () => {
    const db = makeDb();
    const snapshot = partialSnapshot();
    snapshot.items[0].quantity = 0.000001;
    snapshot.shipments[0].quantity = 0.0000004;
    snapshot.shipments[0].receipts[0].acceptedQuantity = 0.0000004;
    db.order.findUnique.mockResolvedValue(snapshot);
    await expect(claimShipmentOrder(db as never, { ...input, quantity: 0.0000006 })).resolves.toBeUndefined();
  });
});
