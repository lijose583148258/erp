import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { withDbRetry } from '../utils/dbRetry';
import { getOutstandingAmount } from './collection/collection.helpers';

export class PaymentSubmissionError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409) { super(message); }
}
export interface PaymentSubmissionFacts {
  amount: number; method: string; payerName: string | null; note: string | null; isProxy: boolean; date: string | null;
}
export interface PaymentSubmissionReceipt {
  version: 'payment-submission/v1'; requestKey: string; paymentId: number; orderId: number; amount: number;
  method: string; date: string; submittedBy: number; auditId: number; submittedAt: string; status: 'pending';
}
const invalid = (message: string): never => { throw new PaymentSubmissionError('PAYMENT_SUBMISSION_INVALID', message, 400); };
export function normalizePaymentSubmissionKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(value)) {
    throw new PaymentSubmissionError('PAYMENT_SUBMISSION_KEY_REQUIRED', '登记回款必须提供有效且稳定的 Idempotency-Key。', 400);
  }
  return value;
}
export function normalizePaymentSubmissionFacts(input: Record<string, unknown>): PaymentSubmissionFacts {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) invalid('回款金额必须大于 0。');
  const decimal = new Prisma.Decimal(String(amount));
  if (decimal.decimalPlaces() > 2 || !Number.isSafeInteger(decimal.times(100).toNumber())) invalid('回款金额须为可准确记账的两位小数。');
  if (!['bank_transfer', 'cash', 'alipay', 'wechat', 'check', 'wire_transfer'].includes(String(input.method))) invalid('回款方式无效。');
  // This route books CNY today; reject ignored monetary fields, never silently reinterpret them.
  if (input.currency !== undefined && input.currency !== 'CNY') invalid('此登记入口当前只支持 CNY。');
  if (input.exchangeRate !== undefined && Number(input.exchangeRate) !== 1) invalid('此登记入口不支持外币汇率。');
  if (input.baseAmount !== undefined && Number(input.baseAmount) !== amount) invalid('本位币金额与登记金额不一致。');
  const text = (value: unknown, max: number) => {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || value.length > max) invalid('回款文本字段无效或过长。');
    return (value as string).trim() || null;
  };
  if (input.isProxy !== undefined && typeof input.isProxy !== 'boolean') invalid('代付标志须为布尔值。');
  let date: string | null = null;
  if (input.date !== undefined && input.date !== '') {
    if (typeof input.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) invalid('回款日期须为 YYYY-MM-DD。');
    const parsed = new Date(`${input.date}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== input.date) invalid('回款日期无效。');
    date = input.date as string;
  }
  return { amount, method: String(input.method), payerName: text(input.payerName, 200), note: text(input.note, 2000), isProxy: input.isProxy === true, date };
}
export const paymentSubmissionFingerprint = (orderId: number, facts: PaymentSubmissionFacts) => createHash('sha256')
  .update(JSON.stringify({ version: 'payment-submission-facts/v1', orderId, ...facts })).digest('hex');

type Stored = { requestKey: string; userId: number; fingerprint: string; paymentId: number; resultJson: string };
export function readPaymentSubmissionReplay(stored: Stored, userId: number, orderId: number, fingerprint: string, facts: PaymentSubmissionFacts): PaymentSubmissionReceipt {
  if (stored.userId !== userId || stored.fingerprint !== fingerprint) {
    throw new PaymentSubmissionError('PAYMENT_SUBMISSION_KEY_CONFLICT', '该请求身份已用于不同的登记主体或回款事实。');
  }
  let receipt: PaymentSubmissionReceipt;
  try { receipt = JSON.parse(stored.resultJson); if (!receipt || typeof receipt !== 'object') throw new Error('Invalid receipt'); }
  catch { throw new PaymentSubmissionError('PAYMENT_SUBMISSION_STATE_INVALID', '原登记回执无效，须核对原记录，不能重新入账。'); }
  if (receipt.version !== 'payment-submission/v1' || receipt.paymentId !== stored.paymentId || receipt.orderId !== orderId
    || receipt.requestKey !== stored.requestKey || receipt.submittedBy !== userId || receipt.status !== 'pending'
    || !Number.isSafeInteger(receipt.auditId) || receipt.auditId <= 0 || !Number.isFinite(receipt.amount) || receipt.amount <= 0
    || receipt.amount !== facts.amount || receipt.method !== facts.method
    || (facts.date !== null && receipt.date !== `${facts.date}T00:00:00.000Z`)
    || !Number.isFinite(Date.parse(receipt.date)) || !Number.isFinite(Date.parse(receipt.submittedAt))) {
    throw new PaymentSubmissionError('PAYMENT_SUBMISSION_STATE_INVALID', '原登记回执与持久身份不一致，不能重新入账。');
  }
  return receipt;
}

type Input = { orderId: number; userId: number; key: string; facts: PaymentSubmissionFacts; ip?: string; userAgent?: string;
  authorize: (order: any) => boolean };
export async function submitPaymentDurably(input: Input): Promise<{ replayed: boolean; receipt: PaymentSubmissionReceipt }> {
  const { orderId, userId, key, facts } = input, fingerprint = paymentSubmissionFingerprint(orderId, facts);
  const replay = (row: Stored) => ({ replayed: true, receipt: readPaymentSubmissionReplay(row, userId, orderId, fingerprint, facts) });
  try {
    return await withDbRetry(async () => {
      // On every serialization retry, acknowledge an already committed owner
      // without another no-op UPDATE/MVCC version or a new lock race.
      const existing = await prisma.paymentSubmission.findUnique({ where: { requestKey: key } });
      if (existing) return replay(existing);
      return prisma.$transaction(async tx => {
      // Same-order serialization without altering updatedAt on a no-op replay.
      await tx.$executeRaw`UPDATE "orders" SET "id" = "id" WHERE "id" = ${orderId}`;
      const order = await tx.order.findUnique({ where: { id: orderId }, select: { id: true, status: true, createdBy: true,
        paymentStatus: true, paidAmount: true, finalAmount: true, receivableAdjustmentAmount: true, currency: true,
        customer: { select: { salespersonId: true, poolState: true, segment: true } } } });
      if (!order || !input.authorize(order)) throw new PaymentSubmissionError('PAYMENT_SUBMISSION_SCOPE_DENIED', '无权为该订单登记回款。', 403);
      const raced = await tx.paymentSubmission.findUnique({ where: { requestKey: key } });
      if (raced) return replay(raced);
      if (order.currency !== 'CNY') invalid('此登记入口当前只支持 CNY 订单。');
      if (order.status === 'cancelled') throw new PaymentSubmissionError('PAYMENT_SUBMISSION_ORDER_CANCELLED', '已取消订单不能登记回款。', 400);
      const outstanding = getOutstandingAmount(Number(order.finalAmount), Number(order.paidAmount), Number(order.receivableAdjustmentAmount));
      if (outstanding <= 0.01 || order.paymentStatus === 'paid') throw new PaymentSubmissionError('PAYMENT_SUBMISSION_ORDER_PAID', '该订单已全部回款，无需新增登记。', 400);
      if (facts.amount - outstanding > 0.01) throw new PaymentSubmissionError('PAYMENT_SUBMISSION_OVER_BALANCE', '回款金额不能超过订单未回款余额。', 400);
      const pending = await tx.paymentRecord.aggregate({ where: { orderId, status: 'pending' }, _sum: { amount: true } });
      if (facts.amount - Math.max(0, outstanding - Number(pending._sum.amount || 0)) > 0.01) {
        throw new PaymentSubmissionError('PAYMENT_SUBMISSION_PENDING_CAPACITY', '待核销回款已覆盖剩余未回款金额，请先处理待核销记录。');
      }
      const contract = await tx.order.findUnique({ where: { id: orderId }, select: { contract: { select: { milestones: {
        where: { status: 'pending' }, orderBy: { id: 'asc' }, take: 1, select: { id: true },
      } } } } });
      const milestoneId = contract?.contract?.milestones?.[0]?.id ?? null;
      const payment = await tx.paymentRecord.create({ data: { orderId, amount: facts.amount, currency: 'CNY', exchangeRate: 1,
        baseAmount: facts.amount, method: facts.method, payerName: facts.payerName, note: facts.note, isProxy: facts.isProxy,
        date: facts.date ? new Date(`${facts.date}T00:00:00.000Z`) : undefined, milestoneId, status: 'pending' } });
      const audit = await tx.auditLog.create({ data: { userId, action: 'PAYMENT_SUBMITTED', resource: 'order', resourceId: orderId,
        details: JSON.stringify({ paymentId: payment.id, amount: facts.amount, method: facts.method, milestoneId, status: 'pending',
          submissionKeyHash: createHash('sha256').update(key).digest('hex'), fingerprint }), ipAddress: input.ip, userAgent: input.userAgent } });
      const receipt: PaymentSubmissionReceipt = { version: 'payment-submission/v1', requestKey: key, paymentId: payment.id, orderId,
        amount: facts.amount, method: facts.method, date: payment.date.toISOString(), submittedBy: userId, auditId: audit.id,
        submittedAt: payment.createdAt.toISOString(), status: 'pending' };
      await tx.paymentSubmission.create({ data: { requestKey: key, userId, fingerprint, paymentId: payment.id, resultJson: JSON.stringify(receipt) } });
      return { replayed: false, receipt };
      }, { maxWait: 10000, timeout: 15000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }, { label: 'submitPaymentDurably' });
  } catch (error) {
    // A key collision across different order locks aborts the losing transaction.
    // Read only after rollback; never catch P2002 inside an aborted PostgreSQL tx.
    if ((error as { code?: string }).code === 'P2002') {
      const winner = await prisma.paymentSubmission.findUnique({ where: { requestKey: key } });
      if (winner) return replay(winner);
    }
    throw error;
  }
}
