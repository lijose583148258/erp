import type { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { CollectionStateService } from './collection-state.service';
import { recordPaymentVerifiedEventTx } from './payment-verification-event.service';

jest.mock('../config/database', () => ({ __esModule: true, default: {
  customer: { findMany: jest.fn(), update: jest.fn() },
  order: { findMany: jest.fn() }, collectionPromise: { findMany: jest.fn() },
  collectionDispute: { findMany: jest.fn() }, paymentRecord: { findUnique: jest.fn() },
  $transaction: jest.fn(),
} }));
jest.mock('./payment-verification-event.service', () => ({ recordPaymentVerifiedEventTx: jest.fn() }));

const instant = new Date('2026-10-03T12:00:00.000Z');
const outstandingOrder = (amount: number | string) => ({
  finalAmount: amount, paidAmount: 0, receivableAdjustmentAmount: 0,
  paymentTerms: 0, createdAt: new Date('2026-10-01T12:00:00.000Z'),
});
const asTx = (tx: unknown) => tx as Prisma.TransactionClient;
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
const flushMicrotasks = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };
function fixture(customerId = 20) {
  return {
    $executeRaw: jest.fn().mockResolvedValue(1),
    customer: {
      findUnique: jest.fn().mockResolvedValue({ id: customerId, creditHold: false, creditHoldSource: null,
        shipmentHold: false, shipmentHoldSource: null }),
      update: jest.fn().mockResolvedValue({ id: customerId }),
    },
    order: { findMany: jest.fn().mockResolvedValue([outstandingOrder(300)]) },
    collectionPromise: { findMany: jest.fn().mockResolvedValue([]) },
    collectionDispute: { findMany: jest.fn().mockResolvedValue([]) },
    contractMilestone: {
      findUnique: jest.fn().mockResolvedValue({ id: 5, amount: 300, percentage: null, contract: { totalAmount: 1000 } }),
      update: jest.fn().mockResolvedValue({ id: 5 }),
    },
    paymentRecord: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 100 } }) },
  };
}

beforeEach(() => { jest.clearAllMocks(); jest.useFakeTimers().setSystemTime(instant); });
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

