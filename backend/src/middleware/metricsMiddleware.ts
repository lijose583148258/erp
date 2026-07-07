import { NextFunction, Request, Response } from 'express';

type RouteMetric = {
  count: number;
  errorCount: number;
  totalDurationMs: number;
  maxDurationMs: number;
};

type WebVitalMetric = {
  count: number;
  totalValue: number;
  maxValue: number;
  latestValue: number;
};

export type WebVitalMetricPayload = {
  name: string;
  value: number;
  rating?: string;
  path?: string;
  navigationType?: string;
};

const ALLOWED_WEB_VITAL_NAMES = new Set(['CLS', 'FCP', 'INP', 'LCP', 'TTFB', 'NAVIGATION', 'LONG_TASK']);
const ALLOWED_WEB_VITAL_RATINGS = new Set(['good', 'needs-improvement', 'poor', 'unknown']);
const startedAt = new Date();
const routeMetrics = new Map<string, RouteMetric>();
const webVitalMetrics = new Map<string, WebVitalMetric>();

const normalizePath = (path: string) =>
  path
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .replace(/[0-9a-f]{8,}(?=\/|$)/gi, ':token');

const normalizeBrowserPath = (value: string | undefined) => {
  const raw = String(value || '/').split('?')[0].slice(0, 180);
  const [pathname, hash = ''] = raw.split('#');
  const cleanPath = normalizePath(pathname || '/')
    .replace(/[^a-z0-9_./:-]/gi, '_')
    .slice(0, 120) || '/';
  const cleanHash = hash
    ? `#${hash.replace(/[^a-z0-9_-]/gi, '_').slice(0, 60)}`
    : '';
  return `${cleanPath}${cleanHash}`;
};

const normalizeToken = (value: string | undefined, fallback: string) =>
  String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .slice(0, 40) || fallback;

const escapePrometheusLabel = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

export const metricsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const start = process.hrtime.bigint();
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
  });
  next();
};

export const recordWebVitalMetric = (payload: WebVitalMetricPayload) => {
  const name = String(payload.name || '').toUpperCase();
  const value = Number(payload.value);
  if (!ALLOWED_WEB_VITAL_NAMES.has(name) || !Number.isFinite(value) || value < 0 || value > 600000) {
    return false;
  }

  const rating = ALLOWED_WEB_VITAL_RATINGS.has(String(payload.rating)) ? String(payload.rating) : 'unknown';
  const path = normalizeBrowserPath(payload.path);
  const navigationType = normalizeToken(payload.navigationType, 'unknown');
  const key = `${name} ${rating} ${navigationType} ${path}`;
  const current = webVitalMetrics.get(key) || {
    count: 0,
    totalValue: 0,
    maxValue: 0,
    latestValue: 0,
  };
  current.count += 1;
  current.totalValue += value;
  current.maxValue = Math.max(current.maxValue, value);
  current.latestValue = value;
  webVitalMetrics.set(key, current);
  return true;
};

export const renderPrometheusMetrics = () => {
  const lines = [
    '# HELP ailaoda_process_uptime_seconds Process uptime in seconds.',
    '# TYPE ailaoda_process_uptime_seconds gauge',
    `ailaoda_process_uptime_seconds ${Math.round(process.uptime())}`,
    '# HELP ailaoda_process_started_at_seconds Process start timestamp.',
    '# TYPE ailaoda_process_started_at_seconds gauge',
    `ailaoda_process_started_at_seconds ${Math.floor(startedAt.getTime() / 1000)}`,
    '# HELP ailaoda_http_requests_total HTTP request count by route.',
    '# TYPE ailaoda_http_requests_total counter',
  ];

  for (const [route, metric] of routeMetrics.entries()) {
    const [method, ...pathParts] = route.split(' ');
    const routePath = pathParts.join(' ');
    const labels = `method="${escapePrometheusLabel(method)}",route="${escapePrometheusLabel(routePath)}"`;
    lines.push(`ailaoda_http_requests_total{${labels}} ${metric.count}`);
    lines.push(`ailaoda_http_errors_total{${labels}} ${metric.errorCount}`);
    lines.push(`ailaoda_http_request_duration_ms_sum{${labels}} ${metric.totalDurationMs.toFixed(3)}`);
    lines.push(`ailaoda_http_request_duration_ms_max{${labels}} ${metric.maxDurationMs.toFixed(3)}`);
  }

  lines.push('# HELP ailaoda_browser_web_vital_total Browser Web Vital metric sample count.');
  lines.push('# TYPE ailaoda_browser_web_vital_total counter');
  lines.push('# HELP ailaoda_browser_web_vital_value_sum Browser Web Vital metric value sum.');
  lines.push('# TYPE ailaoda_browser_web_vital_value_sum counter');
  lines.push('# HELP ailaoda_browser_web_vital_value_max Browser Web Vital metric max value.');
  lines.push('# TYPE ailaoda_browser_web_vital_value_max gauge');
  lines.push('# HELP ailaoda_browser_web_vital_value_latest Browser Web Vital latest observed value.');
  lines.push('# TYPE ailaoda_browser_web_vital_value_latest gauge');

  for (const [key, metric] of webVitalMetrics.entries()) {
    const [name, rating, navigationType, ...pathParts] = key.split(' ');
    const labels = [
      `name="${escapePrometheusLabel(name)}"`,
      `rating="${escapePrometheusLabel(rating)}"`,
      `navigation_type="${escapePrometheusLabel(navigationType)}"`,
      `path="${escapePrometheusLabel(pathParts.join(' '))}"`,
    ].join(',');
    lines.push(`ailaoda_browser_web_vital_total{${labels}} ${metric.count}`);
    lines.push(`ailaoda_browser_web_vital_value_sum{${labels}} ${metric.totalValue.toFixed(3)}`);
    lines.push(`ailaoda_browser_web_vital_value_max{${labels}} ${metric.maxValue.toFixed(3)}`);
    lines.push(`ailaoda_browser_web_vital_value_latest{${labels}} ${metric.latestValue.toFixed(3)}`);
  }

  return `${lines.join('\n')}\n`;
};
