import { NextFunction, Request, Response } from 'express';

type RouteMetric = {
  count: number;
  errorCount: number;
  totalDurationMs: number;
  maxDurationMs: number;
};

const startedAt = new Date();
const routeMetrics = new Map<string, RouteMetric>();

const normalizePath = (path: string) =>
  path
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .replace(/[0-9a-f]{8,}(?=\/|$)/gi, ':token');

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
    const labels = `method="${method}",route="${routePath}"`;
    lines.push(`ailaoda_http_requests_total{${labels}} ${metric.count}`);
    lines.push(`ailaoda_http_errors_total{${labels}} ${metric.errorCount}`);
    lines.push(`ailaoda_http_request_duration_ms_sum{${labels}} ${metric.totalDurationMs.toFixed(3)}`);
    lines.push(`ailaoda_http_request_duration_ms_max{${labels}} ${metric.maxDurationMs.toFixed(3)}`);
  }

  return `${lines.join('\n')}\n`;
};
