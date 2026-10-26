jest.mock('../config/database', () => ({ __esModule: true, default: {
  paymentReversalRequest: { findUnique: jest.fn() }, paymentReversal: { findUnique: jest.fn() },
  paymentRecord: { findUniqueOrThrow: jest.fn() }, order: { findUnique: jest.fn() }, $transaction: jest.fn(),
} }));
jest.mock('../utils/dbRetry', () => ({ withDbRetry: jest.fn((action: () => Promise<unknown>) => action()) }));
jest.mock('./collection-state.service', () => ({ ...jest.requireActual('./collection-state.service'),
  CollectionStateService: { recalculateOrderPaymentStateTx: jest.fn(), recalculateContractMilestonePaymentStateTx: jest.fn() } }));
jest.mock('./payment-ledger-contribution', () => ({ getAppliedFinanceAdjustmentAmountTx: jest.fn().mockResolvedValue(50) }));
jest.mock('./payment-reversal-event.service', () => ({ recordPaymentReversedEventTx: jest.fn().mockResolvedValue({ id: 20 }) }));
import prisma from '../config/database';
import { withDbRetry } from '../utils/dbRetry';
import { CollectionStateService } from './collection-state.service';
import { getAppliedFinanceAdjustmentAmountTx } from './payment-ledger-contribution';
import { recordPaymentReversedEventTx } from './payment-reversal-event.service';
import { requestPaymentReversal, reviewPaymentReversal } from './payment-reversal.service';
import { originalPaymentFacts } from './payment-reversal-facts';
import { requestReversalFingerprint, reviewReversalFingerprint } from './payment-reversal-receipts';

const instant = new Date('2026-10-03T12:00:00.000Z');
const requestFacts = { reasonCategory: 'registration_error' as const, reason: 'Original registration was incorrect' };
const reviewFacts = { decision: 'approve' as const, note: 'Independent original evidence review' };
const actor = { userId: 1, authorize: () => true };
const requestInput = () => ({ ...actor, paymentId: 7, key: 'request-key', facts: requestFacts });
const reviewInput = () => ({ userId: 2, authorize: () => true, requestId: 'request-id', key: 'review-key', facts: reviewFacts });

