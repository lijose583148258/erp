const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const REPORT_PATH = path.resolve(process.env.AILAODA_LOAD_REPORT_PATH || path.join(ROOT, 'output', 'audit', 'enterprise-ha-load-audit-v1.json'));
const targets = String(process.env.AILAODA_LOAD_TARGETS || 'http://127.0.0.1:5006,http://127.0.0.1:5008')
  .split(',').map(value => value.trim().replace(/\/$/, '')).filter(Boolean);
const username = String(process.env.AILAODA_LOAD_USERNAME || '').trim();
const passwordFile = String(process.env.AILAODA_LOAD_PASSWORD_FILE || '').trim();
const password = passwordFile
  ? fs.readFileSync(path.resolve(passwordFile), 'utf8').trim()
  : String(process.env.AILAODA_LOAD_PASSWORD || '').trim();
const totalRequests = Math.max(1, Number(process.env.AILAODA_LOAD_REQUESTS || 2000));
const concurrency = Math.max(1, Number(process.env.AILAODA_LOAD_CONCURRENCY || 40));
const timeoutMs = Math.max(1000, Number(process.env.AILAODA_LOAD_TIMEOUT_MS || 10000));

const routes = [
  { name: 'postgres-customers', path: '/api/v1/customers?page=1&pageSize=50' },
  { name: 'meili-customers', path: '/api/v1/customers?page=1&pageSize=25&search=audit' },
  { name: 'postgres-orders', path: '/api/v1/orders?page=1&pageSize=50' },
  { name: 'meili-orders', path: '/api/v1/orders?page=1&pageSize=25&search=SO' },
  { name: 'redis-currency-cache', path: '/api/v1/currency/rates' },
];

const report = {
  name: 'Enterprise HA Load Audit',
  version: '2.0',
  status: 'failed',
  environment: String(process.env.ENTERPRISE_EVIDENCE_ENVIRONMENT || '').trim(),
  evidenceId: String(process.env.ENTERPRISE_EVIDENCE_ID || '').trim(),
  commitSha: String(process.env.ENTERPRISE_EVIDENCE_COMMIT_SHA || process.env.GITHUB_SHA || '').trim(),
  imageDigest: String(process.env.ENTERPRISE_EVIDENCE_IMAGE_DIGEST || '').trim(),
  startedAt: new Date().toISOString(),
  targets,
  totalRequests,
  concurrency,
  timeoutMs,
  thresholds: {
    errorRateMax: Math.max(0, Number(process.env.AILAODA_LOAD_ERROR_RATE_MAX || 0.005)),
    p95MaxMs: Math.max(1, Number(process.env.AILAODA_LOAD_P95_MAX_MS || 1000)),
    p99MaxMs: Math.max(1, Number(process.env.AILAODA_LOAD_P99_MAX_MS || 2000)),
  },
};

const percentile = (sorted, value) => sorted.length
  ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)]
  : null;

const summarize = records => {
  const latencies = records.map(record => record.durationMs).sort((a, b) => a - b);
  const failures = records.filter(record => !record.ok);
  return {
    requests: records.length,
    successes: records.length - failures.length,
    failures: failures.length,
    errorRate: records.length ? failures.length / records.length : 1,
    latencyMs: {
      min: latencies[0] ?? null,
      p50: percentile(latencies, 0.50),
      p95: percentile(latencies, 0.95),
      p99: percentile(latencies, 0.99),
      max: latencies.at(-1) ?? null,
    },
    statuses: records.reduce((result, record) => {
      const key = String(record.status || record.error || 'unknown');
      result[key] = (result[key] || 0) + 1;
      return result;
    }, {}),
  };
};

const groupSummaries = (records, key) => Object.fromEntries(
  [...new Set(records.map(record => record[key]))].map(value => [value, summarize(records.filter(record => record[key] === value))]),
);

