import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import type { WebhookEvent } from './webhook.service';
import { paymentWebhookDestinations } from './payment-verification-event.service';
import { validateReversalEffect } from './payment-reversal-receipts';

export type PaymentReversedEvent = WebhookEvent & { id: string; occurredAt: string; type: 'payment.reversed' };
export const paymentReversalEventKey = (paymentId: number) => `payment.reversed:${paymentId}`;

// Called in the SAME winning reversal transaction after ledger/milestone checks.
// Reuses its immutable audit, creates no second audit and never sends network I/O.
export async function recordPaymentReversedEventTx(tx: Prisma.TransactionClient, reversalId: string) {
    const effect = await tx.paymentReversal.findUniqueOrThrow({ where: { id: reversalId }, include: { payment: true, request: true } });
    const receipt = validateReversalEffect(effect.request, effect);
    const audit = await tx.auditLog.findUniqueOrThrow({ where: { id: effect.auditId } });
    let details: Record<string, unknown> | null = null;
    try {
        const parsed = JSON.parse(audit.details || 'null');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) details = parsed;
    } catch { /* Invalid stored audit must fail before any event is written. */ }
    if (effect.payment.status !== 'reversed' || effect.payment.id !== effect.paymentId || effect.payment.orderId !== receipt.orderId
        || audit.id !== effect.auditId || audit.action !== 'PAYMENT_REVERSED' || audit.userId !== effect.postedBy
        || audit.resource !== 'payment' || audit.resourceId !== effect.paymentId || !details
        || details.requestId !== effect.requestId || details.reversalId !== effect.id || details.orderId !== receipt.orderId
        || details.requestedBy !== effect.request.requestedBy || details.reviewedBy !== effect.postedBy || details.decision !== 'approve'
        || details.note !== effect.request.reviewNote || details.amount !== effect.amount || details.currency !== effect.currency
        || details.beforePaidAmount !== receipt.beforePaidAmount || details.afterPaidAmount !== receipt.afterPaidAmount)
        throw new Error('PAYMENT_EVENT_REQUIRES_POSTED_REVERSAL');
    const event: PaymentReversedEvent = { id: crypto.randomUUID(), type: 'payment.reversed', resourceType: 'payment', resourceId: effect.paymentId,
        occurredAt: effect.createdAt.toISOString(), data: { paymentId: effect.paymentId, orderId: receipt.orderId,
            reversalId: effect.id, requestId: effect.requestId, amount: effect.amount, currency: effect.currency,
            requestedBy: effect.request.requestedBy, reviewedBy: effect.postedBy, auditId: effect.auditId,
            beforePaidAmount: receipt.beforePaidAmount, afterPaidAmount: receipt.afterPaidAmount } };
    return tx.businessEvent.create({ data: { eventKey: paymentReversalEventKey(effect.paymentId), eventType: event.type,
        aggregateType: 'payment', aggregateId: String(effect.paymentId), payloadJson: JSON.stringify(event), createdAt: effect.createdAt,
        deliveries: { create: [ { channel: 'realtime', destinationKey: 'finance-notifications' },
            ...Array.from(paymentWebhookDestinations(event.type).keys(), destinationKey => ({ channel: 'webhook', destinationKey })) ] } } });
}
