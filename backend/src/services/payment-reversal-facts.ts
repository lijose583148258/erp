import { createHash } from 'crypto';
import { Prisma, type PaymentRecord } from '@prisma/client';

export class PaymentReversalError extends Error {
    constructor(public readonly code: string, message: string, public readonly status = 409) { super(message); }
}
export const reversalError = (code: string, message: string, status = 409): never => { throw new PaymentReversalError(code, message, status); };
export const reversalKey = (value: unknown) => {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(value)) reversalError('PAYMENT_REVERSAL_KEY_REQUIRED', '冲销操作须保留稳定且有效的请求身份。', 400);
    return value as string;
};
export const reversalText = (value: unknown) => {
    if (typeof value !== 'string' || value.trim().length < 5 || value.length > 2000) reversalError('PAYMENT_REVERSAL_INVALID', '冲销原因或审批说明须为 5–2000 字符。', 400);
    return (value as string).trim();
};
export type ReversalRequestFacts = { reasonCategory: 'registration_error' | 'bank_return'; reason: string };
export type ReversalReviewFacts = { decision: 'approve' | 'reject'; note: string };
export function normalizeReversalRequest(input: Record<string, unknown>): ReversalRequestFacts {
    if (!['registration_error','bank_return'].includes(String(input.reasonCategory))) reversalError('PAYMENT_REVERSAL_INVALID', '冲销原因分类无效。', 400);
    return { reasonCategory: input.reasonCategory as ReversalRequestFacts['reasonCategory'], reason: reversalText(input.reason) };
}
export function normalizeReversalReview(input: Record<string, unknown>): ReversalReviewFacts {
    if (!['approve','reject'].includes(String(input.decision))) reversalError('PAYMENT_REVERSAL_INVALID', '审批决定无效。', 400);
    return { decision: input.decision as ReversalReviewFacts['decision'], note: reversalText(input.note) };
}
export const reversalHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function originalPaymentFacts(payment: PaymentRecord) {
    return { version: 'original-payment-facts/v1', id: payment.id, orderId: payment.orderId, amount: payment.amount,
        currency: payment.currency, exchangeRate: payment.exchangeRate, baseAmount: payment.baseAmount, method: payment.method,
        date: payment.date.toISOString(), payerName: payment.payerName, isProxy: payment.isProxy, note: payment.note,
        verifiedBy: payment.verifiedBy, milestoneId: payment.milestoneId, createdAt: payment.createdAt.toISOString() };
}
export function assertReversibleCash(payment: PaymentRecord & { barterSettlement?: unknown; barterOffsetPostings?: unknown[] }, orderCurrency: string) {
    if (payment.status !== 'verified') reversalError('PAYMENT_REVERSAL_INVALID_STATE', '只能申请冲销已核销且尚未冲销的原回款。');
    if (payment.currency !== 'CNY' || orderCurrency !== 'CNY' || payment.exchangeRate !== 1)
        reversalError('PAYMENT_REVERSAL_CURRENCY_UNSUPPORTED', '本冲销入口当前仅支持 CNY 原币全额回款，不作汇兑。');
    if (!['bank_transfer','cash','alipay','wechat','check','wire_transfer'].includes(payment.method)
        || payment.barterMetadata || payment.barterSettlement || payment.barterOffsetPostings?.length)
        reversalError('PAYMENT_REVERSAL_BARTER_OWNED', '货抵生成的回款必须通过原货抵流程冲回，不能重复现金冲销。');
    const amount = new Prisma.Decimal(String(payment.amount));
    if (!amount.greaterThan(0) || amount.decimalPlaces() > 2 || !Number.isSafeInteger(amount.times(100).toNumber()))
        reversalError('PAYMENT_REVERSAL_FACTS_INVALID', '原回款金额不可准确记账，须先核对历史凭证。');
}
