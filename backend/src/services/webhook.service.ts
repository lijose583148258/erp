import crypto from 'crypto';
import { logger } from '../utils/logger';

export type WebhookEventType =
  | 'order.created'
  | 'order.updated'
  | 'order.status_changed'
  | 'order.completed'
  | 'payment.submitted'
  | 'payment.verified';

export type WebhookEvent = {
  id?: string;
  type: WebhookEventType;
  resourceType: 'order' | 'payment';
  resourceId: string | number;
  occurredAt?: string;
  data: Record<string, unknown>;
};

export type WebhookEndpoint = {
  url: string;
  secret?: string;
  events?: WebhookEventType[];
};

const DEFAULT_TIMEOUT_MS = 5000;

const readTimeoutMs = () => {
  const value = Number(process.env.AILAODA_WEBHOOK_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
};

const normalizeEndpoint = (value: unknown): WebhookEndpoint | null => {
  if (typeof value === 'string') {
    return { url: value };
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.url !== 'string') return null;
  return {
    url: record.url,
    secret: typeof record.secret === 'string' ? record.secret : undefined,
    events: Array.isArray(record.events)
      ? record.events.filter((event): event is WebhookEventType => typeof event === 'string')
      : undefined,
  };
};

const isSafeWebhookUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
};

export const parseWebhookEndpoints = (raw = process.env.AILAODA_WEBHOOK_ENDPOINTS || ''): WebhookEndpoint[] => {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  let values: unknown[];
  try {
    const parsed = JSON.parse(trimmed);
    values = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    values = trimmed.split(/[,\n;]/).map((item) => item.trim()).filter(Boolean);
  }

  return values
    .map(normalizeEndpoint)
    .filter((endpoint): endpoint is WebhookEndpoint => Boolean(endpoint && isSafeWebhookUrl(endpoint.url)));
};

export const buildWebhookSignature = (secret: string, timestamp: string, body: string) =>
  crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

const shouldSendEvent = (endpoint: WebhookEndpoint, event: WebhookEvent) =>
  !endpoint.events?.length || endpoint.events.includes(event.type);

const deliverWebhook = async (endpoint: WebhookEndpoint, event: WebhookEvent) => {
  const secret = endpoint.secret || process.env.AILAODA_WEBHOOK_SECRET || '';
  const timestamp = new Date().toISOString();
  const body = JSON.stringify({
    ...event,
    id: event.id || crypto.randomUUID(),
    occurredAt: event.occurredAt || timestamp,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), readTimeoutMs());

  try {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-ailaoda-event': event.type,
      'x-ailaoda-timestamp': timestamp,
    };
    if (secret) {
      headers['x-ailaoda-signature'] = `sha256=${buildWebhookSignature(secret, timestamp, body)}`;
    }

    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      logger.warn('Webhook delivery returned non-2xx status', {
        url: endpoint.url,
        eventType: event.type,
        status: response.status,
      });
    }
  } catch (error) {
    logger.warn('Webhook delivery failed', {
      url: endpoint.url,
      eventType: event.type,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timer);
  }
};

export const publishWebhookEvent = (event: WebhookEvent): number => {
  const endpoints = parseWebhookEndpoints().filter((endpoint) => shouldSendEvent(endpoint, event));
  for (const endpoint of endpoints) {
    void deliverWebhook(endpoint, event);
  }
  return endpoints.length;
};
