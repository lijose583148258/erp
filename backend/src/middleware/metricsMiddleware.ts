import { NextFunction, Request, Response } from 'express';
import { getTraceContext } from './traceContext';
import { getTelemetryStatus, recordTelemetryHttpSpan } from '../observability/instrumentation';

type RouteMetric = {
  count: number;
  errorCount: number;
  totalDurationMs: number;
  maxDurationMs: number;
};

type RumVitalMetric = {
  count: number;
  totalValue: number;
  maxValue: number;
};

type RumVitalInput = {
  name: string;
  value: number;
  rating: string;
  path?: string;
};

type CacheMetricAction = 'hit' | 'miss' | 'set' | 'delete' | 'error' | 'deserialize_error';
type SearchMetricAction = 'fallback' | 'external' | 'empty' | 'invalid' | 'index' | 'index_error' | 'reindex';
export type AIMetricAction = 'external_success' | 'fallback_disabled' | 'fallback_unconfigured' | 'fallback_provider_error' | 'fallback_budget_unconfigured' | 'fallback_budget_store_unavailable' | 'fallback_budget_exhausted' | 'fallback_circuit_open' | 'refused_sensitive' | 'rate_limited';

const startedAt = new Date();
const routeMetrics = new Map<string, RouteMetric>();
const rumVitalMetrics = new Map<string, RumVitalMetric>();
const cacheMetrics = new Map<string, number>();
const searchMetrics = new Map<string, number>();
const aiMetrics = new Map<string, { count: number; totalDurationMs: number; maxDurationMs: number }>();
const allowedRumVitalNames = new Set(['CLS', 'FCP', 'FID', 'INP', 'LCP', 'TTFB', 'LOAD', 'DCL']);
const allowedRumVitalRatings = new Set(['good', 'needs-improvement', 'poor', 'unknown']);

const normalizePath = (path: string) =>
  path
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .replace(/[0-9a-f]{8,}(?=\/|$)/gi, ':token');

const normalizeRumPath = (path: unknown) => {
  if (typeof path !== 'string' || path.length === 0) return '/';
  const withoutQuery = path.split('?')[0].split('#')[0];
  const pathname = withoutQuery.startsWith('/') ? withoutQuery : '/';
  return normalizePath(pathname).replace(/[|\r\n"]/g, '_').slice(0, 120);
};

const escapeLabelValue = (value: string) =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/"/g, '\\"');

export const recordRumVital = (input: RumVitalInput) => {
  if (!allowedRumVitalNames.has(input.name)) return false;
  if (!allowedRumVitalRatings.has(input.rating)) return false;
  if (!Number.isFinite(input.value) || input.value < 0 || input.value > 120_000) return false;

  const path = normalizeRumPath(input.path);
  const key = `${input.name}|${input.rating}|${path}`;
  const current = rumVitalMetrics.get(key) || {
    count: 0,
    totalValue: 0,
    maxValue: 0,
  };
  current.count += 1;
  current.totalValue += input.value;
  current.maxValue = Math.max(current.maxValue, input.value);
  rumVitalMetrics.set(key, current);
  return true;
};

export const recordCacheMetric = (action: CacheMetricAction, key: string) => {
  const namespace = String(key || 'unknown').split(':')[0].replace(/[^\w.-]+/g, '_').slice(0, 60) || 'unknown';
  const metricKey = `${action}|${namespace}`;
  cacheMetrics.set(metricKey, (cacheMetrics.get(metricKey) || 0) + 1);
};

export const recordSearchMetric = (action: SearchMetricAction, index: string) => {
  const normalizedIndex = String(index || 'unknown').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'unknown';
  const metricKey = `${action}|${normalizedIndex}`;
  searchMetrics.set(metricKey, (searchMetrics.get(metricKey) || 0) + 1);
};

export const recordAIMetric = (action: AIMetricAction, durationMs = 0) => {
  const current = aiMetrics.get(action) || { count: 0, totalDurationMs: 0, maxDurationMs: 0 };
  const boundedDuration = Number.isFinite(durationMs) ? Math.max(0, Math.min(durationMs, 120_000)) : 0;
  current.count += 1;
  current.totalDurationMs += boundedDuration;
  current.maxDurationMs = Math.max(current.maxDurationMs, boundedDuration);
  aiMetrics.set(action, current);
};

export const metricsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const start = process.hrtime.bigint();
  const startTimeUnixNano = BigInt(Date.now()) * 1_000_000n;
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const key = `${req.method} ${normalizePath(req.path)}`;
    const current = routeMetrics.get(key) || {
      count: 0,
      errorCount: 0,
      totalDurationMs: 0,
      maxDurationMs: 0,
    };
    current.count += 1;
    current.totalDurationMs += durationMs;
    current.maxDurationMs = Math.max(current.maxDurationMs, durationMs);
    if (res.statusCode >= 500) current.errorCount += 1;
    routeMetrics.set(key, current);
    const traceContext = getTraceContext(req);
    if (traceContext) {
      recordTelemetryHttpSpan({
        traceId: traceContext.traceId,
        spanId: traceContext.spanId,
        method: req.method,
        route: normalizePath(req.path),
        statusCode: res.statusCode,
        startTimeUnixNano,
        endTimeUnixNano: BigInt(Date.now()) * 1_000_000n,
      });
    }
  });
  next();
};

