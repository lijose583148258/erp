import { loadRuntimeEnv } from '../config/runtime';
import os from 'os';

type PendingSpan = {
  traceId: string;
  spanId: string;
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Array<{ key: string; value: { stringValue?: string; intValue?: string } }>;
  status: { code: number };
  kind: number;
};

export type TelemetryStatus = {
  configured: boolean;
  enabled: boolean;
  serviceName: string;
  serviceInstanceId: string;
  exporter: 'otlp-http-json' | 'disabled';
  endpoint?: string;
  queued: number;
  exported: number;
  dropped: number;
  lastError?: string;
};

let endpoint = '';
let serviceName = 'ailaoda-erp-crm';
let serviceInstanceId = `${os.hostname()}:${process.env.PORT || process.pid}`;
let queue: PendingSpan[] = [];
let exported = 0;
let dropped = 0;
let lastError: string | undefined;
let flushPromise: Promise<void> | null = null;
let flushTimer: NodeJS.Timeout | null = null;

const normalizeTraceEndpoint = (value: string) => {
  const normalized = value.trim().replace(/\/$/, '');
  return normalized.endsWith('/v1/traces') ? normalized : `${normalized}/v1/traces`;
};

const flush = async () => {
  if (!endpoint || flushPromise || queue.length === 0) return flushPromise;
  const batch = queue.splice(0, Math.max(1, Number(process.env.OTEL_BATCH_MAX_SIZE || 100)));
  flushPromise = (async () => {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          resourceSpans: [{
            resource: { attributes: [
              { key: 'service.name', value: { stringValue: serviceName } },
              { key: 'service.instance.id', value: { stringValue: serviceInstanceId } },
            ] },
            scopeSpans: [{ scope: { name: 'ailaoda.http', version: '1.0' }, spans: batch }],
          }],
        }),
        signal: AbortSignal.timeout(Math.max(250, Number(process.env.OTEL_EXPORT_TIMEOUT_MS || 2000))),
      });
      if (!response.ok) throw new Error(`OTLP_HTTP_${response.status}`);
      await response.arrayBuffer();
      exported += batch.length;
      lastError = undefined;
    } catch (error) {
      dropped += batch.length;
      lastError = error instanceof Error ? error.message : String(error);
    }
  })().finally(() => {
    flushPromise = null;
    if (queue.length > 0) void flush();
  });
  return flushPromise;
};

export const startTelemetry = () => {
  loadRuntimeEnv();
  const configured = String(process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
    || process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    || '').trim();
  serviceName = String(process.env.OTEL_SERVICE_NAME || 'ailaoda-erp-crm').trim();
  serviceInstanceId = String(process.env.OTEL_SERVICE_INSTANCE_ID || `${os.hostname()}:${process.env.PORT || process.pid}`).trim();
  endpoint = configured ? normalizeTraceEndpoint(configured) : '';
  if (endpoint && !flushTimer) {
    flushTimer = setInterval(() => void flush(), Math.max(100, Number(process.env.OTEL_BATCH_FLUSH_INTERVAL_MS || 1000)));
    flushTimer.unref();
  }
  return getTelemetryStatus();
};

export const recordTelemetryHttpSpan = (input: {
  traceId: string;
  spanId: string;
  method: string;
  route: string;
  statusCode: number;
  startTimeUnixNano: bigint;
  endTimeUnixNano: bigint;
}) => {
  if (!endpoint) return;
  const maxQueueSize = Math.max(100, Number(process.env.OTEL_BATCH_MAX_QUEUE_SIZE || 5000));
  if (queue.length >= maxQueueSize) {
    dropped += 1;
    return;
  }
  queue.push({
    traceId: input.traceId,
    spanId: input.spanId,
    name: `${input.method} ${input.route}`,
    startTimeUnixNano: input.startTimeUnixNano.toString(),
    endTimeUnixNano: input.endTimeUnixNano.toString(),
    kind: 2,
    attributes: [
      { key: 'http.request.method', value: { stringValue: input.method } },
      { key: 'url.path', value: { stringValue: input.route } },
      { key: 'http.response.status_code', value: { intValue: String(input.statusCode) } },
    ],
    status: { code: input.statusCode >= 500 ? 2 : 1 },
  });
  if (queue.length >= Math.max(1, Number(process.env.OTEL_BATCH_MAX_SIZE || 100))) void flush();
};

export const getTelemetryStatus = (): TelemetryStatus => ({
  configured: Boolean(endpoint),
  enabled: Boolean(endpoint),
  serviceName,
  serviceInstanceId,
  exporter: endpoint ? 'otlp-http-json' : 'disabled',
  endpoint: endpoint || undefined,
  queued: queue.length,
  exported,
  dropped,
  lastError,
});

export const shutdownTelemetry = async () => {
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = null;
  await flush();
  if (flushPromise) await flushPromise;
  endpoint = '';
};

startTelemetry();
