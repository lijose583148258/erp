import { compareAndSetOrderStatus } from './order-status-transition.service';

describe('compareAndSetOrderStatus', () => {
  it('updates only the expected current status', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const db = { order: { updateMany } } as never;

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