function fixture() {
  const order = { id: 9, customerId: 4, createdBy: 3, currency: 'CNY', finalAmount: 1000, paidAmount: 350,
    receivableAdjustmentAmount: 0, paymentStatus: 'partial', customer: { salespersonId: 3, poolState: 'owned', segment: 'active' } };
  const payment = { id: 7, orderId: 9, amount: 300, currency: 'CNY', exchangeRate: 1, baseAmount: 300, method: 'bank_transfer',
    status: 'verified', verifiedBy: 8, milestoneId: null as number | null, date: instant, createdAt: instant, updatedAt: instant,
    payerName: 'Customer', isProxy: false, note: 'Original evidence', barterMetadata: null, barterSettlement: null, barterOffsetPostings: [] as unknown[] };
  const request = { id: 'request-id', requestKey: 'request-key', paymentId: 7, activePaymentId: 7 as number | null, requestedBy: 1,
    ...requestFacts, originalPaymentJson: JSON.stringify(originalPaymentFacts(payment as any)), requestAuditId: 12, originalAuditId: 11,
    createdAt: instant, status: 'pending', reviewedBy: null as number | null, reviewKey: null as string | null, reviewNote: null as string | null,
    reviewFingerprint: null as string | null, reviewAuditId: null as number | null, reviewReceiptJson: null as string | null, reviewedAt: null as Date | null,
    fingerprint: '', requestReceiptJson: '' };
  function refreshRequest() {
    request.originalPaymentJson = JSON.stringify(originalPaymentFacts(payment as any));
    request.fingerprint = requestReversalFingerprint(payment.id, 1, requestFacts, request.originalPaymentJson);
    request.requestReceiptJson = JSON.stringify({ version: 'payment-reversal-request/v1', requestId: request.id, requestKey: request.requestKey,
      paymentId: 7, orderId: 9, requestedBy: 1, amount: payment.amount, currency: payment.currency, status: 'pending', auditId: 12,
      requestedAt: instant.toISOString(), ...requestFacts });
  }
  refreshRequest();
  let finalEffect: any = null;
  const tx = { $executeRaw: jest.fn().mockResolvedValue(1), order: { findUnique: jest.fn().mockImplementation(async () => ({ ...order })) },
    paymentRecord: { findUnique: jest.fn().mockResolvedValue({ orderId: 9 }), findUniqueOrThrow: jest.fn().mockResolvedValue(payment),
      findMany: jest.fn().mockResolvedValue([{ amount: 300 }]), aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 300 } }),
      updateMany: jest.fn().mockImplementation(async () => { payment.status = 'reversed'; return { count: 1 }; }) },
    paymentReversalRequest: { findUnique: jest.fn().mockResolvedValue(null), findUniqueOrThrow: jest.fn().mockResolvedValue(request),
      create: jest.fn().mockImplementation(async ({ data }) => ({ ...request, ...data })),
      update: jest.fn().mockImplementation(async ({ data }) => Object.assign(request, data)) },
    paymentReversal: { findUnique: jest.fn().mockImplementation(async () => finalEffect),
      create: jest.fn().mockImplementation(async ({ data }) => { finalEffect = data; return data; }) },
    auditLog: { findMany: jest.fn().mockResolvedValue([{ id: 11 }]), create: jest.fn().mockResolvedValue({ id: 13 }) },
    contractMilestone: { findUnique: jest.fn().mockResolvedValue({ id: 5, amount: 300, percentage: null, contract: { totalAmount: 1000 } }),
      update: jest.fn().mockResolvedValue({}) } };
  (prisma.paymentReversalRequest.findUnique as jest.Mock).mockImplementation(async ({ where }) => where.id ? request : null);
  (prisma.paymentRecord.findUniqueOrThrow as jest.Mock).mockResolvedValue({ orderId: 9 });
  (prisma.order.findUnique as jest.Mock).mockImplementation(async () => ({ ...order }));
  (prisma.paymentReversal.findUnique as jest.Mock).mockImplementation(async () => finalEffect);
  (prisma.$transaction as jest.Mock).mockImplementation(action => action(tx));
  jest.mocked(CollectionStateService.recalculateOrderPaymentStateTx).mockImplementation(async () => { order.paidAmount = 50; return { ...order } as any; });
  function terminal(decision: 'approve' | 'reject' = 'approve') {
    request.status = decision === 'approve' ? 'posted' : 'rejected'; request.activePaymentId = null;
    request.reviewKey = 'review-key'; request.reviewedBy = 2; request.reviewNote = reviewFacts.note; request.reviewAuditId = 13; request.reviewedAt = instant;
    request.reviewFingerprint = reviewReversalFingerprint(request.id, 2, { decision, note: reviewFacts.note });
    request.reviewReceiptJson = JSON.stringify({ version: 'payment-reversal-review/v1', requestId: request.id, reviewKey: request.reviewKey,
      paymentId: 7, orderId: 9, reversalId: decision === 'approve' ? 'effect-id' : null, status: request.status, requestedBy: 1, reviewedBy: 2,
      amount: decision === 'approve' ? -300 : 0, currency: 'CNY', auditId: 13, reviewedAt: instant.toISOString(), beforePaidAmount: 350,
      afterPaidAmount: decision === 'approve' ? 50 : 350 });
    if (decision === 'approve') finalEffect = { id: 'effect-id', paymentId: 7, requestId: request.id, postedBy: 2, auditId: 13, amount: -300, currency: 'CNY',
      receiptJson: request.reviewReceiptJson, createdAt: instant,
      beforeStateJson: JSON.stringify({ orderId: 9, paidAmount: 350, paymentStatus: 'partial' }),
      afterStateJson: JSON.stringify({ orderId: 9, paidAmount: 50, paymentStatus: 'partial' }) };
  }
  return { tx, payment, order, request, refreshRequest, terminal };
}
beforeEach(() => {
  jest.resetAllMocks(); jest.useFakeTimers().setSystemTime(instant);
  (withDbRetry as jest.Mock).mockImplementation(action => action());
  jest.mocked(getAppliedFinanceAdjustmentAmountTx).mockResolvedValue(50);
  jest.mocked(recordPaymentReversedEventTx).mockResolvedValue({ id: 20 } as any);
  // Exercise the shared helper against this mock transaction, not an invented
  // milestone result. Real PostgreSQL race evidence is collected separately.
  jest.mocked(CollectionStateService.recalculateContractMilestonePaymentStateTx).mockImplementation(
    jest.requireActual('./collection-state.service').CollectionStateService.recalculateContractMilestonePaymentStateTx,
  );
});
afterEach(() => jest.useRealTimers());

