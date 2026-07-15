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
const componentHealth = String(process.env.OBSERVATION_COMPONENT_HEALTH_URLS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean)
  .map(entry => {
    const separator = entry.indexOf('=');
    if (separator <= 0) failConfig('Component health entries must use name=url.');
    return {
      name: entry.slice(0, separator).trim(),
      url: entry.slice(separator + 1).trim().replace(/\/$/, ''),
    };
  });
const username = String(process.env.OBSERVATION_USERNAME || '').trim();
const passwordFile = String(process.env.OBSERVATION_PASSWORD_FILE || '').trim();
const metricsTokenFile = String(process.env.OBSERVATION_METRICS_TOKEN_FILE || '').trim();
const environment = String(process.env.OBSERVATION_ENVIRONMENT || '').trim();
const evidenceId = String(process.env.OBSERVATION_EVIDENCE_ID || '').trim();
const commitSha = String(process.env.OBSERVATION_COMMIT_SHA || process.env.GITHUB_SHA || '').trim();
const imageDigest = String(process.env.OBSERVATION_IMAGE_DIGEST || '').trim();
const collectorImageDigest = String(process.env.OBSERVATION_COLLECTOR_IMAGE_DIGEST || '').trim();
function failConfig(message) {
  throw new Error(message);
}

const report = {
  name: 'Enterprise Continuous Observation',
  version: '1.0',
  status: 'failed',
  environment,
  evidenceId,
  startedAt: new Date().toISOString(),
  durationMs,
  concurrency,
  instances: appUrls,
  commitSha,
  imageDigest,
  collectorImageDigest,
  checks: [],
};
const latencies = [];
const statuses = new Map();
const instanceRequests = new Map(appUrls.map(instance => [instance, 0]));
const samples = [];
const componentProbes = new Map(componentHealth.map(component => [
  component.name,
  { url: component.url, probes: 0, failures: 0, lastStatus: 0 },
]));
let requestIndex = 0;
let authRefreshes = 0;
let readinessSamples = 0;
let readinessSemanticFailures = 0;
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
const validBaseUrl = (value, component = false) => {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return false;
    if (!component && url.pathname !== '/') return false;
    if (url.protocol === 'https:') return Boolean(url.hostname);
    if (url.protocol !== 'http:') return false;
    return url.hostname === '127.0.0.1' || (component && url.hostname.endsWith('.svc'));
  } catch {
    return false;
  }
};
const validateConfig = () => {
  if (!environment || !evidenceId || evidenceId.length < 5) {
    fail('OBSERVATION_ENVIRONMENT and OBSERVATION_EVIDENCE_ID are required.');
  }
  if (!Number.isFinite(durationMs) || durationMs < 28_800_000 || durationMs > 86_400_000) {
    fail('OBSERVATION_DURATION_MS must be between 8 and 24 hours.');
  }
  if (appUrls.length < 2) fail('OBSERVATION_APP_URLS must contain at least two application instances.');
  if (!appUrls.every(value => validBaseUrl(value, false))) {
    fail('Application URLs must be credential-free HTTPS bases or explicit 127.0.0.1 staging tunnels.');
  }
  if (!username) fail('OBSERVATION_USERNAME is required.');
  const requiredComponents = ['object-storage', 'search-primary', 'search-secondary', 'prometheus', 'tempo', 'alertmanager'];
  if (componentHealth.length !== new Set(componentHealth.map(component => component.name)).size
    || requiredComponents.some(name => !componentProbes.has(name))) {
    fail('OBSERVATION_COMPONENT_HEALTH_URLS must contain six uniquely named required components.');
  }
  if (!componentHealth.every(component => /^[a-z][a-z0-9-]{1,40}$/.test(component.name)
    && validBaseUrl(component.url, true))) {
    fail('Component health URLs must be credential-free HTTPS, 127.0.0.1, or internal Kubernetes service DNS.');
  }
  if (!/^[0-9a-f]{40}$/.test(commitSha)) fail('OBSERVATION_COMMIT_SHA must be a 40-character lowercase Git SHA.');
  if (!/^sha256:[0-9a-f]{64}$/.test(imageDigest)) fail('OBSERVATION_IMAGE_DIGEST must be an immutable sha256 digest.');
  if (!/^sha256:[0-9a-f]{64}$/.test(collectorImageDigest)) fail('OBSERVATION_COLLECTOR_IMAGE_DIGEST must be an immutable sha256 digest.');
  password = readSecretFile(passwordFile, 'Observation password');
  metricsToken = readSecretFile(metricsTokenFile, 'Metrics bearer token');
};

