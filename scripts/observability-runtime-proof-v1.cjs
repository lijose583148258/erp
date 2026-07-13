const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const REPORT_PATH = path.join(ROOT, 'output', 'audit', 'observability-runtime-proof-v1.json');
const baseUrls = String(process.env.AILAODA_OBSERVABILITY_TARGETS || 'http://127.0.0.1:5006,http://127.0.0.1:5008')
  .split(',')
  .map(value => value.trim().replace(/\/$/, ''))
  .filter(Boolean);
const collectorMetricsUrl = String(process.env.AILAODA_OTELCOL_METRICS_URL || 'http://127.0.0.1:8888/metrics').trim();
const traceparentPattern = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

const report = {
  name: 'Observability Runtime Proof',
  version: '1.0',
  status: 'failed',
  startedAt: new Date().toISOString(),
  targets: baseUrls,
  collectorMetricsUrl,
  checks: [],
};

const readAcceptedSpans = async () => {
  const response = await fetch(collectorMetricsUrl, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Collector metrics returned HTTP ${response.status}`);
  const metrics = await response.text();
  return metrics.split('\n')
    .filter(line => line.startsWith('otelcol_receiver_accepted_spans{') && line.includes('transport="http"'))
    .reduce((total, line) => total + Number(line.trim().split(/\s+/).at(-1) || 0), 0);
};

const waitForSpanExport = async (before) => {
  const deadline = Date.now() + 15000;
  let current = before;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    current = await readAcceptedSpans();
    if (current > before) return current;
  }
  return current;
};

const run = async () => {
  if (baseUrls.length < 2) throw new Error('At least two application targets are required for the HA observability proof.');
  const spansBefore = await readAcceptedSpans();

  for (const baseUrl of baseUrls) {
    for (const route of ['/livez', '/ready', '/health', '/api/openapi.json']) {
      const response = await fetch(`${baseUrl}${route}`, { signal: AbortSignal.timeout(10000) });
      const traceparent = response.headers.get('traceparent') || '';
      const requestId = response.headers.get('x-request-id') || '';
      const traceMatch = traceparent.match(traceparentPattern);
      let telemetryEnabled = null;
      if (route === '/health') {
        const body = await response.json();
        telemetryEnabled = body.telemetry?.enabled === true;
      } else {
        await response.arrayBuffer();
      }
      const passed = response.status === 200
        && Boolean(traceMatch)
        && requestId === traceMatch?.[1]
        && (route !== '/health' || telemetryEnabled);
      report.checks.push({ baseUrl, route, status: response.status, traceparentValid: Boolean(traceMatch), requestIdMatchesTrace: requestId === traceMatch?.[1], telemetryEnabled, passed });
    }
  }

  const spansAfter = await waitForSpanExport(spansBefore);
  report.spans = { before: spansBefore, after: spansAfter, delta: spansAfter - spansBefore };
  report.status = report.checks.every(check => check.passed) && spansAfter > spansBefore ? 'passed' : 'failed';
};

run()
  .catch(error => {
    report.error = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (report.status !== 'passed') process.exitCode = 1;
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`Observability Runtime Proof: ${report.status.toUpperCase()}`);
    console.log(`Report: ${REPORT_PATH}`);
  });
