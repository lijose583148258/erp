import { Prisma, type PaymentReversal, type PaymentReversalRequest } from '@prisma/client';
import { compareMoney, subtractMoney } from '../utils/money';
import { reversalError, reversalHash, type ReversalRequestFacts, type ReversalReviewFacts } from './payment-reversal-facts';

export const requestReversalFingerprint = (paymentId: number, userId: number, facts: ReversalRequestFacts, original: string) =>
    reversalHash({ version: 'payment-reversal-request-facts/v1', paymentId, userId, ...facts, original });
export const reviewReversalFingerprint = (requestId: string, userId: number, facts: ReversalReviewFacts) =>
    reversalHash({ version: 'payment-reversal-review-facts/v1', requestId, userId, ...facts });

const invalid = (): never => reversalError('PAYMENT_REVERSAL_RECEIPT_INVALID', '冲销回执、原凭证或抵消分录不一致，请核对原记录，不能重做入账。');
const object = (json: string | null, version?: string): Record<string, unknown> => {
    try {
        const r = JSON.parse(json || '');
        if (!r || typeof r !== 'object' || Array.isArray(r) || (version && r.version !== version)) return invalid();
        return r;
    } catch { return invalid(); }
};
const id = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const money = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0
    && new Prisma.Decimal(String(v)).decimalPlaces() <= 2 && Number.isSafeInteger(new Prisma.Decimal(String(v)).times(100).toNumber());
const at = (v: unknown, date: Date | null) => typeof v === 'string' && !!date && v === date.toISOString();

export function readReversalRequestReceipt(r: PaymentReversalRequest) {
    const original = object(r.originalPaymentJson, 'original-payment-facts/v1');
    const receipt = object(r.requestReceiptJson, 'payment-reversal-request/v1');
    if (original.id !== r.paymentId || !id(original.orderId) || !money(original.amount) || Number(original.amount) <= 0
        || original.currency !== 'CNY' || original.exchangeRate !== 1 || !id(r.requestedBy) || !id(r.requestAuditId)
        || r.fingerprint !== requestReversalFingerprint(r.paymentId, r.requestedBy,
            { reasonCategory: r.reasonCategory as ReversalRequestFacts['reasonCategory'], reason: r.reason }, r.originalPaymentJson)
        || receipt.requestId !== r.id || receipt.requestKey !== r.requestKey || receipt.paymentId !== r.paymentId
        || receipt.orderId !== original.orderId || receipt.requestedBy !== r.requestedBy || receipt.amount !== original.amount
        || receipt.currency !== original.currency || receipt.reasonCategory !== r.reasonCategory || receipt.reason !== r.reason
        || receipt.auditId !== r.requestAuditId || receipt.status !== 'pending' || !at(receipt.requestedAt, r.createdAt)) return invalid();
    return receipt;
}

export function readReversalReviewReceipt(r: PaymentReversalRequest) {
    const request = readReversalRequestReceipt(r);
    const receipt = object(r.reviewReceiptJson, 'payment-reversal-review/v1');
    const posted = r.status === 'posted';
    if (!['posted', 'rejected'].includes(r.status) || !id(r.reviewedBy) || r.reviewedBy === r.requestedBy || !id(r.reviewAuditId)
        || r.activePaymentId !== null || !r.reviewKey || !r.reviewNote
        || r.reviewFingerprint !== reviewReversalFingerprint(r.id, r.reviewedBy!, { decision: posted ? 'approve' : 'reject', note: r.reviewNote! })
        || receipt.requestId !== r.id || receipt.paymentId !== r.paymentId || receipt.orderId !== request.orderId
        || receipt.requestedBy !== r.requestedBy || receipt.reviewedBy !== r.reviewedBy || receipt.reviewKey !== r.reviewKey
        || receipt.auditId !== r.reviewAuditId || receipt.status !== r.status || receipt.currency !== request.currency
        || !at(receipt.reviewedAt, r.reviewedAt) || !money(receipt.beforePaidAmount) || !money(receipt.afterPaidAmount)
        || receipt.amount !== (posted ? -Number(request.amount) : 0)
        || (posted ? typeof receipt.reversalId !== 'string' || !receipt.reversalId : receipt.reversalId !== null)
        || compareMoney(subtractMoney(Number(receipt.beforePaidAmount), posted ? Number(request.amount) : 0), Number(receipt.afterPaidAmount)) !== 0) return invalid();
    return receipt;
}

// Current order totals may change later. Validate the ORIGINAL effect snapshots,
// never recompute a historic acknowledgment from today's balance.
export function validateReversalEffect(r: PaymentReversalRequest, effect: PaymentReversal | null) {
    const receipt = readReversalReviewReceipt(r);
    if (r.status === 'rejected') {
        if (effect) return invalid();
        return receipt;
    }
    if (!effect || effect.id !== receipt.reversalId || effect.paymentId !== r.paymentId || effect.requestId !== r.id
        || effect.postedBy !== r.reviewedBy || effect.auditId !== r.reviewAuditId || effect.amount !== receipt.amount
        || effect.currency !== receipt.currency || effect.receiptJson !== r.reviewReceiptJson || !at(receipt.reviewedAt, effect.createdAt)) return invalid();
    const before = object(effect.beforeStateJson), after = object(effect.afterStateJson);
    if (before.orderId !== receipt.orderId || after.orderId !== receipt.orderId
        || before.paidAmount !== receipt.beforePaidAmount || after.paidAmount !== receipt.afterPaidAmount
        || !['unpaid', 'partial', 'paid'].includes(String(before.paymentStatus)) || !['unpaid', 'partial', 'paid'].includes(String(after.paymentStatus))) return invalid();
    return receipt;
}