const requestJson = async (url, init = {}) => {
  const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(10_000) });
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
      redirect: 'error',
      headers: requiresAuth ? { authorization: `Bearer ${token}` } : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    if (requiresAuth && response.status === 401) {
      authRefreshes += 1;
      token = await login();
      response = await fetch(`${baseUrl}${route}`, {
        redirect: 'error',
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
    }
    if (route === '/ready') {
      readinessSamples += 1;
      const body = await response.json().catch(() => null);
      const semanticReady = response.ok
        && body?.status === 'ready'
        && body?.database === 'ok'
        && body?.redis?.configured === true
        && body?.redis?.ready === true
        && body?.redis?.mode === 'sentinel';
      if (!semanticReady) readinessSemanticFailures += 1;
      status = semanticReady ? response.status : 503;
    } else {
      await response.arrayBuffer();
      status = response.status;
    }
  } catch {
    status = 0;
  }
  latencies.push(performance.now() - started);
  statuses.set(status, (statuses.get(status) || 0) + 1);
};
const probeComponents = async () => Promise.all(componentHealth.map(async component => {
  const state = componentProbes.get(component.name);
  state.probes += 1;
  try {
    const response = await fetch(component.url, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
    await response.arrayBuffer();
    state.lastStatus = response.status;
    if (!response.ok) state.failures += 1;
  } catch {
    state.lastStatus = 0;
    state.failures += 1;
  }
}));
const metricsSnapshot = async () => Promise.all(appUrls.map(async instance => {
  const response = await fetch(`${instance}/metrics`, {
    redirect: 'error',
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
  await probeComponents();
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
      if (Date.now() <= deadline + 5_000) {
        samples.push(...await metricsSnapshot());
        await probeComponents();
      }
    }
  };
  await Promise.all([...Array.from({ length: concurrency }, worker), sampler()]);
  const after = await metricsSnapshot();
  await probeComponents();
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
    readinessSamples,
    readinessSemanticFailures,
    memory,
    metricSamples: samples.length,
    components: Object.fromEntries(componentProbes),
  };
  report.summary = summary;
  check('no-network-http-or-rate-limit-failures', failures === 0, { failures, statuses: statusObject });
  check('p95-under-two-seconds', summary.p95Ms < 2_000, { p95Ms: summary.p95Ms });
  check('both-instances-served', appUrls.every(instance => (instanceRequests.get(instance) || 0) > 0), { instanceRequests: summary.instanceRequests });
  check('postgres-and-redis-sentinel-continuously-ready',
    readinessSamples > 0 && readinessSemanticFailures === 0,
    { readinessSamples, readinessSemanticFailures });
  check('rss-within-envelope', memory.every(item => item.maxRssMb <= maxRssMb && item.growthRssMb <= maxRssGrowthMb), {
    maxRssMb,
    maxRssGrowthMb,
    memory,
  });
  check('telemetry-not-dropped', memory.every(item => item.telemetryDroppedDelta === 0), { memory });
  check('telemetry-queue-bounded', memory.every(item => item.maxTelemetryQueue <= maxTelemetryQueue), { maxTelemetryQueue, memory });
  check('required-components-continuously-healthy',
    [...componentProbes.values()].every(state => state.probes >= 2 && state.failures === 0),
    { components: summary.components });
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
