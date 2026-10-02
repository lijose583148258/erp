import crypto from 'crypto';
import type { PrismaClient } from '@prisma/client';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { deliverDurableWebhook } from './webhook.service';
import { paymentWebhookDestinations, type PaymentVerifiedEvent } from './payment-verification-event.service';
import { publishDurableRealtimeNotification } from './realtime-notification.service';

type DeliveryResult = { ok: true } | { ok: false; errorCode: string };
type DeliveryTarget = { channel: string; destinationKey: string };
type OutboxDb = Pick<PrismaClient, 'businessEventDelivery'>;
type OutboxOptions = {
  db?: OutboxDb;
  now?: () => Date;
  send?: (target: DeliveryTarget, event: PaymentVerifiedEvent) => Promise<DeliveryResult>;
  shouldStop?: () => boolean;
};
export const PAYMENT_EVENT_LEASE_MS = 30_000;
export const paymentEventRetryDelay = (attempt: number) => Math.min(300_000, 1_000 * 2 ** Math.min(9, Math.max(0, attempt - 1)));

const sendPaymentEvent = async (target: DeliveryTarget, event: PaymentVerifiedEvent): Promise<DeliveryResult> => {
  if (target.channel === 'webhook') {
    const endpoint = paymentWebhookDestinations().get(target.destinationKey);
    if (!endpoint) return { ok: false, errorCode: 'DESTINATION_NOT_CONFIGURED' };
    return deliverDurableWebhook(endpoint, event);
  }
  if (target.channel !== 'realtime' || target.destinationKey !== 'finance-notifications') {
    return { ok: false, errorCode: 'UNKNOWN_DESTINATION' };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      publishDurableRealtimeNotification({
        id: event.id, occurredAt: event.occurredAt, type: 'payment.verified', title: 'Payment verified',
        message: `订单 ${event.data.orderId} 回款已核销`, resourceType: 'payment', resourceId: event.resourceId,
        severity: 'success', audience: { roles: ['admin', 'manager', 'finance'] },
      }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('REALTIME_TIMEOUT')), 5_000); }),
    ]);
    return { ok: true };
  } catch {
    return { ok: false, errorCode: 'REALTIME_UNAVAILABLE' };
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const parseEvent = (payload: string | null): PaymentVerifiedEvent => {
  const event = JSON.parse(payload || 'null') as PaymentVerifiedEvent | null;
  if (!event || typeof event.id !== 'string' || !event.id || event.type !== 'payment.verified' ||
      typeof event.occurredAt !== 'string' || !Number.isFinite(Date.parse(event.occurredAt)) ||
      event.resourceType !== 'payment' || !event.data || typeof event.data !== 'object') {
    throw new Error('INVALID_EVENT_PAYLOAD');
  }
  return event;
};

// No transaction spans network I/O. Atomic claims serialize independent workers;
// an expired lease is recovered without creating a new logical event.
export const drainPaymentEventOutbox = async (options: OutboxOptions = {}) => {
  const db = options.db || prisma;
  const now = options.now || (() => new Date());
  const send = options.send || sendPaymentEvent;
  const eligible = (at: Date) => ({ OR: [
    { status: 'pending', nextAttemptAt: { lte: at } },
    { status: 'sending', leaseExpiresAt: { lte: at } },
  ] });
  const candidates = await db.businessEventDelivery.findMany({
    where: { ...eligible(now()), event: { eventType: 'payment.verified', eventKey: { not: null } } },
    orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }], take: 10,
    include: { event: true },
  });
  const result = { claimed: 0, delivered: 0, deferred: 0, leaseLost: 0 };
  for (const candidate of candidates) {
    if (options.shouldStop?.()) break;
    const at = now();
    const leaseToken = crypto.randomUUID();
    const claim = await db.businessEventDelivery.updateMany({
      where: { id: candidate.id, ...eligible(at) },
      data: { status: 'sending', leaseToken, leaseExpiresAt: new Date(at.getTime() + PAYMENT_EVENT_LEASE_MS), attempts: { increment: 1 } },
    });
    if (claim.count !== 1) continue;
    result.claimed += 1;
    let outcome: DeliveryResult;
    try {
      outcome = await send(candidate, parseEvent(candidate.event.payloadJson));
    } catch {
      outcome = { ok: false, errorCode: 'DELIVERY_ERROR' };
    }
    // Stale workers cannot overwrite a newer receipt. DB failure here leaves
    // 'sending': recovery retries the SAME id (at-least-once transport).
    const finish = await db.businessEventDelivery.updateMany({
      where: { id: candidate.id, status: 'sending', leaseToken },
      data: outcome.ok
        ? { status: 'delivered', deliveredAt: now(), leaseToken: null, leaseExpiresAt: null, lastErrorCode: null }
        : { status: 'pending', leaseToken: null, leaseExpiresAt: null,
          nextAttemptAt: new Date(now().getTime() + paymentEventRetryDelay(candidate.attempts + 1)),
          lastErrorCode: /^[A-Z0-9_]{1,64}$/.test(outcome.errorCode) ? outcome.errorCode : 'DELIVERY_ERROR' },
    });
    if (finish.count !== 1) result.leaseLost += 1;
    else if (outcome.ok) result.delivered += 1;
    else result.deferred += 1;
  }
  return result;
};

let timer: ReturnType<typeof setInterval> | undefined;
let inFlight: Promise<unknown> | undefined;
let stopped = true;
export const startPaymentEventOutbox = () => {
  if (timer) return;
  stopped = false;
  const tick = () => {
    if (stopped || inFlight) return;
    inFlight = drainPaymentEventOutbox({ shouldStop: () => stopped })
      .catch(() => logger.warn('Payment event outbox unavailable; durable rows retained for retry'))
      .finally(() => { inFlight = undefined; });
  };
  timer = setInterval(tick, 2_000);
  timer.unref();
  tick();
};
export const stopPaymentEventOutbox = async () => {
  stopped = true;
  if (timer) clearInterval(timer);
  timer = undefined;
  await inFlight;
};