const readHealth = async target => {
  const response = await fetch(`${target}/health`, { signal: AbortSignal.timeout(timeoutMs) });
  const body = await response.json();
  return {
    status: response.status,
    database: body.database,
    redisReady: body.redis?.ready === true,
    cacheDriver: body.cache?.driver,
    searchConfigured: body.search?.externalConfigured === true,
    searchProvider: body.search?.driver,
    telemetryEnabled: body.telemetry?.enabled === true,
  };
};

const login = async () => {
  const response = await fetch(`${targets[0]}/api/v1/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }), signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json();
  const token = body.data?.accessToken || body.data?.token || body.accessToken || body.token;
  if (!response.ok || !token) throw new Error(`Load-test login failed with HTTP ${response.status}`);
  return token;
};

const verifySharedToken = async (token) => Promise.all(targets.map(async target => {
  const response = await fetch(`${target}/api/v1/auth/me`, {
    headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs),
  });
  await response.arrayBuffer();
  return { target, status: response.status, passed: response.status === 200 };
}));

const main = async () => {
  if (targets.length < 2) throw new Error('At least two targets are required for an HA load audit.');
  if (!username || !password) throw new Error('AILAODA_LOAD_USERNAME and AILAODA_LOAD_PASSWORD_FILE (or password) are required.');
  report.healthBefore = await Promise.all(targets.map(readHealth));
  const token = await login();
  report.sharedTokenPreflight = await verifySharedToken(token);
  if (!report.sharedTokenPreflight.every(check => check.passed)) {
    throw new Error('The login token was not accepted by every HA target before load started.');
  }
  const records = new Array(totalRequests);
  let nextIndex = 0;
  const startedAt = performance.now();

  const worker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= totalRequests) return;
      const target = targets[index % targets.length];
      const route = routes[index % routes.length];
      const started = performance.now();
      try {
        const response = await fetch(`${target}${route.path}`, {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(timeoutMs),
        });
        await response.arrayBuffer();
        records[index] = { target, route: route.name, status: response.status, ok: response.status === 200, durationMs: Math.round((performance.now() - started) * 100) / 100 };
      } catch (error) {
        records[index] = { target, route: route.name, status: 0, ok: false, error: error?.name || 'request_error', durationMs: Math.round((performance.now() - started) * 100) / 100 };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, totalRequests) }, worker));
  const durationMs = performance.now() - startedAt;
  report.durationMs = Math.round(durationMs);
  report.throughputRps = Math.round((totalRequests / durationMs * 1000) * 100) / 100;
  report.overall = summarize(records);
  report.byTarget = groupSummaries(records, 'target');
  report.byRoute = groupSummaries(records, 'route');
  report.healthAfter = await Promise.all(targets.map(readHealth));

  const healthPassed = [...report.healthBefore, ...report.healthAfter].every(health =>
    health.status === 200 && health.database === 'ok' && health.redisReady && health.cacheDriver === 'redis'
    && health.searchConfigured && health.telemetryEnabled);
  const targetPassed = Object.values(report.byTarget).every(summary => summary.errorRate <= report.thresholds.errorRateMax);
  const routePassed = Object.values(report.byRoute).every(summary => summary.errorRate <= report.thresholds.errorRateMax);
  const latencyPassed = report.overall.latencyMs.p95 <= report.thresholds.p95MaxMs && report.overall.latencyMs.p99 <= report.thresholds.p99MaxMs;
  report.gates = { healthPassed, targetPassed, routePassed, latencyPassed };
  report.status = Object.values(report.gates).every(Boolean) ? 'passed' : 'failed';
};

main().catch(error => {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
}).finally(() => {
  if (report.status !== 'passed') process.exitCode = 1;
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Enterprise HA Load Audit: ${report.status.toUpperCase()}`);
  if (report.overall) console.log(`Requests=${report.overall.requests} errors=${report.overall.failures} p95=${report.overall.latencyMs.p95}ms p99=${report.overall.latencyMs.p99}ms throughput=${report.throughputRps}rps`);
  console.log(`Report: ${REPORT_PATH}`);
});
