import { compareAndSetOrderStatus } from './order-status-transition.service';

describe('compareAndSetOrderStatus', () => {
  it.each(['confirmed', 'shipped'])('completes resolved %s obligations without inventing a delivery', async expectedStatus => {
    const accepted = expectedStatus === 'confirmed' ? 0 : 40;
    const snapshot = { items: [{ id: 1, quantity: 100, unit: 'kg' }], shipments: accepted ? [
      { orderItemId: 1, quantity: accepted, unit: 'kg', status: 'delivered', receipts: [{ acceptedQuantity: accepted, rejectedQuantity: 0, unit: 'kg' }] },
    ] : [], receivableAdjustments: [{ id: 2, adjustmentType: 'order_quantity_cancellation', status: 'posted', orderItemId: 1, cancelledQuantity: 100 - accepted }] };
    const db = { order: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findUnique: jest.fn().mockResolvedValue(snapshot) } };
    await expect(compareAndSetOrderStatus(db as never, { orderId: 42, expectedStatus, targetStatus: 'completed' })).resolves.toBe(true);
    await expect(compareAndSetOrderStatus(db as never, { orderId: 42, expectedStatus, targetStatus: 'delivered' })).rejects.toThrow('ORDER_FULFILLMENT_INCOMPLETE');
    expect(db.order.updateMany.mock.calls[0][0].where.AND).toContainEqual({ paymentStatus: 'paid' });
  });

  it.each(['delivered', 'completed'])('rejects early %s after claiming the row so the caller rolls back atomically', async targetStatus => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findUnique = jest.fn().mockResolvedValue({ items: [{ id: 1, quantity: 100, unit: 'kg' }],
      shipments: [{ orderItemId: 1, quantity: 40, unit: 'kg', status: 'delivered',
        receipts: [{ acceptedQuantity: 40, rejectedQuantity: 0, unit: 'kg' }] }] });
    const db = { order: { updateMany, findUnique } } as never;
    await expect(compareAndSetOrderStatus(db, { orderId: 42, expectedStatus: 'shipped', targetStatus }))
      .rejects.toMatchObject({ message: 'ORDER_FULFILLMENT_INCOMPLETE', details: { lines: [{ outstandingQuantity: 60 }] } });
    expect(updateMany.mock.invocationCallOrder[0]).toBeLessThan(findUnique.mock.invocationCallOrder[0]);
    if (targetStatus === 'completed') expect(updateMany.mock.calls[0][0].where.AND).toContainEqual({ paymentStatus: 'paid' });
  });
  it('updates only the expected current status', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const db = {
      order: { updateMany },
      orderItem: {
        findMany: jest.fn().mockResolvedValue([{
          id: 5,
          materialId: 7,
          productName: '丙烯酸',
          unit: 'kg',
        }]),
      },
      material: {
        findMany: jest.fn().mockResolvedValue([{
          id: 7,
          code: 'RM-0007',
          nameZh: '丙烯酸',
          baseUnit: 'kg',
          status: 'active',
          isTemporary: false,
        }]),
      },
    } as never;

    await expect(compareAndSetOrderStatus(db, {
      orderId: 42,
      expectedStatus: 'pending',
      targetStatus: 'confirmed',
    })).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      where: { AND: [{ id: 42, status: 'pending' }, {}] },
      data: { status: 'confirmed' },
    });
  });

  it('rolls the confirmation transaction back when any line is still free text', async () => {
    const db = {
      order: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      orderItem: {
        findMany: jest.fn().mockResolvedValue([{
          id: 5,
          materialId: null,
          productName: '未治理乳液',
          unit: 'kg',
        }]),
      },
      material: { findMany: jest.fn().mockResolvedValue([]) },
    } as never;

    await expect(compareAndSetOrderStatus(db, {
      orderId: 42,
      expectedStatus: 'pending',
      targetStatus: 'confirmed',
    })).rejects.toMatchObject({
      message: 'MATERIAL_RELEASE_REQUIRED',
      details: {
        entityType: 'sales_order',
        issues: [{ lineKey: '5', rowNumber: 1, reason: 'missing_material_id' }],
      },
    });
  });

  it('reports a conflict when another request already changed the row', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const db = { order: { updateMany } } as never;

    await expect(compareAndSetOrderStatus(db, {
      orderId: 42,
      expectedStatus: 'shipped',
      targetStatus: 'completed',
      requiredWhere: { paymentStatus: 'paid' },
    })).resolves.toBe(false);
  });
});
