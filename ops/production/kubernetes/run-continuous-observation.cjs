const fs = require('fs');
const path = require('path');

const outputPath = path.resolve(String(process.env.OBSERVATION_OUTPUT || 'enterprise-continuous-observation.json'));
const durationMs = Number(process.env.OBSERVATION_DURATION_MS || 28_800_000);
const concurrency = Math.max(1, Math.min(40, Number(process.env.OBSERVATION_CONCURRENCY || 8)));
const maxRssMb = Math.max(256, Number(process.env.OBSERVATION_MAX_RSS_MB || 1024));
const maxRssGrowthMb = Math.max(32, Number(process.env.OBSERVATION_MAX_RSS_GROWTH_MB || 256));
const maxTelemetryQueue = Math.max(100, Number(process.env.OBSERVATION_MAX_TELEMETRY_QUEUE || 4000));
const appUrls = String(process.env.OBSERVATION_APP_URLS || '')
  .split(',')
  .map(value => value.trim().replace(/\/$/, ''))
  .filter(Boolean);
const username = String(process.env.OBSERVATION_USERNAME || '').trim();
const passwordFile = String(process.env.OBSERVATION_PASSWORD_FILE || '').trim();
const metricsTokenFile = String(process.env.OBSERVATION_METRICS_TOKEN_FILE || '').trim();
const commitSha = String(process.env.OBSERVATION_COMMIT_SHA || process.env.GITHUB_SHA || '').trim();
const imageDigest = String(process.env.OBSERVATION_IMAGE_DIGEST || '').trim();
const report = {
  name: 'Enterprise Continuous Observation',
  version: '1.0',
  status: 'failed',
  startedAt: new Date().toISOString(),
  durationMs,
  concurrency,
  instances: appUrls,
  commitSha,
  imageDigest,
  checks: [],
};
const latencies = [];
const statuses = new Map();
const instanceRequests = new Map(appUrls.map(instance => [instance, 0]));
const samples = [];
let requestIndex = 0;
let authRefreshes = 0;
let authToken = '';
let loginPromise = null;
let password = '';
let metricsToken = '';

