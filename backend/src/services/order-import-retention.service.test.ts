import {
  OrderImportRetentionService,
  resolveOrderImportRetentionPolicy,
  type OrderImportRetentionPolicy,
} from './order-import-retention.service';

const policy = (mode: OrderImportRetentionPolicy['mode']): OrderImportRetentionPolicy => ({
  mode,
  replayDays: 30,
  staleProcessingDays: 7,
  purgeDays: 365,
  batchSize: 2,
});

function harness() {
  const orderImportBatch = {
    count: jest.fn()
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(4),
    findMany: jest.fn()
      .mockResolvedValueOnce([{ id: 10 }, { id: 11 }])
      .mockResolvedValueOnce([{ id: 20 }])
      .mockResolvedValueOnce([{ id: 30 }, { id: 31 }]),
    updateMany: jest.fn()
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 1 }),
    deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
  };
  return {
    orderImportBatch,
    service: new OrderImportRetentionService({ orderImportBatch } as never),
  };
}

describe('order import retention', () => {
  it('defaults to report-only and rejects unsafe policy values', () => {
    expect(resolveOrderImportRetentionPolicy({})).toEqual({
      mode: 'report-only',
      replayDays: 30,
      staleProcessingDays: 7,
      purgeDays: 365,
      batchSize: 500,
    });
    expect(() => resolveOrderImportRetentionPolicy({
      ORDER_IMPORT_REPLAY_DAYS: '30',
      ORDER_IMPORT_PURGE_DAYS: '30',
    })).toThrow('must be greater');
    expect(() => resolveOrderImportRetentionPolicy({
      ORDER_IMPORT_RETENTION_BATCH_SIZE: '5001',
    })).toThrow('must not exceed 5000');
  });

  it('reports bounded candidates without changing data', async () => {
    const { service, orderImportBatch } = harness();
    const report = await service.run(policy('report-only'), new Date('2026-07-22T00:00:00.000Z'));

    expect(report.candidates).toEqual({ completed: 3, staleProcessing: 1, purgeable: 2, linkedExpired: 4 });
    expect(report.selected).toEqual({ completed: 2, staleProcessing: 1, purgeable: 2 });
    expect(report.mutations).toEqual({ compacted: 0, staleExpired: 0, purged: 0 });
    expect(orderImportBatch.updateMany).not.toHaveBeenCalled();
    expect(orderImportBatch.deleteMany).not.toHaveBeenCalled();
    expect(orderImportBatch.findMany).toHaveBeenCalledTimes(3);
    expect(orderImportBatch.findMany.mock.calls[0][0].take).toBe(2);
  });

  it('compacts results, expires stale work, and purges only unlinked rows', async () => {
    const { service, orderImportBatch } = harness();
    const report = await service.run(policy('enforce'), new Date('2026-07-22T00:00:00.000Z'));

    expect(report.mutations).toEqual({ compacted: 2, staleExpired: 1, purged: 2 });
    expect(orderImportBatch.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ id: { in: [10, 11] }, status: 'completed' }),
      data: { status: 'expired', resultJson: null, leaseToken: '' },
    }));
    expect(orderImportBatch.deleteMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: { in: [30, 31] },
        status: 'expired',
        orders: { none: {} },
      }),
    }));
  });
});
