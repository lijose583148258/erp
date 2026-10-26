jest.mock('../config/database', () => ({ __esModule: true, default: {
  paymentSubmission: { findUnique: jest.fn() }, $transaction: jest.fn(),
} }));
jest.mock('../utils/dbRetry', () => ({ withDbRetry: jest.fn((action: () => Promise<unknown>) => action()) }));
import prisma from '../config/database';
import { withDbRetry } from '../utils/dbRetry';
import { normalizePaymentSubmissionFacts as facts, normalizePaymentSubmissionKey as key, paymentSubmissionFingerprint as fingerprint,
  readPaymentSubmissionReplay, submitPaymentDurably } from './payment-submission.service';

const payload = { amount: 300, method: 'bank_transfer', payerName: ' Payer ', note: ' Evidence ', isProxy: false, date: '2026-10-03' };
const receipt = { version: 'payment-submission/v1', requestKey: 'request-key-123', orderId: 10, paymentId: 7,
  amount: 300, method: 'bank_transfer', date: '2026-10-03T00:00:00.000Z', submittedBy: 3, auditId: 9,
  submittedAt: '2026-10-03T12:00:00.000Z', status: 'pending' };
const stored = () => ({ requestKey: receipt.requestKey, userId: 3, paymentId: 7, fingerprint: fingerprint(10, facts(payload)), resultJson: JSON.stringify(receipt) });
const tx = () => ({ $executeRaw: jest.fn().mockResolvedValue(1),
  paymentSubmission: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
  order: { findUnique: jest.fn().mockResolvedValueOnce({ id: 10, status: 'approved', currency: 'CNY', paidAmount: 0, finalAmount: 1000, receivableAdjustmentAmount: 0, paymentStatus: 'unpaid' })
    .mockResolvedValue({ contract: null }) },
  paymentRecord: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }), create: jest.fn().mockResolvedValue({ id: 7, date: new Date(receipt.date), createdAt: new Date(receipt.submittedAt) }) },
  auditLog: { create: jest.fn().mockResolvedValue({ id: 9 }) },
});
beforeEach(() => { jest.clearAllMocks(); (withDbRetry as jest.Mock).mockImplementation(action => action()); });
test.each([undefined, '', 'short', ' a-valid-key', 'bad/key-name', 'x'.repeat(101)])('rejects missing/unstable key %p', value => {
  expect(() => key(value)).toThrow('Idempotency-Key');
});
test('canonical financial facts ignore textual whitespace but not date, amount, actor or order identity', () => {
  const f = facts(payload); expect(f.payerName).toBe('Payer');
  expect(fingerprint(10, f)).toBe(fingerprint(10, facts({ ...payload, payerName: 'Payer', amount: '300.00' })));
  for (const override of [{ amount: 301 }, { date: '2026-10-04' }, { method: 'cash' }, { isProxy: true }, { note: 'different' }]) {
    expect(fingerprint(10, facts({ ...payload, ...override }))).not.toBe(fingerprint(10, f));
  }
  expect(fingerprint(11, f)).not.toBe(fingerprint(10, f));
});
test.each([{ amount: 0 }, { amount: NaN }, { amount: 1.001 }, { currency: 'USD' }, { exchangeRate: 2 },
  { baseAmount: 0 }, { date: '2026-02-30' }, { date: 'not-a-date' }, { isProxy: 'false' }, { method: 'unsupported' }])('rejects ambiguous/ignored financial facts %p', override => {
  expect(() => facts({ ...payload, ...override })).toThrow();
});
test('read-back returns the original receipt after verification without depending on mutable payment status', () => {
  expect(readPaymentSubmissionReplay(stored(), 3, 10, fingerprint(10, facts(payload)), facts(payload))).toEqual(receipt);
});
test.each([null, {}, { ...receipt, auditId: -1 }, { ...receipt, paymentId: 8 }, { ...receipt, status: 'verified' }, { ...receipt, amount: 301 }, { ...receipt, method: 'cash' }, { ...receipt, date: '2026-10-04T00:00:00.000Z' }])('corrupt receipt fails closed %p', value => {
  expect(() => readPaymentSubmissionReplay({ ...stored(), resultJson: JSON.stringify(value) }, 3, 10, fingerprint(10, facts(payload)), facts(payload))).toThrow();
});
test('same key with changed facts or a different actor conflicts, never creates new money', () => {
  expect(() => readPaymentSubmissionReplay(stored(), 4, 10, stored().fingerprint, facts(payload))).toThrow();
  expect(() => readPaymentSubmissionReplay(stored(), 3, 10, 'different', facts(payload))).toThrow();
});
test('fresh registration inserts payment, audit and durable identity in one transaction', async () => {
  const t = tx(); (prisma.paymentSubmission.findUnique as jest.Mock).mockResolvedValue(null);
  (prisma.$transaction as jest.Mock).mockImplementation(action => action(t));
  expect(await submitPaymentDurably({ orderId: 10, userId: 3, key: receipt.requestKey, facts: facts(payload), authorize: () => true })).toEqual({ replayed: false, receipt });
  expect(t.paymentRecord.create).toHaveBeenCalledTimes(1); expect(t.auditLog.create).toHaveBeenCalledTimes(1); expect(t.paymentSubmission.create).toHaveBeenCalledTimes(1);
  expect(JSON.parse(t.paymentSubmission.create.mock.calls[0][0].data.resultJson)).toEqual(receipt);
});
test('durable replay takes the read-only path without touching the order or notifications', async () => {
  (prisma.paymentSubmission.findUnique as jest.Mock).mockResolvedValue(stored());
  expect((await submitPaymentDurably({ orderId: 10, userId: 3, key: receipt.requestKey, facts: facts(payload), authorize: () => true })).replayed).toBe(true);
  expect(prisma.$transaction).not.toHaveBeenCalled();
});
test('recheck after locking resolves a raced same-key submit without a new record', async () => {
  const t = tx(); t.paymentSubmission.findUnique.mockResolvedValue(stored());
  (prisma.paymentSubmission.findUnique as jest.Mock).mockResolvedValue(null); (prisma.$transaction as jest.Mock).mockImplementation(action => action(t));
  expect((await submitPaymentDurably({ orderId: 10, userId: 3, key: receipt.requestKey, facts: facts(payload), authorize: () => true })).replayed).toBe(true);
  expect(t.paymentRecord.create).not.toHaveBeenCalled(); expect(t.auditLog.create).not.toHaveBeenCalled();
});
test('collision across different order locks is read only after transaction rollback', async () => {
  (prisma.paymentSubmission.findUnique as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce(stored());
  (prisma.$transaction as jest.Mock).mockRejectedValue({ code: 'P2002' });
  expect((await submitPaymentDurably({ orderId: 10, userId: 3, key: receipt.requestKey, facts: facts(payload), authorize: () => true })).replayed).toBe(true);
});
test('fresh pending over-capacity or scope denial is not acknowledged as success', async () => {
  for (const allowed of [true, false]) {
    const t = tx(); t.paymentRecord.aggregate.mockResolvedValue({ _sum: { amount: 900 } });
    (prisma.paymentSubmission.findUnique as jest.Mock).mockResolvedValue(null); (prisma.$transaction as jest.Mock).mockImplementation(action => action(t));
    await expect(submitPaymentDurably({ orderId: 10, userId: 3, key: receipt.requestKey, facts: facts(payload), authorize: () => allowed })).rejects.toThrow();
    expect(t.paymentRecord.create).not.toHaveBeenCalled(); expect(t.auditLog.create).not.toHaveBeenCalled();
  }
});
test('a foreign-currency order cannot silently create a CNY payment against a foreign balance', async () => {
  const t = tx(); t.order.findUnique.mockReset().mockResolvedValue({ id: 10, currency: 'USD' });
  (prisma.paymentSubmission.findUnique as jest.Mock).mockResolvedValue(null); (prisma.$transaction as jest.Mock).mockImplementation(action => action(t));
  await expect(submitPaymentDurably({ orderId: 10, userId: 3, key: receipt.requestKey, facts: facts(payload), authorize: () => true })).rejects.toThrow('CNY 订单');
  expect(t.paymentRecord.create).not.toHaveBeenCalled(); expect(t.auditLog.create).not.toHaveBeenCalled();
});
test('serialization retry reads the committed owner before acquiring a new order lock', async () => {
  (withDbRetry as jest.Mock).mockImplementation(async action => { try { return await action(); } catch { return action(); } });
  (prisma.paymentSubmission.findUnique as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce(stored());
  (prisma.$transaction as jest.Mock).mockRejectedValue({ code: 'P2034' });
  const result = await submitPaymentDurably({ orderId: 10, userId: 3, key: receipt.requestKey, facts: facts(payload), authorize: () => true });
  expect(result).toEqual({ replayed: true, receipt }); expect(prisma.$transaction).toHaveBeenCalledTimes(1);
});
