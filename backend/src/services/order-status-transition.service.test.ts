import { compareAndSetOrderStatus } from './order-status-transition.service';

describe('compareAndSetOrderStatus', () => {
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
