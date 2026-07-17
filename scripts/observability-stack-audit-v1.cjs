const fs = require('fs');
const path = require('path');

const root = process.cwd();
const findings = [];

function read(relativePath) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) {
    findings.push({ severity: 'P1', file: relativePath, message: 'required observability file is missing' });
    return '';
  }
  return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
}

function requireIncludes(file, tokens) {
  const content = read(file);
  for (const token of tokens) {
    if (!content.includes(token)) findings.push({ severity: 'P1', file, message: `missing token: ${token}` });
  }
  return content;
}

const compose = requireIncludes('docker-compose.yml', [
  'prometheus:',
  'grafana:',
  'otel-collector:',
  'profiles:',
  'observability',
  'AILAODA_METRICS_BEARER_TOKEN_FILE',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_SERVICE_NAME',
  'ailaoda_metrics_bearer_token',
  'GRAFANA_ADMIN_PASSWORD',
  './ops/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro',
  './ops/grafana/provisioning:/etc/grafana/provisioning:ro',
  './ops/otelcol/config.yml:/etc/otelcol/config.yml:ro',
]);
if (compose.includes('--config.expand-env')) {
  findings.push({ severity: 'P1', file: 'docker-compose.yml', message: 'Prometheus 2.55.1 does not support --config.expand-env.' });
}

requireIncludes('ops/prometheus/prometheus.yml', [
  'scrape_configs:',
  'job_name: ailao-app',
  'metrics_path: /metrics',
  'authorization:',
  'credentials_file: /run/secrets/ailaoda_metrics_bearer_token',
  'ailao-app:5001',
]);

requireIncludes('ops/prometheus/prometheus.sandbox.yml', [
  'C:/AilaoDaPostgresRehearsal/observability/ailaoda-alerts.yml',
  'C:/AilaoDaPostgresRehearsal/observability/metrics-bearer-token.txt',
  '127.0.0.1:5006',
  '127.0.0.1:5008',
  'runtime: windows-sandbox',
]);

requireIncludes('ops/prometheus/rules/ailaoda-alerts.yml', [
  'AilaoDaMetricsTargetDown',
  'AilaoDaHighHttp5xx',
  'AilaoDaPoorWebVitals',
  'AilaoDaSearchFallbackSpike',
  'AilaoDaAIProviderFailureSpike',
  'AilaoDaAIRateLimitSpike',
  'AilaoDaAIBudgetExhausted',
  'AilaoDaAICircuitOpen',
  'ailaoda_http_errors_total',
  'ailaoda_browser_web_vitals_total',
  'ailaoda_search_operations_total',
  'ailaoda_ai_operations_total',
]);

requireIncludes('ops/grafana/provisioning/datasources/prometheus.yml', [
  'type: prometheus',
  'url: http://prometheus:9090',
  'isDefault: true',
]);

requireIncludes('ops/grafana/provisioning/dashboards/ailaoda.yml', [
  'AilaoDa',
  '/var/lib/grafana/dashboards',
]);

requireIncludes('ops/grafana/sandbox-provisioning/datasources/prometheus.yml', [
  'uid: ailaoda-prometheus',
  'url: ${AILAODA_PROMETHEUS_URL}',
]);

requireIncludes('ops/grafana/sandbox-provisioning/dashboards/ailaoda.yml', [
  'path: ${AILAODA_GRAFANA_DASHBOARD_PATH}',
]);

const dashboard = requireIncludes('ops/grafana/dashboards/ailaoda-overview.json', [
  '"title": "AilaoDa ERP CRM Overview"',
  'ailaoda_process_uptime_seconds',
  'ailaoda_http_requests_total',
  'ailaoda_http_errors_total',
  'ailaoda_browser_web_vitals_total',
  'ailaoda_search_operations_total',
  'ailaoda_cache_operations_total',
  'ailaoda_ai_operations_total',
  'Governed AI Outcomes',
]);
try {
  JSON.parse(dashboard);
} catch (error) {
  findings.push({ severity: 'P1', file: 'ops/grafana/dashboards/ailaoda-overview.json', message: `dashboard JSON is invalid: ${error.message}` });
}

requireIncludes('.env.production.example', [
  'AILAODA_METRICS_BEARER_TOKEN_FILE=',
  'PROMETHEUS_PORT=9090',
  'GRAFANA_PORT=3001',
  'GRAFANA_ADMIN_PASSWORD=',
  'OTEL_EXPORTER_OTLP_ENDPOINT=',
  'OTEL_SERVICE_NAME=ailaoda-erp-crm',
]);

requireIncludes('backend/src/server.ts', [
  "import './observability/instrumentation'",
  "app.get('/metrics'",
  'hasValidMetricsBearerToken',
  "authorizePermission('system.metrics.read')",
  'renderPrometheusMetrics()',
  'traceContextMiddleware',
  'getTraceContext(req)',
  'shutdownTelemetry()',
]);

requireIncludes('backend/src/observability/instrumentation.ts', [
  'recordTelemetryHttpSpan',
  'OTEL_BATCH_MAX_QUEUE_SIZE',
  'service.instance.id',
  'otlp-http-json',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'getTelemetryStatus',
  'shutdownTelemetry',
]);

requireIncludes('backend/src/security/metricsAccess.ts', [
  'timingSafeEqual',
  'AILAODA_METRICS_BEARER_TOKEN',
  'AILAODA_METRICS_BEARER_TOKEN_FILE',
]);

requireIncludes('backend/src/middleware/traceContext.ts', [
  'traceparent',
  'X-Request-Id',
  'parseTraceparent',
  'createTraceContext',
  'crypto.randomBytes',
]);

requireIncludes('backend/src/middleware/metricsMiddleware.ts', [
  'ailaoda_http_errors_total',
  'ailaoda_search_operations_total',
  'ailaoda_cache_operations_total',
  'ailaoda_ai_operations_total',
  'ailaoda_process_resident_memory_bytes',
  'ailaoda_process_heap_used_bytes',
]);

requireIncludes('ops/otelcol/config.yml', [
  'receivers:',
  'otlp:',
  '0.0.0.0:4317',
  '0.0.0.0:4318',
  'pipelines:',
  'traces:',
  'metrics:',
]);

if (findings.length) {
  console.error('Observability Stack Audit: FAIL');
  for (const finding of findings) console.error(`[${finding.severity}] ${finding.file}: ${finding.message}`);
  process.exit(1);
}

console.log('Observability Stack Audit: PASS');
console.log('- Prometheus scrapes the protected /metrics endpoint with an explicit bearer token.');
console.log('- Grafana datasource and AilaoDa dashboard provisioning are present.');
console.log('- Alert rules cover target health, HTTP errors, Web Vitals, search fallback, AI provider failure, rate limiting, daily budget, and circuit state.');
console.log('- OpenTelemetry collector and request trace context boundary are present.');
