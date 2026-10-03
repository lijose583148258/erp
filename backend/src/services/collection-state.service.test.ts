import prisma from '../config/database';
import { calculateVerifiedPaymentState, CollectionStateService, PAYMENT_STATE_BELOW_ZERO, PAYMENT_VERIFICATION_EXCEEDS_OUTSTANDING } from './collection-state.service';
import { recordPaymentVerifiedEventTx } from './payment-verification-event.service';
import { appliedFinanceAdjustmentWhere, getAppliedFinanceAdjustmentAmountTx } from './payment-ledger-contribution';
import type { Prisma } from '@prisma/client';

jest.mock('../config/database', () => ({ __esModule: true, default: { paymentRecord: { findUnique: jest.fn() }, $transaction: jest.fn() } }));
jest.mock('./payment-verification-event.service', () => ({ recordPaymentVerifiedEventTx: jest.fn() }));

describe('collection state money precision', () => {
  it('treats 0.1 plus 0.2 as an exactly paid 0.3 order', () => {
    expect(calculateVerifiedPaymentState({
      verifiedPayments: [{ amount: '0.1' }, { amount: '0.2' }],
      finalAmount: '0.3',
    })).toEqual({
      paidAmount: 0.3,
      effectiveReceivableAmount: 0.3,
      exceedsOutstanding: false,
      paymentStatus: 'paid',
    });
  });

  it('accepts exact split verification and rejects an aggregate overpayment', () => {
    expect(calculateVerifiedPaymentState({
      verifiedPayments: [{ amount: '400' }, { amount: '600' }],
      finalAmount: '1000',
    }).exceedsOutstanding).toBe(false);

    expect(calculateVerifiedPaymentState({
      verifiedPayments: [{ amount: '700' }, { amount: '700' }],
      finalAmount: '1000',
    })).toMatchObject({
      paidAmount: 1400,
      effectiveReceivableAmount: 1000,
      exceedsOutstanding: true,
      paymentStatus: 'paid',
    });
  });

  it('applies receivable adjustments before deciding payment status', () => {
    expect(calculateVerifiedPaymentState({
      verifiedPayments: [{ amount: '899.99' }],
      finalAmount: '1000',
      receivableAdjustmentAmount: '100',
    })).toMatchObject({
      paidAmount: 899.99,
      effectiveReceivableAmount: 900,
      exceedsOutstanding: false,
      paymentStatus: 'partial',
    });

    expect(calculateVerifiedPaymentState({
      verifiedPayments: [{ amount: '900' }],
      finalAmount: '1000',
      receivableAdjustmentAmount: '100',
    })).toMatchObject({
      exceedsOutstanding: false,
      paymentStatus: 'paid',
    });
  });
});

describe('canonical applied finance contributions', () => {
  it('retains a legitimate adjustment alongside later verified cash and separate AR reductions', () => {
    expect(calculateVerifiedPaymentState({ verifiedPayments: [{ amount: 300 }, { amount: 100 }],
      appliedFinanceAdjustmentAmount: 50, finalAmount: 1000, receivableAdjustmentAmount: 550 })).toEqual({
      paidAmount: 450, effectiveReceivableAmount: 450, exceedsOutstanding: false, paymentStatus: 'paid',
    });
    expect(calculateVerifiedPaymentState({ verifiedPayments: [{ amount: 300 }, { amount: 100 }],
      appliedFinanceAdjustmentAmount: -40, finalAmount: 1000 }).paidAmount).toBe(360);
  });
  it('queries applied posted AND reversed originals, but never an unapplied cancelled request', async () => {
    const query = jest.fn().mockResolvedValue([{ amountDelta: 50 }, { amountDelta: -50 }, { amountDelta: 0.1 }, { amountDelta: 0.2 }]);
    const tx = { adjustmentRecord: { findMany: query } } as unknown as Prisma.TransactionClient;
    expect(await getAppliedFinanceAdjustmentAmountTx(tx, 10)).toBe(0.3);
    expect(query).toHaveBeenCalledWith({ where: { domain: 'finance', OR: [{ orderId: 10 }, { orderId: null, targetId: 10 }],
      status: { in: ['posted', 'reversed'] }, appliedAt: { not: null } }, select: { amountDelta: true } });
    expect(appliedFinanceAdjustmentWhere(11)).not.toEqual(appliedFinanceAdjustmentWhere(10));
  });
  it('does not disguise a failed ledger read as zero adjustments', async () => {
    const tx = { adjustmentRecord: { findMany: jest.fn().mockRejectedValue(new Error('ledger unavailable')) } } as unknown as Prisma.TransactionClient;
    await expect(getAppliedFinanceAdjustmentAmountTx(tx, 10)).rejects.toThrow('ledger unavailable');
  });
});

describe('cash verification and payment rebuild share the applied ledger', () => {
  const fixture = (cash: number, delta: number) => ({
    order: { update: jest.fn().mockResolvedValue({ id: 10, customerId: 20, finalAmount: 1000, receivableAdjustmentAmount: 0 }) },
    paymentRecord: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findMany: jest.fn().mockResolvedValue([{ amount: cash }]) },
    adjustmentRecord: { findMany: jest.fn().mockResolvedValue([{ amountDelta: delta }]) },
  });
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(CollectionStateService, 'syncCustomerOverdueAmountTx').mockResolvedValue(0);
    (prisma.paymentRecord.findUnique as jest.Mock).mockResolvedValue({ id: 1, orderId: 10, status: 'pending', milestoneId: null });
  });
  afterEach(() => jest.restoreAllMocks());
  it('persists 450, not 400, in both verification and the barter/reversal rebuild path', async () => {
    const tx = fixture(400, 50);
    (prisma.$transaction as jest.Mock).mockImplementation(action => action(tx));
    await CollectionStateService.verifyPaymentRecord(1, 2);
    expect(tx.order.update).toHaveBeenLastCalledWith({ where: { id: 10 }, data: { paidAmount: 450, paymentStatus: 'partial' } });
    expect(recordPaymentVerifiedEventTx).toHaveBeenCalledTimes(1);
    tx.order.update.mockClear();
    await expect(CollectionStateService.recalculateOrderPaymentStateTx(tx as unknown as Prisma.TransactionClient, 10))
      .resolves.toEqual({ paidAmount: 450, paymentStatus: 'partial' });
    expect(tx.order.update.mock.calls[0][0].data).toEqual({ updatedAt: expect.any(Date) });
    expect(tx.order.update).toHaveBeenLastCalledWith({ where: { id: 10 }, data: { paidAmount: 450, paymentStatus: 'partial' } });
  });
  it.each([[1000,100,PAYMENT_VERIFICATION_EXCEEDS_OUTSTANDING], [100,-200,PAYMENT_STATE_BELOW_ZERO]])
    ('fails closed before financial writes/events when cash=%s and applied adjustment=%s', async (cash, delta, message) => {
      const tx = fixture(cash as number, delta as number);
      (prisma.$transaction as jest.Mock).mockImplementation(action => action(tx));
      await expect(CollectionStateService.verifyPaymentRecord(1, 2)).rejects.toThrow(message as string);
      expect(tx.order.update).toHaveBeenCalledTimes(1); expect(recordPaymentVerifiedEventTx).not.toHaveBeenCalled();
      tx.order.update.mockClear();
      await expect(CollectionStateService.recalculateOrderPaymentStateTx(tx as unknown as Prisma.TransactionClient, 10)).rejects.toThrow(message as string);
      expect(tx.order.update).toHaveBeenCalledTimes(1);
    });
});