describe('request service orchestration (mock DB, not real business acceptance)', () => {
  test('fresh request stores original financial facts, audit, fingerprint and durable pending receipt in one serializable callback', async () => {
    const { tx, payment } = fixture();
    const before = { ...payment };
    const result = await requestPaymentReversal(requestInput());
    expect(result).toMatchObject({ replayed: false, receipt: { paymentId: 7, amount: 300, currency: 'CNY', status: 'pending', auditId: 13 } });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: 'Serializable', timeout: 15000 }));
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const data = tx.paymentReversalRequest.create.mock.calls[0][0].data;
    expect(JSON.parse(data.originalPaymentJson)).toEqual(originalPaymentFacts(payment as any));
    expect(JSON.parse(data.requestReceiptJson)).toEqual(result.receipt);
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'PAYMENT_REVERSAL_REQUESTED', userId: 1 }) }));
    expect(tx.paymentRecord.updateMany).not.toHaveBeenCalled(); expect(tx.paymentReversal.create).not.toHaveBeenCalled();
    expect(recordPaymentReversedEventTx).not.toHaveBeenCalled(); expect(payment).toEqual(before);
  });
  test.each(['pending', 'posted', 'rejected'])('same-key replay of %s returns original pending receipt without new writes', async state => {
    const f = fixture(); if (state !== 'pending') f.terminal(state === 'posted' ? 'approve' : 'reject');
    (prisma.paymentReversalRequest.findUnique as jest.Mock).mockResolvedValue(f.request);
    const result = await requestPaymentReversal(requestInput());
    expect(result).toMatchObject({ replayed: true, receipt: { status: 'pending', amount: 300 } });
    expect(prisma.$transaction).not.toHaveBeenCalled(); expect(f.tx.auditLog.create).not.toHaveBeenCalled();
  });
  test.each([{ userId: 3 }, { paymentId: 8 }, { key: 'another-key' }, { facts: { ...requestFacts, reason: 'Changed original reason' } }])(
    'request replay with changed owner or facts %p conflicts', async override => {
      const f = fixture(); (prisma.paymentReversalRequest.findUnique as jest.Mock).mockResolvedValue(f.request);
      await expect(requestPaymentReversal({ ...requestInput(), ...override })).rejects.toMatchObject({ code: 'PAYMENT_REVERSAL_KEY_CONFLICT' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  test('raced same-key owner is replayed using transaction reads, not global reads under a lock', async () => {
    const f = fixture(); f.tx.paymentReversalRequest.findUnique.mockResolvedValue(f.request);
    expect((await requestPaymentReversal(requestInput())).replayed).toBe(true);
    expect(f.tx.order.findUnique).toHaveBeenCalledTimes(2); expect(prisma.order.findUnique).not.toHaveBeenCalled();
    expect(f.tx.auditLog.create).not.toHaveBeenCalled(); expect(f.tx.paymentReversalRequest.create).not.toHaveBeenCalled();
  });
  test('request scope is rechecked on fresh and replay paths', async () => {
    const f = fixture();
    await expect(requestPaymentReversal({ ...requestInput(), authorize: () => false })).rejects.toMatchObject({ status: 403 });
    expect(f.tx.auditLog.create).not.toHaveBeenCalled();
    (prisma.paymentReversalRequest.findUnique as jest.Mock).mockResolvedValue(f.request);
    await expect(requestPaymentReversal({ ...requestInput(), authorize: () => false })).rejects.toMatchObject({ status: 403 });
  });
  test('missing original payment returns 404 and does not create an audit', async () => {
    const f = fixture(); f.tx.paymentRecord.findUnique.mockResolvedValue(null);
    await expect(requestPaymentReversal(requestInput())).rejects.toMatchObject({ code: 'PAYMENT_REVERSAL_NOT_FOUND', status: 404 });
    expect(f.tx.auditLog.create).not.toHaveBeenCalled();
  });
  test('one active request and duplicate original verification audits block fresh writes', async () => {
    const f = fixture(); f.tx.paymentReversalRequest.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(f.request);
    await expect(requestPaymentReversal(requestInput())).rejects.toMatchObject({ code: 'PAYMENT_REVERSAL_ALREADY_PENDING' });
    expect(f.tx.auditLog.create).not.toHaveBeenCalled();
    const g = fixture(); g.tx.auditLog.findMany.mockResolvedValue([{ id: 11 }, { id: 12 }]);
    await expect(requestPaymentReversal(requestInput())).rejects.toMatchObject({ code: 'PAYMENT_REVERSAL_HISTORY_REQUIRES_RECONCILIATION' });
    expect(g.tx.paymentReversalRequest.create).not.toHaveBeenCalled();
  });
  test('a genuine legacy payment without verification audit is not given an invented historical audit', async () => {
    const f = fixture(); f.tx.auditLog.findMany.mockResolvedValue([]);
    await requestPaymentReversal(requestInput());
    expect(f.tx.paymentReversalRequest.create.mock.calls[0][0].data.originalAuditId).toBeNull();
    expect(f.tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
  test.each([{ status: 'pending' }, { status: 'reversed' }, { currency: 'USD' }, { exchangeRate: 2 }, { method: 'barter' },
    { barterMetadata: '{}' }, { barterSettlement: {} }, { barterOffsetPostings: [{}] }, { amount: 0 }, { amount: 1.001 }])(
    'invalid original cash boundary %p does not create a request', async override => {
      const f = fixture(); Object.assign(f.payment, override);
      await expect(requestPaymentReversal(requestInput())).rejects.toThrow();
      expect(f.tx.auditLog.create).not.toHaveBeenCalled(); expect(f.tx.paymentReversalRequest.create).not.toHaveBeenCalled();
    });
  test('unique collision resolves to same owner only after the transaction rejects', async () => {
    const f = fixture(); (prisma.paymentReversalRequest.findUnique as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce(f.request);
    (prisma.$transaction as jest.Mock).mockRejectedValue({ code: 'P2002' });
    expect((await requestPaymentReversal(requestInput())).replayed).toBe(true);
    expect(f.tx.paymentReversalRequest.create).not.toHaveBeenCalled();
  });
  test('unknown unique collision remains conflict, not a new request or positive receipt', async () => {
    fixture(); (prisma.$transaction as jest.Mock).mockRejectedValue({ code: 'P2002' });
    await expect(requestPaymentReversal(requestInput())).rejects.toMatchObject({ code: 'PAYMENT_REVERSAL_ALREADY_PENDING' });
  });
});

describe('independent review orchestration (mock DB, rollback requires actual integration evidence)', () => {
  test('approve subtracts full original cash, preserves adjustment, creates one effect and one durable event', async () => {
    const f = fixture(); const immutable = originalPaymentFacts(f.payment as any);
    const result = await reviewPaymentReversal(reviewInput());
    expect(result).toMatchObject({ replayed: false, receipt: { amount: -300, beforePaidAmount: 350, afterPaidAmount: 50, status: 'posted' }, currentOrder: { paidAmount: 50 } });
    expect(originalPaymentFacts(f.payment as any)).toEqual(immutable);
    expect(f.tx.paymentReversal.create).toHaveBeenCalledTimes(1); expect(f.tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(f.tx.paymentRecord.updateMany).toHaveBeenCalledWith({ where: { id: 7, status: 'verified' }, data: { status: 'reversed' } });
    expect(recordPaymentReversedEventTx).toHaveBeenCalledWith(f.tx, result.receipt.reversalId);
    expect(f.tx.paymentReversalRequest.update.mock.calls[0][0].data).toMatchObject({ activePaymentId: null, status: 'posted', reviewedBy: 2 });
  });
  test('rejection closes the attempt but has no financial, payment, milestone or event effects', async () => {
    const f = fixture(); const before = { ...f.payment };
    const result = await reviewPaymentReversal({ ...reviewInput(), facts: { ...reviewFacts, decision: 'reject' } });
    expect(result.receipt).toMatchObject({ amount: 0, beforePaidAmount: 350, afterPaidAmount: 350, reversalId: null, status: 'rejected' });
    expect(f.payment).toEqual(before); expect(f.tx.paymentReversal.create).not.toHaveBeenCalled(); expect(f.tx.paymentRecord.updateMany).not.toHaveBeenCalled();
    expect(CollectionStateService.recalculateOrderPaymentStateTx).not.toHaveBeenCalled(); expect(recordPaymentReversedEventTx).not.toHaveBeenCalled();
    expect(f.tx.paymentReversalRequest.update.mock.calls[0][0].data.activePaymentId).toBeNull();
  });
  test.each(['pending', 'posted'])('requester cannot review own %s attempt, even exact-key replay', async state => {
    const f = fixture(); if (state === 'posted') f.terminal();
    await expect(reviewPaymentReversal({ ...reviewInput(), userId: 1 })).rejects.toMatchObject({ code: 'PAYMENT_REVERSAL_SEPARATION_REQUIRED', status: 403 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  test('approved replay after later cash returns original acknowledgment and fresh order without posting twice', async () => {
    const f = fixture(); f.terminal(); f.order.paidAmount = 150;
    const result = await reviewPaymentReversal(reviewInput());
    expect(result).toMatchObject({ replayed: true, receipt: { beforePaidAmount: 350, afterPaidAmount: 50 }, currentOrder: { paidAmount: 150 } });
    expect(prisma.$transaction).not.toHaveBeenCalled(); expect(recordPaymentReversedEventTx).not.toHaveBeenCalled();
  });
  test('rejected replay has no final effect and immutable zero amount', async () => {
    const f = fixture(); f.terminal('reject');
    const result = await reviewPaymentReversal({ ...reviewInput(), facts: { ...reviewFacts, decision: 'reject' } });
    expect(result).toMatchObject({ replayed: true, receipt: { amount: 0, status: 'rejected' } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  test.each([{ key: 'different-key' }, { userId: 3 }, { requestId: 'other-request' }, { facts: { ...reviewFacts, note: 'Changed review note' } },
    { facts: { ...reviewFacts, decision: 'reject' as const } }])('terminal changed owner or facts %p remain conflict', async override => {
      const f = fixture(); f.terminal();
      await expect(reviewPaymentReversal({ ...reviewInput(), ...override })).rejects.toMatchObject({ code: 'PAYMENT_REVERSAL_REVIEW_CONFLICT' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  test('scope denial on terminal replay and fresh review cannot create money', async () => {
    const f = fixture();
    await expect(reviewPaymentReversal({ ...reviewInput(), authorize: () => false })).rejects.toMatchObject({ status: 403 });
    expect(f.tx.auditLog.create).not.toHaveBeenCalled();
    f.terminal(); await expect(reviewPaymentReversal({ ...reviewInput(), authorize: () => false })).rejects.toMatchObject({ status: 403 });
  });
  test('review key used by another request blocks before transaction', async () => {
    const f = fixture(); (prisma.paymentReversalRequest.findUnique as jest.Mock).mockResolvedValueOnce(f.request).mockResolvedValueOnce({ ...f.request, id: 'another-request' });
    await expect(reviewPaymentReversal(reviewInput())).rejects.toMatchObject({ code: 'PAYMENT_REVERSAL_REVIEW_CONFLICT' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  test('request missing before transaction is a 404', async () => {
    fixture(); (prisma.paymentReversalRequest.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(reviewPaymentReversal(reviewInput())).rejects.toMatchObject({ code: 'PAYMENT_REVERSAL_NOT_FOUND', status: 404 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  test('changed original financial facts do not get hidden by reversal', async () => {
    const f = fixture(); f.payment.verifiedBy = 9;
    await expect(reviewPaymentReversal(reviewInput())).rejects.toMatchObject({ code: 'PAYMENT_REVERSAL_ORIGINAL_CHANGED' });
    expect(f.tx.auditLog.create).not.toHaveBeenCalled(); expect(f.tx.paymentReversal.create).not.toHaveBeenCalled();
  });
  test('drift, overflow, and negative net balance fail before financial writes', async () => {
    const drift = fixture(); jest.mocked(getAppliedFinanceAdjustmentAmountTx).mockResolvedValue(49);
    await expect(reviewPaymentReversal(reviewInput())).rejects.toMatchObject({ code: 'PAYMENT_REVERSAL_LEDGER_DRIFT' });
    expect(drift.tx.auditLog.create).not.toHaveBeenCalled();
    const overflow = fixture(); jest.mocked(getAppliedFinanceAdjustmentAmountTx).mockResolvedValue(50); overflow.order.finalAmount = 200;
    await expect(reviewPaymentReversal(reviewInput())).rejects.toMatchObject({ code: 'PAYMENT_REVERSAL_LEDGER_DRIFT' });
    expect(overflow.tx.paymentReversal.create).not.toHaveBeenCalled();
    const negative = fixture(); jest.mocked(getAppliedFinanceAdjustmentAmountTx).mockResolvedValue(-50); negative.order.paidAmount = 250;
    await expect(reviewPaymentReversal(reviewInput())).rejects.toMatchObject({ code: 'PAYMENT_REVERSAL_NEGATIVE_LEDGER' });
    expect(negative.tx.auditLog.create).not.toHaveBeenCalled();
  });
  test('canonical finance query failure is propagated, not interpreted as zero', async () => {
    const f = fixture(); jest.mocked(getAppliedFinanceAdjustmentAmountTx).mockRejectedValue(new Error('ledger unavailable'));
    await expect(reviewPaymentReversal(reviewInput())).rejects.toThrow('ledger unavailable');
    expect(f.tx.auditLog.create).not.toHaveBeenCalled(); expect(recordPaymentReversedEventTx).not.toHaveBeenCalled();
  });
  test('lost pending->reversed claim throws and cannot reach event recording', async () => {
    const f = fixture(); f.tx.paymentRecord.updateMany.mockResolvedValue({ count: 0 });
    await expect(reviewPaymentReversal(reviewInput())).rejects.toMatchObject({ code: 'PAYMENT_REVERSAL_INVALID_STATE' });
    expect(CollectionStateService.recalculateOrderPaymentStateTx).not.toHaveBeenCalled(); expect(recordPaymentReversedEventTx).not.toHaveBeenCalled();
  });
  test('wrong post-rebuild balance throws before durable event', async () => {
    fixture(); jest.mocked(CollectionStateService.recalculateOrderPaymentStateTx).mockResolvedValue({ paidAmount: 49 } as any);
    await expect(reviewPaymentReversal(reviewInput())).rejects.toMatchObject({ code: 'PAYMENT_REVERSAL_LEDGER_DRIFT' });
    expect(recordPaymentReversedEventTx).not.toHaveBeenCalled();
  });
  test.each([[100, 'pending'], [300, 'paid']])('milestone remaining cash %p is rebuilt to %s before event', async (remaining, expected) => {
    const f = fixture(); f.payment.milestoneId = 5; f.refreshRequest();
    f.tx.paymentRecord.aggregate.mockResolvedValue({ _sum: { amount: Number(remaining) } });
    await reviewPaymentReversal(reviewInput());
    expect(CollectionStateService.recalculateContractMilestonePaymentStateTx).toHaveBeenCalledWith(f.tx, 5);
    expect(jest.mocked(CollectionStateService.recalculateOrderPaymentStateTx).mock.invocationCallOrder[0])
      .toBeLessThan(jest.mocked(CollectionStateService.recalculateContractMilestonePaymentStateTx).mock.invocationCallOrder[0]);
    expect(f.tx.$executeRaw.mock.invocationCallOrder[1]).toBeLessThan(f.tx.paymentRecord.aggregate.mock.invocationCallOrder[0]);
    expect(f.tx.contractMilestone.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { status: expected } });
    expect(f.tx.contractMilestone.update.mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(recordPaymentReversedEventTx).mock.invocationCallOrder[0]);
  });
  test('durable event failure rejects entire owning transaction callback; mock does not claim real rollback', async () => {
    fixture(); jest.mocked(recordPaymentReversedEventTx).mockRejectedValue(new Error('outbox unavailable'));
    await expect(reviewPaymentReversal(reviewInput())).rejects.toThrow('outbox unavailable');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
  test('unique race resolves committed terminal receipt, while unknown pending owner remains conflict', async () => {
    const f = fixture();
    (prisma.$transaction as jest.Mock).mockImplementation(async () => { f.terminal(); throw { code: 'P2002' }; });
    expect((await reviewPaymentReversal(reviewInput())).replayed).toBe(true);
    const g = fixture(); (prisma.$transaction as jest.Mock).mockRejectedValue({ code: 'P2002' });
    await expect(reviewPaymentReversal(reviewInput())).rejects.toMatchObject({ code: 'PAYMENT_REVERSAL_REVIEW_CONFLICT' });
    expect(g.tx.auditLog.create).not.toHaveBeenCalled();
  });
});