export const renderPrometheusMetrics = () => {
  const memory = process.memoryUsage();
  const telemetry = getTelemetryStatus();
  const lines = [
    '# HELP ailaoda_process_uptime_seconds Process uptime in seconds.',
    '# TYPE ailaoda_process_uptime_seconds gauge',
    `ailaoda_process_uptime_seconds ${Math.round(process.uptime())}`,
    '# HELP ailaoda_process_started_at_seconds Process start timestamp.',
    '# TYPE ailaoda_process_started_at_seconds gauge',
    `ailaoda_process_started_at_seconds ${Math.floor(startedAt.getTime() / 1000)}`,
    '# HELP ailaoda_process_resident_memory_bytes Resident set size in bytes.',
    '# TYPE ailaoda_process_resident_memory_bytes gauge',
    `ailaoda_process_resident_memory_bytes ${memory.rss}`,
    '# HELP ailaoda_process_heap_used_bytes V8 heap used in bytes.',
    '# TYPE ailaoda_process_heap_used_bytes gauge',
    `ailaoda_process_heap_used_bytes ${memory.heapUsed}`,
    '# HELP ailaoda_process_heap_total_bytes V8 total heap allocation in bytes.',
    '# TYPE ailaoda_process_heap_total_bytes gauge',
    `ailaoda_process_heap_total_bytes ${memory.heapTotal}`,
    '# HELP ailaoda_telemetry_configured Whether OTLP trace export is configured.',
    '# TYPE ailaoda_telemetry_configured gauge',
    `ailaoda_telemetry_configured ${telemetry.configured ? 1 : 0}`,
    '# HELP ailaoda_telemetry_queue_size Number of spans waiting for export.',
    '# TYPE ailaoda_telemetry_queue_size gauge',
    `ailaoda_telemetry_queue_size ${telemetry.queued}`,
    '# HELP ailaoda_telemetry_spans_exported_total Spans exported by this process.',
    '# TYPE ailaoda_telemetry_spans_exported_total counter',
    `ailaoda_telemetry_spans_exported_total ${telemetry.exported}`,
    '# HELP ailaoda_telemetry_spans_dropped_total Spans dropped after queue or exporter failure.',
    '# TYPE ailaoda_telemetry_spans_dropped_total counter',
    `ailaoda_telemetry_spans_dropped_total ${telemetry.dropped}`,
    '# HELP ailaoda_http_requests_total HTTP request count by route.',
    '# TYPE ailaoda_http_requests_total counter',
    '# HELP ailaoda_http_errors_total HTTP 5xx response count by route.',
    '# TYPE ailaoda_http_errors_total counter',
    '# HELP ailaoda_http_request_duration_ms_sum Cumulative HTTP request duration by route.',
    '# TYPE ailaoda_http_request_duration_ms_sum counter',
    '# HELP ailaoda_http_request_duration_ms_max Maximum observed HTTP request duration by route.',
    '# TYPE ailaoda_http_request_duration_ms_max gauge',
  ];

  for (const [route, metric] of routeMetrics.entries()) {
    const [method, ...pathParts] = route.split(' ');
    const routePath = pathParts.join(' ');
    const labels = `method="${escapeLabelValue(method)}",route="${escapeLabelValue(routePath)}"`;
    lines.push(`ailaoda_http_requests_total{${labels}} ${metric.count}`);
    lines.push(`ailaoda_http_errors_total{${labels}} ${metric.errorCount}`);
    lines.push(`ailaoda_http_request_duration_ms_sum{${labels}} ${metric.totalDurationMs.toFixed(3)}`);
    lines.push(`ailaoda_http_request_duration_ms_max{${labels}} ${metric.maxDurationMs.toFixed(3)}`);
  }

  lines.push('# HELP ailaoda_browser_web_vitals_total Browser Web Vitals count by metric, rating, and path.');
  lines.push('# TYPE ailaoda_browser_web_vitals_total counter');
  for (const [key, metric] of rumVitalMetrics.entries()) {
    const [name, rating, path] = key.split('|');
    const labels = `metric="${escapeLabelValue(name)}",rating="${escapeLabelValue(rating)}",path="${escapeLabelValue(path)}"`;
    lines.push(`ailaoda_browser_web_vitals_total{${labels}} ${metric.count}`);
    lines.push(`ailaoda_browser_web_vitals_value_sum{${labels}} ${metric.totalValue.toFixed(3)}`);
    lines.push(`ailaoda_browser_web_vitals_value_max{${labels}} ${metric.maxValue.toFixed(3)}`);
  }

  lines.push('# HELP ailaoda_cache_operations_total Cache operation count by action and namespace.');
  lines.push('# TYPE ailaoda_cache_operations_total counter');
  for (const [key, count] of cacheMetrics.entries()) {
    const [action, namespace] = key.split('|');
    const labels = `action="${escapeLabelValue(action)}",namespace="${escapeLabelValue(namespace)}"`;
    lines.push(`ailaoda_cache_operations_total{${labels}} ${count}`);
  }

  lines.push('# HELP ailaoda_search_operations_total Search operation count by action and index.');
  lines.push('# TYPE ailaoda_search_operations_total counter');
  for (const [key, count] of searchMetrics.entries()) {
    const [action, index] = key.split('|');
    const labels = `action="${escapeLabelValue(action)}",index="${escapeLabelValue(index)}"`;
    lines.push(`ailaoda_search_operations_total{${labels}} ${count}`);
  }

  lines.push('# HELP ailaoda_ai_operations_total Governed AI operation count by bounded outcome.');
  lines.push('# TYPE ailaoda_ai_operations_total counter');
  for (const [action, metric] of aiMetrics.entries()) {
    const labels = `outcome="${escapeLabelValue(action)}"`;
    lines.push(`ailaoda_ai_operations_total{${labels}} ${metric.count}`);
    lines.push(`ailaoda_ai_duration_ms_sum{${labels}} ${metric.totalDurationMs.toFixed(3)}`);
    lines.push(`ailaoda_ai_duration_ms_max{${labels}} ${metric.maxDurationMs.toFixed(3)}`);
  }

  return `${lines.join('\n')}\n`;
};