const fail = message => {
  throw new Error(message);
};
const check = (name, passed, details = {}) => {
  report.checks.push({ name, status: passed ? 'passed' : 'failed', ...details });
  if (!passed) fail(`Check failed: ${name}`);
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
};
const metricValue = (text, name) => {
  const match = text.match(new RegExp(`^${name}\\s+([0-9.eE+-]+)$`, 'm'));
  return match ? Number(match[1]) : Number.NaN;
};
const readSecretFile = (file, label) => {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`${label} file does not exist.`);
  const value = fs.readFileSync(file, 'utf8').trim();
  if (!value) fail(`${label} file is empty.`);
  return value;
};
const validateConfig = () => {
  if (!Number.isFinite(durationMs) || durationMs < 28_800_000 || durationMs > 86_400_000) {
    fail('OBSERVATION_DURATION_MS must be between 8 and 24 hours.');
  }
  if (appUrls.length < 2) fail('OBSERVATION_APP_URLS must contain at least two application instances.');
  if (!appUrls.every(value => /^https:\/\//.test(value) || /^http:\/\/127\.0\.0\.1(?::\d+)?$/.test(value))) {
    fail('Application URLs must use HTTPS, except explicit 127.0.0.1 staging tunnels.');
  }
  if (!username) fail('OBSERVATION_USERNAME is required.');
  if (!/^[0-9a-f]{40}$/.test(commitSha)) fail('OBSERVATION_COMMIT_SHA must be a 40-character lowercase Git SHA.');
  if (!/^sha256:[0-9a-f]{64}$/.test(imageDigest)) fail('OBSERVATION_IMAGE_DIGEST must be an immutable sha256 digest.');
  password = readSecretFile(passwordFile, 'Observation password');
  metricsToken = readSecretFile(metricsTokenFile, 'Metrics bearer token');
};

const requestJson = async (url, init = {}) => {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  const body = await response.json().catch(() => null);
  return { response, body };
};
const login = async () => {
  if (!loginPromise) {
    loginPromise = (async () => {
      const { response, body } = await requestJson(`${appUrls[0]}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const token = body?.data?.token;
      if (!response.ok || !token) fail(`Observation login failed with HTTP ${response.status}.`);
      authToken = token;
      return token;
    })().finally(() => {
      loginPromise = null;
    });
  }
  return loginPromise;
};
const fetchTimed = async (baseUrl, route, requiresAuth) => {
  const started = performance.now();
  let status = 0;
  try {
    let token = authToken;
    let response = await fetch(`${baseUrl}${route}`, {
      headers: requiresAuth ? { authorization: `Bearer ${token}` } : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    if (requiresAuth && response.status === 401) {
      authRefreshes += 1;
      token = await login();
      response = await fetch(`${baseUrl}${route}`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
    }
    await response.arrayBuffer();
    status = response.status;
  } catch {
    status = 0;
  }
  latencies.push(performance.now() - started);
  statuses.set(status, (statuses.get(status) || 0) + 1);
};
const metricsSnapshot = async () => Promise.all(appUrls.map(async instance => {
  const response = await fetch(`${instance}/metrics`, {
    headers: { authorization: `Bearer ${metricsToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) fail(`Metrics scrape failed for an application instance with HTTP ${response.status}.`);
  const text = await response.text();
  const snapshot = {
    instance,
    checkedAt: new Date().toISOString(),
    rss: metricValue(text, 'ailaoda_process_resident_memory_bytes'),
    heapUsed: metricValue(text, 'ailaoda_process_heap_used_bytes'),
    telemetryQueue: metricValue(text, 'ailaoda_telemetry_queue_size'),
    telemetryDropped: metricValue(text, 'ailaoda_telemetry_spans_dropped_total'),
  };
  if (Object.entries(snapshot).some(([key, value]) => !['instance', 'checkedAt'].includes(key) && !Number.isFinite(value))) {
    fail('Required process or telemetry metric is missing.');
  }
  return snapshot;
}));

async function main() {
  validateConfig();
  await login();
  const before = await metricsSnapshot();
  samples.push(...before);
  const routes = ['/health', '/ready', '/api/v1/dashboard', '/api/v1/customers?page=1&pageSize=30', '/api/v1/orders?page=1&pageSize=30'];
  const deadline = Date.now() + durationMs;
  const worker = async () => {
    while (Date.now() < deadline) {
      const index = requestIndex++;
      const instance = appUrls[index % appUrls.length];
      const route = routes[index % routes.length];
      instanceRequests.set(instance, (instanceRequests.get(instance) || 0) + 1);
      await fetchTimed(instance, route, route.startsWith('/api/'));
      await sleep(500);
    }
  };
  const sampler = async () => {
    while (Date.now() < deadline) {
      await sleep(Math.min(60_000, Math.max(1, deadline - Date.now())));
      if (Date.now() <= deadline + 5_000) samples.push(...await metricsSnapshot());
    }
  };
  await Promise.all([...Array.from({ length: concurrency }, worker), sampler()]);
  const after = await metricsSnapshot();
  samples.push(...after);

  const statusObject = Object.fromEntries([...statuses.entries()].map(([key, value]) => [String(key), value]));
  const failures = [...statuses.entries()]
    .filter(([code]) => code === 0 || code >= 400)
    .reduce((sum, [, count]) => sum + count, 0);
  const memory = appUrls.map(instance => {
    const instanceSamples = samples.filter(sample => sample.instance === instance);
    const first = instanceSamples[0];
    const last = instanceSamples.at(-1);
    return {
      instance,
      beforeRssMb: first.rss / 1_048_576,
      afterRssMb: last.rss / 1_048_576,
      maxRssMb: Math.max(...instanceSamples.map(sample => sample.rss)) / 1_048_576,
      growthRssMb: (last.rss - first.rss) / 1_048_576,
      maxHeapMb: Math.max(...instanceSamples.map(sample => sample.heapUsed)) / 1_048_576,
      maxTelemetryQueue: Math.max(...instanceSamples.map(sample => sample.telemetryQueue)),
      telemetryDroppedDelta: last.telemetryDropped - first.telemetryDropped,
    };
  });
  const summary = {
    requests: latencies.length,
    instanceRequests: Object.fromEntries(instanceRequests),
    statuses: statusObject,
    failures,
    p95Ms: percentile(latencies, 0.95),
    p99Ms: percentile(latencies, 0.99),
    throughputRps: latencies.length / (durationMs / 1000),
    authRefreshes,
    memory,
    metricSamples: samples.length,
  };
  report.summary = summary;
  check('no-network-http-or-rate-limit-failures', failures === 0, { failures, statuses: statusObject });
  check('p95-under-two-seconds', summary.p95Ms < 2_000, { p95Ms: summary.p95Ms });
  check('both-instances-served', appUrls.every(instance => (instanceRequests.get(instance) || 0) > 0), { instanceRequests: summary.instanceRequests });
  check('rss-within-envelope', memory.every(item => item.maxRssMb <= maxRssMb && item.growthRssMb <= maxRssGrowthMb), {
    maxRssMb,
    maxRssGrowthMb,
    memory,
  });
  check('telemetry-not-dropped', memory.every(item => item.telemetryDroppedDelta === 0), { memory });
  check('telemetry-queue-bounded', memory.every(item => item.maxTelemetryQueue <= maxTelemetryQueue), { maxTelemetryQueue, memory });
  report.status = 'passed';
}

main().catch(error => {
  report.error = String(error?.message || error);
  process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Enterprise continuous observation: ${report.status.toUpperCase()}`);
  console.log(`Report: ${outputPath}`);
});
