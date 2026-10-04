import type { PaymentReversal, PaymentReversalRequest } from '@prisma/client';
import { readReversalRequestReceipt, readReversalReviewReceipt, validateReversalEffect,
    requestReversalFingerprint, reviewReversalFingerprint } from './payment-reversal-receipts';
import { assertReversibleCash, normalizeReversalRequest, normalizeReversalReview, originalPaymentFacts, reversalKey } from './payment-reversal-facts';

const instant = new Date('2026-10-03T12:00:00.000Z');
const original = { version: 'original-payment-facts/v1', id: 7, orderId: 9, amount: 300, currency: 'CNY', exchangeRate: 1 };
const requestFacts = { reasonCategory: 'registration_error' as const, reason: 'Original registration was incorrect' };
function fixture(amount = 300) {
    const r = { id: 'request-id', requestKey: 'request-key', paymentId: 7, requestedBy: 1, ...requestFacts,
        originalPaymentJson: JSON.stringify({ ...original, amount }), requestAuditId: 12, originalAuditId: 11, createdAt: instant,
        activePaymentId: null, status: 'posted', reviewKey: 'review-key', reviewedBy: 2, reviewAuditId: 13, reviewedAt: instant,
        reviewNote: 'Independently checked original evidence', reviewReceiptJson: null } as unknown as PaymentReversalRequest;
    r.fingerprint = requestReversalFingerprint(7, 1, requestFacts, r.originalPaymentJson);
    r.requestReceiptJson = JSON.stringify({ version: 'payment-reversal-request/v1', requestId: r.id, requestKey: r.requestKey,
        paymentId: 7, orderId: 9, requestedBy: 1, amount, currency: 'CNY', status: 'pending', auditId: 12,
        requestedAt: instant.toISOString(), ...requestFacts });
    r.reviewFingerprint = reviewReversalFingerprint(r.id, 2, { decision: 'approve', note: r.reviewNote! });
    const review = { version: 'payment-reversal-review/v1', requestId: r.id, reviewKey: r.reviewKey, paymentId: 7, orderId: 9,
        reversalId: 'effect-id', status: 'posted', requestedBy: 1, reviewedBy: 2, amount: -amount, currency: 'CNY', auditId: 13,
        reviewedAt: instant.toISOString(), beforePaidAmount: amount, afterPaidAmount: 0 };
    r.reviewReceiptJson = JSON.stringify(review);
    const effect = { id: 'effect-id', requestId: r.id, paymentId: 7, postedBy: 2, auditId: 13, amount: -amount, currency: 'CNY',
        receiptJson: r.reviewReceiptJson, createdAt: instant,
        beforeStateJson: JSON.stringify({ orderId: 9, paidAmount: amount, paymentStatus: 'partial' }),
        afterStateJson: JSON.stringify({ orderId: 9, paidAmount: 0, paymentStatus: 'unpaid' }) } as PaymentReversal;
    return { r, effect, review };
}
const changeJson = (json: string, overrides: object) => JSON.stringify({ ...JSON.parse(json), ...overrides });