describe('derived aggregate lock contract (mock DB; not a PostgreSQL concurrency acceptance)', () => {
  test('customer balance waits for the row lock before reading contributing orders or writing totals', async () => {
    const tx = fixture(); const gate = deferred();
    tx.$executeRaw.mockImplementationOnce(() => gate.promise);
    const running = CollectionStateService.syncCustomerOverdueAmountTx(asTx(tx), 20);
    await flushMicrotasks();
    const beforeRelease = { raw: tx.$executeRaw.mock.calls.length, reads: tx.order.findMany.mock.calls.length,
      writes: tx.customer.update.mock.calls.length };
    tx.order.findMany.mockResolvedValue([outstandingOrder(300)]);
    gate.release();
    await expect(running).resolves.toBe(300);
    expect(beforeRelease).toEqual({ raw: 1, reads: 0, writes: 0 });
    const [sql, boundId] = tx.$executeRaw.mock.calls[0];
    expect(Array.isArray(sql)).toBe(true);
    expect(sql.join('?')).toBe('UPDATE "customers" SET "id" = "id" WHERE "id" = ?');
    expect(boundId).toBe(20);
    expect(tx.order.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      customerId: 20, status: { not: 'cancelled' }, paymentStatus: { not: 'paid' },
    } }));
    expect(tx.customer.update.mock.calls[0][0]).toEqual({ where: { id: 20 }, data: { overdueAmount: 300 } });
  });

  test('customer lock failure is propagated before ledger reads or any derived writes', async () => {
    const tx = fixture(); tx.$executeRaw.mockRejectedValue(new Error('customer lock unavailable'));
    await expect(CollectionStateService.syncCustomerOverdueAmountTx(asTx(tx), 20)).rejects.toThrow('customer lock unavailable');
    expect(tx.order.findMany).not.toHaveBeenCalled(); expect(tx.customer.findUnique).not.toHaveBeenCalled();
    expect(tx.customer.update).not.toHaveBeenCalled();
  });

  test('locked customer recomputation retains exact cents and excludes non-overdue balances', async () => {
    const tx = fixture(); tx.order.findMany.mockResolvedValue([
      outstandingOrder('0.1'), outstandingOrder('0.2'),
      { ...outstandingOrder(900), paymentTerms: 30 },
      { ...outstandingOrder(900), paidAmount: 900 },
    ]);
    await expect(CollectionStateService.syncCustomerOverdueAmountTx(asTx(tx), 20)).resolves.toBe(0.3);
    expect(tx.customer.update.mock.calls[0][0].data).toEqual({ overdueAmount: 0.3 });
  });

  test('collection refresh locks before all parallel customer/order/promise/dispute reads', async () => {
    const tx = fixture(); const gate = deferred(); tx.$executeRaw.mockImplementationOnce(() => gate.promise);
    const running = CollectionStateService.refreshCustomerCollectionStateTx(asTx(tx), 20);
    await flushMicrotasks();
    const readsBeforeRelease = [tx.customer.findUnique, tx.order.findMany,
      tx.collectionPromise.findMany, tx.collectionDispute.findMany].map(fn => fn.mock.calls.length);
    gate.release(); await running;
    expect(readsBeforeRelease).toEqual([0, 0, 0, 0]);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    for (const fn of [tx.customer.findUnique, tx.order.findMany, tx.collectionPromise.findMany, tx.collectionDispute.findMany]) {
      expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(fn.mock.invocationCallOrder[0]);
    }
  });

  test('fresh derived refresh cannot clear manual credit or shipment holds', async () => {
    const tx = fixture(); tx.order.findMany.mockResolvedValue([]);
    tx.customer.findUnique.mockResolvedValue({ id: 20, creditHold: true, creditHoldSource: 'manual',
      shipmentHold: true, shipmentHoldSource: 'manual' });
    await expect(CollectionStateService.refreshCustomerCollectionStateTx(asTx(tx), 20))
      .resolves.toMatchObject({ creditHold: true, shipmentHold: true, collectionsStatus: 'hold' });
    expect(tx.customer.update.mock.calls[0][0].data).not.toHaveProperty('creditHold');
    expect(tx.customer.update.mock.calls[0][0].data).not.toHaveProperty('shipmentHold');
    expect(tx.customer.update.mock.calls[0][0].data).not.toHaveProperty('overdueAmount');
  });

  test('background sweep reads only ordered IDs and rebuilds each customer in a fresh transaction', async () => {
    const first = fixture(20); const second = fixture(30);
    (prisma.customer.findMany as jest.Mock).mockResolvedValue([{ id: 20 }, { id: 30 }]);
    (prisma.$transaction as jest.Mock).mockImplementationOnce(action => action(first)).mockImplementationOnce(action => action(second));
    await expect(CollectionStateService.syncAllCustomerOverdueAmounts()).resolves.toBe(2);
    expect(prisma.customer.findMany).toHaveBeenCalledWith({ select: { id: true }, orderBy: { id: 'asc' } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.order.findMany).not.toHaveBeenCalled();
    expect(prisma.collectionPromise.findMany).not.toHaveBeenCalled();
    expect(prisma.collectionDispute.findMany).not.toHaveBeenCalled();
    expect(prisma.customer.update).not.toHaveBeenCalled();
    expect(first.customer.update.mock.calls[0][0]).toMatchObject({ where: { id: 20 }, data: { overdueAmount: 300 } });
    expect(second.customer.update.mock.calls[0][0]).toMatchObject({ where: { id: 30 }, data: { overdueAmount: 300 } });
    expect(first.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(first.order.findMany.mock.invocationCallOrder[0]);
    expect(second.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(second.order.findMany.mock.invocationCallOrder[0]);
  });

  test('background sweep cannot snapshot the next customer while the first lock is blocked', async () => {
    const first = fixture(20); const second = fixture(30); const gate = deferred();
    first.$executeRaw.mockImplementationOnce(() => gate.promise);
    (prisma.customer.findMany as jest.Mock).mockResolvedValue([{ id: 20 }, { id: 30 }]);
    (prisma.$transaction as jest.Mock).mockImplementationOnce(action => action(first)).mockImplementationOnce(action => action(second));
    const running = CollectionStateService.syncAllCustomerOverdueAmounts(); await flushMicrotasks();
    const secondBeforeRelease = second.order.findMany.mock.calls.length;
    second.order.findMany.mockResolvedValue([outstandingOrder(125)]);
    gate.release(); await expect(running).resolves.toBe(2);
    expect(secondBeforeRelease).toBe(0);
    expect(second.customer.update.mock.calls[0][0].data.overdueAmount).toBe(125);
  });

  test('in-flight sweeps coalesce and a failed sweep releases its guard for a fresh retry', async () => {
    const tx = fixture(); const gate = deferred();
    (prisma.customer.findMany as jest.Mock).mockImplementationOnce(async () => { await gate.promise; return [{ id: 20 }]; });
    (prisma.$transaction as jest.Mock).mockImplementation(action => action(tx));
    const first = CollectionStateService.syncAllCustomerOverdueAmounts();
    const second = CollectionStateService.syncAllCustomerOverdueAmounts();
    gate.release(); await expect(Promise.all([first, second])).resolves.toEqual([1, 1]);
    expect(prisma.customer.findMany).toHaveBeenCalledTimes(1); expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    (prisma.customer.findMany as jest.Mock).mockRejectedValueOnce(new Error('fresh enumeration unavailable'));
    await expect(CollectionStateService.syncAllCustomerOverdueAmounts()).rejects.toThrow('fresh enumeration unavailable');
    (prisma.customer.findMany as jest.Mock).mockResolvedValueOnce([{ id: 20 }]);
    await expect(CollectionStateService.syncAllCustomerOverdueAmounts()).resolves.toBe(1);
    expect(prisma.customer.findMany).toHaveBeenCalledTimes(3);
  });

  test.each([[100, 'pending'], [300, 'paid']])('milestone row lock precedes fresh verified aggregate and writes %s as %s', async (cash, status) => {
    const tx = fixture(); const gate = deferred(); tx.$executeRaw.mockImplementationOnce(() => gate.promise);
    tx.paymentRecord.aggregate.mockResolvedValue({ _sum: { amount: cash } });
    const running = CollectionStateService.recalculateContractMilestonePaymentStateTx(asTx(tx), 5);
    await flushMicrotasks();
    const beforeRelease = [tx.contractMilestone.findUnique, tx.paymentRecord.aggregate, tx.contractMilestone.update]
      .map(fn => fn.mock.calls.length);
    gate.release(); await expect(running).resolves.toEqual({ paidAmount: cash, targetAmount: 300, status });
    expect(beforeRelease).toEqual([0, 0, 0]);
    const [sql, boundId] = tx.$executeRaw.mock.calls[0];
    expect(sql.join('?')).toBe('UPDATE "contract_milestones" SET "id" = "id" WHERE "id" = ?');
    expect(boundId).toBe(5);
    expect(tx.paymentRecord.aggregate).toHaveBeenCalledWith({ where: { milestoneId: 5, status: 'verified' }, _sum: { amount: true } });
    expect(tx.contractMilestone.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { status } });
  });

  test('milestone percentage target and exact cents remain consistent, including a zero cash aggregate', async () => {
    const tx = fixture(); tx.contractMilestone.findUnique.mockResolvedValue({ id: 5, amount: null,
      percentage: 10, contract: { totalAmount: 3 } });
    tx.paymentRecord.aggregate.mockResolvedValue({ _sum: { amount: '0.30' } });
    await expect(CollectionStateService.recalculateContractMilestonePaymentStateTx(asTx(tx), 5))
      .resolves.toEqual({ paidAmount: 0.3, targetAmount: 0.3, status: 'paid' });
    tx.paymentRecord.aggregate.mockResolvedValue({ _sum: { amount: null } });
    await expect(CollectionStateService.recalculateContractMilestonePaymentStateTx(asTx(tx), 5))
      .resolves.toEqual({ paidAmount: 0, targetAmount: 0.3, status: 'pending' });
  });

  test('milestone lock failure or missing target fails closed before aggregate writes', async () => {
    const tx = fixture(); tx.$executeRaw.mockRejectedValue(new Error('milestone lock unavailable'));
    await expect(CollectionStateService.recalculateContractMilestonePaymentStateTx(asTx(tx), 5)).rejects.toThrow('milestone lock unavailable');
    expect(tx.contractMilestone.findUnique).not.toHaveBeenCalled(); expect(tx.paymentRecord.aggregate).not.toHaveBeenCalled();
    tx.$executeRaw.mockResolvedValue(1); tx.contractMilestone.findUnique.mockResolvedValue(null);
    await expect(CollectionStateService.recalculateContractMilestonePaymentStateTx(asTx(tx), 5)).rejects.toThrow('Contract milestone not found: 5');
    expect(tx.paymentRecord.aggregate).not.toHaveBeenCalled(); expect(tx.contractMilestone.update).not.toHaveBeenCalled();
  });

  test('verification acquires order, customer and shared milestone in that order before recording its event', async () => {
    const steps: string[] = [];
    const tx = { order: { update: jest.fn().mockImplementation(async ({ data }) => {
      steps.push(data.updatedAt ? 'order-lock' : 'order-balance');
      return { id: 10, customerId: 20, finalAmount: 1000, receivableAdjustmentAmount: 0 };
    }) }, paymentRecord: { updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([{ amount: 300 }]) },
    adjustmentRecord: { findMany: jest.fn().mockResolvedValue([]) } };
    (prisma.paymentRecord.findUnique as jest.Mock).mockResolvedValue({ id: 1, orderId: 10, status: 'pending', milestoneId: 5 });
    (prisma.$transaction as jest.Mock).mockImplementation(action => action(tx));
    jest.spyOn(CollectionStateService, 'syncCustomerOverdueAmountTx').mockImplementation(async () => { steps.push('customer-lock'); return 0; });
    jest.spyOn(CollectionStateService, 'recalculateContractMilestonePaymentStateTx').mockImplementation(async () => {
      steps.push('milestone-lock'); return { paidAmount: 300, targetAmount: 300, status: 'paid' };
    });
    jest.mocked(recordPaymentVerifiedEventTx).mockImplementation(async () => { steps.push('event'); return { id: 9 } as any; });
    await CollectionStateService.verifyPaymentRecord(1, 2);
    expect(steps).toEqual(['order-lock', 'order-balance', 'customer-lock', 'milestone-lock', 'event']);
    expect(CollectionStateService.recalculateContractMilestonePaymentStateTx).toHaveBeenCalledWith(tx, 5);
  });
});
