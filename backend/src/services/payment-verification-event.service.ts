import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { parseWebhookEndpoints, type WebhookEndpoint, type WebhookEvent } from './webhook.service';

export type PaymentVerifiedEvent = WebhookEvent & { id: string; occurredAt: string; type: 'payment.verified' };
export const paymentVerificationEventKey = (paymentId: number) => `payment.verified:${paymentId}`;
export const webhookDestinationKey = (endpoint: WebhookEndpoint) =>
  crypto.createHash('sha256').update(new URL(endpoint.url).href).digest('hex');

export const paymentWebhookDestinations = (eventType: 'payment.verified' | 'payment.reversed' = 'payment.verified') => {
  const endpoints = parseWebhookEndpoints().filter(endpoint => !endpoint.events?.length || endpoint.events.includes(eventType));
  return new Map(endpoints.map(endpoint => [webhookDestinationKey(endpoint), endpoint]));
};

// Only call from the winning pending -> verified transaction, after ledger checks.
// No external effects here: an audit/outbox failure rolls the whole verification back.
export const recordPaymentVerifiedEventTx = async (
  tx: Prisma.TransactionClient,
  paymentId: number,
  verifiedBy: number,
) => {
  const payment = await tx.paymentRecord.findUniqueOrThrow({
    where: { id: paymentId },
    select: { id: true, orderId: true, amount: true, currency: true, status: true },
  });
  if (payment.status !== 'verified') throw new Error('PAYMENT_EVENT_REQUIRES_VERIFIED_PAYMENT');
  const eventKey = paymentVerificationEventKey(paymentId);
  const event: PaymentVerifiedEvent = {
    id: crypto.randomUUID(), type: 'payment.verified', resourceType: 'payment', resourceId: payment.id,
    occurredAt: new Date().toISOString(),
    data: { orderId: payment.orderId, paymentId: payment.id, amount: payment.amount, currency: payment.currency, verifiedBy },
  };
  const audit = await tx.auditLog.create({ data: {
    userId: verifiedBy, action: 'PAYMENT_VERIFIED', resource: 'payment', resourceId: payment.id,
    details: JSON.stringify({ eventId: event.id, eventKey, ...event.data }),
  } });
  event.data.auditId = audit.id;
  return tx.businessEvent.create({ data: {
    eventKey, eventType: event.type, aggregateType: 'payment', aggregateId: String(payment.id),
    payloadJson: JSON.stringify(event), createdAt: new Date(event.occurredAt),
    deliveries: { create: [
      { channel: 'realtime', destinationKey: 'finance-notifications' },
      ...Array.from(paymentWebhookDestinations().keys(), destinationKey => ({ channel: 'webhook', destinationKey })),
    ] },
  } });
};