test('original pending request and terminal full effect receipts remain immutable acknowledgments', () => {
    const { r, effect, review } = fixture();
    expect(readReversalRequestReceipt(r).status).toBe('pending');
    expect(readReversalReviewReceipt(r)).toEqual(review);
    expect(validateReversalEffect(r, effect)).toEqual(review);
});
test.each([0.29, 1.1, 10.01, 300])('valid decimal cents %p are not rejected by binary floating point', amount => {
    const { r, effect } = fixture(amount);
    expect(validateReversalEffect(r, effect).amount).toBe(-amount);
});
test.each([{ amount: 301 }, { currency: 'USD' }, { orderId: 10 }, { requestedBy: 2 }, { paymentId: 8 }, { auditId: 13 },
    { status: 'posted' }, { reason: 'changed facts' }, { reasonCategory: 'bank_return' }, { requestedAt: '2026-10-04T12:00:00.000Z' }])('request receipt corruption %p fails closed', override => {
    const { r } = fixture(); r.requestReceiptJson = changeJson(r.requestReceiptJson, override);
    expect(() => readReversalRequestReceipt(r)).toThrow();
});
test.each([{ amount: -299 }, { orderId: 10 }, { requestedBy: 2 }, { reviewedBy: 1 }, { reviewKey: 'different-key' },
    { afterPaidAmount: 1 }, { beforePaidAmount: 301 }, { currency: 'USD' }, { auditId: -1 }, { reversalId: null },
    { reviewedAt: '2026-10-04T12:00:00.000Z' }, { status: 'pending' }, { afterPaidAmount: 0.001 }])('review receipt corruption %p fails closed', override => {
    const { r } = fixture(); r.reviewReceiptJson = changeJson(r.reviewReceiptJson!, override);
    expect(() => readReversalReviewReceipt(r)).toThrow();
});
test.each([null, { id: 'other-effect' }, { amount: -299 }, { postedBy: 3 }, { auditId: 14 }, { paymentId: 8 },
    { requestId: 'other-request' }, { receiptJson: '{}' }, { afterStateJson: '{"orderId":9,"paidAmount":1,"paymentStatus":"unpaid"}' }])('effect must bind every immutable receipt fact %p', override => {
    const { r, effect } = fixture();
    expect(() => validateReversalEffect(r, override === null ? null : { ...effect, ...override })).toThrow();
});
test('request or review fingerprint corruption cannot acquire a valid receipt', () => {
    const { r } = fixture();
    expect(() => readReversalRequestReceipt({ ...r, fingerprint: 'a'.repeat(64) })).toThrow();
    expect(() => readReversalReviewReceipt({ ...r, reviewFingerprint: 'a'.repeat(64) })).toThrow();
});
test('rejection has zero amount and no final effect; an invented effect fails closed', () => {
    const { r, effect } = fixture(); r.status = 'rejected';
    r.reviewFingerprint = reviewReversalFingerprint(r.id, 2, { decision: 'reject', note: r.reviewNote! });
    r.reviewReceiptJson = changeJson(r.reviewReceiptJson!, { status: 'rejected', amount: 0, reversalId: null, afterPaidAmount: 300 });
    expect(validateReversalEffect(r, null).amount).toBe(0);
    expect(() => validateReversalEffect(r, effect)).toThrow();
});
test.each([null, '[]', 'null', '{', '{}'])('malformed persistent JSON %p cannot be acknowledged', json => {
    const { r } = fixture();
    expect(() => readReversalRequestReceipt({ ...r, requestReceiptJson: json as string })).toThrow();
    expect(() => readReversalReviewReceipt({ ...r, reviewReceiptJson: json })).toThrow();
});
test.each([undefined, '', 'short', 'bad/request-key', ' key-with-space', 'x'.repeat(101)])('request identity %p is required and stable', value => {
    expect(() => reversalKey(value)).toThrow();
});
test('strict fact normalization and reason classification', () => {
    expect(normalizeReversalRequest({ ...requestFacts, reason: '  valid reason  ' }).reason).toBe('valid reason');
    expect(normalizeReversalReview({ decision: 'reject', note: ' valid review ' }).note).toBe('valid review');
    for (const value of [{ ...requestFacts, reason: '' }, { ...requestFacts, reason: 'x'.repeat(2001) }, { ...requestFacts, reasonCategory: 'refund' }])
        expect(() => normalizeReversalRequest(value)).toThrow();
    expect(() => normalizeReversalReview({ decision: 'reopen', note: 'valid note' })).toThrow();
});
test('original facts exclude lifecycle metadata, not financial history', () => {
    const p = { ...original, date: instant, createdAt: instant, updatedAt: instant, status: 'verified', verifiedBy: 3 } as any;
    expect(originalPaymentFacts(p)).toEqual(originalPaymentFacts({ ...p, status: 'reversed', updatedAt: new Date() }));
    expect(originalPaymentFacts(p)).not.toEqual(originalPaymentFacts({ ...p, verifiedBy: 4 }));
});
test.each([{ status: 'pending' }, { status: 'reversed' }, { currency: 'USD' }, { exchangeRate: 2 }, { amount: 0 },
    { amount: 0.001 }, { method: 'barter' }, { barterMetadata: '{}' }, { barterSettlement: {} }, { barterOffsetPostings: [{}] }])('cash boundary rejects %p', override => {
    expect(() => assertReversibleCash({ ...original, status: 'verified', method: 'bank_transfer', ...override } as any, 'CNY')).toThrow();
});
