import { claimPendingOrderForUpdate } from './order-update.service';

describe('claimPendingOrderForUpdate', () => {
  it('claims only a pending row before the edit reads financial state', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findUnique = jest.fn();
    const db = { order: { updateMany, findUnique } } as never;

    await expect(claimPendingOrderForUpdate(db, 42)).resolves.toBe('claimed');
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 42, status: 'pending' },
      data: { updatedAt: expect.any(Date) },
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('distinguishes a status race from a missing order', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const findUnique = jest.fn()
      .mockResolvedValueOnce({ id: 42 })
      .mockResolvedValueOnce(null);
    const db = { order: { updateMany, findUnique } } as never;

    await expect(claimPendingOrderForUpdate(db, 42)).resolves.toBe('not_pending');
    await expect(claimPendingOrderForUpdate(db, 99)).resolves.toBe('missing');
  });
});
