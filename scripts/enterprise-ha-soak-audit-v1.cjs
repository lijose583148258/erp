const fs = require('fs');
const path = require('path');
const { ensureUiAuditUser } = require('./lib/ui-audit-user.cjs');

const root = process.cwd();
const reportPath = path.join(root, 'output/audit/enterprise-ha-soak-audit-v1.json');
const durationMs = Math.max(30_000, Number(process.env.HA_SOAK_DURATION_MS || 600_000));
const concurrency = Math.max(1, Math.min(40, Number(process.env.HA_SOAK_CONCURRENCY || 8)));
const maxRssMb = Math.max(256, Number(process.env.HA_SOAK_MAX_RSS_MB || 1024));
const maxRssGrowthMb = Math.max(32, Number(process.env.HA_SOAK_MAX_RSS_GROWTH_MB || 256));
const instances = ['http://127.0.0.1:5006', 'http://127.0.0.1:5008'];
const report = { name: 'Enterprise HA Soak Audit', version: '1.0', status: 'failed', startedAt: new Date().toISOString(), durationMs, concurrency, instances, checks: [] };
const latencies = [];
const statuses = new Map();
const instanceRequests = new Map(instances.map(instance => [instance, 0]));
let requestIndex = 0;

const check = (name, passed, details = {}) => {
  report.checks.push({ name, status: passed ? 'passed' : 'failed', ...details });
  if (!passed) throw new Error(`Check failed: ${name}`);
};
const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
};
async function fetchTimed(url, options = {}) {
  const started = performance.now();
  try {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(5000) });
    await response.arrayBuffer();
    latencies.push(performance.now() - started);
    statuses.set(response.status, (statuses.get(response.status) || 0) + 1);
  } catch {
    latencies.push(performance.now() - started);
    statuses.set(0, (statuses.get(0) || 0) + 1);
  }
}
async function login() {
  const account = await ensureUiAuditUser();
  const response = await fetch(`${instances[0]}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: account.username, password: account.password }), signal: AbortSignal.timeout(5000) });
  const json = await response.json();
  check('soak-audit-login', response.ok && Boolean(json?.data?.token));
  return json.data.token;
}
const metricValue = (text, name) => Number(text.match(new RegExp(`^${name}\\s+([0-9.eE+-]+)$`, 'm'))?.[1] || NaN);
async function memorySnapshot(token) {
  return Promise.all(instances.map(async instance => {
    const response = await fetch(`${instance}/metrics`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
    const text = await response.text();
    return { instance, rss: metricValue(text, 'ailaoda_process_resident_memory_bytes'), heapUsed: metricValue(text, 'ailaoda_process_heap_used_bytes') };
  }));
}

async function main() {
  const token = await login();
  const headers = { authorization: `Bearer ${token}` };
  const before = await memorySnapshot(token);
  check('memory-metrics-available', before.every(item => Number.isFinite(item.rss) && Number.isFinite(item.heapUsed)), { before });
  const routes = ['/health', '/ready', '/api/v1/dashboard', '/api/v1/customers?page=1&pageSize=30', '/api/v1/orders?page=1&pageSize=30'];
  const deadline = Date.now() + durationMs;
  const worker = async () => {
    while (Date.now() < deadline) {
      const index = requestIndex++;
      const instance = instances[index % instances.length];
      instanceRequests.set(instance, (instanceRequests.get(instance) || 0) + 1);
      const route = routes[index % routes.length];
      await fetchTimed(`${instance}${route}`, route.startsWith('/api/') ? { headers } : {});
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const after = await memorySnapshot(token);
  const memory = after.map((item, index) => ({
    instance: item.instance,
    beforeRssMb: before[index].rss / 1_048_576,
    afterRssMb: item.rss / 1_048_576,
    growthRssMb: (item.rss - before[index].rss) / 1_048_576,
    beforeHeapMb: before[index].heapUsed / 1_048_576,
    afterHeapMb: item.heapUsed / 1_048_576,
  }));
  const statusObject = Object.fromEntries([...statuses.entries()].map(([key, value]) => [String(key), value]));
  const failures = [...statuses.entries()].filter(([code]) => code === 0 || code >= 500).reduce((sum, [, count]) => sum + count, 0);
  const summary = { requests: latencies.length, instanceRequests: Object.fromEntries(instanceRequests), statuses: statusObject, failures, p95Ms: percentile(latencies, 0.95), p99Ms: percentile(latencies, 0.99), throughputRps: latencies.length / (durationMs / 1000), memory };
  report.summary = summary;
  check('no-network-or-5xx-failures', failures === 0, { failures, statuses: statusObject });
  check('no-rate-limit-distortion', (statuses.get(429) || 0) === 0, { statuses: statusObject });
  check('p95-under-two-seconds', summary.p95Ms < 2_000, { p95Ms: summary.p95Ms });
  check('rss-within-envelope', memory.every(item => item.afterRssMb <= maxRssMb && item.growthRssMb <= maxRssGrowthMb), { maxRssMb, maxRssGrowthMb, memory });
  check('both-instances-served', instances.every(instance => (instanceRequests.get(instance) || 0) > 0), { instanceRequests: Object.fromEntries(instanceRequests) });
  report.status = 'passed';
}

main().catch(error => { report.error = String(error.message || error); process.exitCode = 1; }).finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Enterprise HA Soak Audit: ${report.status.toUpperCase()}`);
  console.log(`Report: ${reportPath}`);
});
