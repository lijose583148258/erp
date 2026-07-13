const fs = require('fs');
const path = require('path');
const Redis = require('../backend/node_modules/ioredis');

const ROOT = process.cwd();
const REPORT_JSON = path.join(ROOT, 'output', 'audit', 'enterprise-pilot-readiness-audit-v1.json');
const REPORT_MD = path.join(ROOT, 'output', 'audit', 'enterprise-pilot-readiness-audit-v1.md');
const requiredReports = [
  ['deployment', 'output/audit/deployment-migration-readiness-audit-v1.json', 168],
  ['security', 'output/audit/security-production-readiness-v1.json', 168],
  ['frontend', 'output/audit/frontend-production-readiness-v1.json', 168],
  ['load', 'output/audit/enterprise-ha-load-audit-v1.json', 24],
  ['soak', 'output/audit/enterprise-ha-soak-audit-v1.json', 24],
  ['readiness-dependency-policy', 'output/audit/readiness-dependency-policy-audit-v1.json', 24],
  ['observability', 'output/audit/observability-runtime-proof-v1.json', 24],
  ['postgres-replication', 'output/audit/postgres-ha-replication-audit-v1.json', 24],
  ['postgres-promotion', 'output/audit/postgres-ha-promotion-audit-v1.json', 168],
  ['cross-host-ha-manifest', 'output/audit/cross-host-ha-manifest-audit-v1.json', 168],
  ['module-data-linkage', 'output/audit/module-data-linkage-audit-v1.json', 24],
  ['redis-replication', 'output/audit/redis-ha-replication-audit-v1.json', 24],
  ['redis-sentinel-failover', 'output/audit/redis-sentinel-failover-audit-v1.json', 168],
  ['object-storage-failover', 'output/audit/object-storage-failover-audit-v1.json', 168],
  ['meilisearch-restore', 'output/audit/meilisearch-dump-restore-audit-v1.json', 168],
  ['meilisearch-failover', 'output/audit/meilisearch-failover-audit-v1.json', 168],
  ['ai-admin-browser', 'output/playwright/crm-ai-assistant-browser-audit-report-v1.json', 72],
  ['ai-sales-browser', 'output/playwright/crm-ai-assistant-browser-audit-report-v1-sales.json', 72],
  ['ai-governed-gateway-browser', 'output/playwright/crm-ai-assistant-browser-audit-report-v1-governed.json', 72],
  ['ai-governed-runtime', 'output/audit/ai-governed-runtime-audit-v1.json', 24],
  ['default-credentials', 'output/audit/default-credential-release-gate-v1.json', 168],
];

const report = { name: 'Enterprise Pilot Readiness Audit', version: '1.0', status: 'failed', startedAt: new Date().toISOString(), reportChecks: [], runtimeChecks: [] };
const readJson = relativePath => JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8').replace(/^\uFEFF/, ''));
const check = (name, passed, details = {}) => {
  report.runtimeChecks.push({ name, status: passed ? 'passed' : 'failed', ...details });
  if (!passed) throw new Error(`Runtime check failed: ${name}`);
};

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

async function waitForJson(url, predicate, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let value;
  do {
    value = await fetchJson(url);
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 2_000));
  } while (Date.now() < deadline);
  return value;
}

async function main() {
  for (const [name, relativePath, maxAgeHours] of requiredReports) {
    if (!fs.existsSync(path.join(ROOT, relativePath))) throw new Error(`Required report is missing: ${relativePath}`);
    const evidence = readJson(relativePath);
    const timestamp = evidence.finishedAt || evidence.checkedAt || evidence.generatedAt || evidence.startedAt;
    const timestampMs = Date.parse(String(timestamp || ''));
    const ageHours = (Date.now() - timestampMs) / 3_600_000;
    const fresh = Number.isFinite(ageHours) && ageHours >= -0.1 && ageHours <= maxAgeHours;
    const passed = evidence.status === 'passed' && fresh;
    report.reportChecks.push({ name, path: relativePath.replace(/\\/g, '/'), status: passed ? 'passed' : 'failed', timestamp: timestamp || null, ageHours: Number.isFinite(ageHours) ? Number(ageHours.toFixed(3)) : null, maxAgeHours });
    if (evidence.status !== 'passed') throw new Error(`Required report is not passed: ${relativePath}`);
    if (!fresh) throw new Error(`Required report is stale or has an invalid timestamp: ${relativePath} (ageHours=${Number.isFinite(ageHours) ? ageHours.toFixed(3) : 'invalid'}, max=${maxAgeHours})`);
  }

  const health = await Promise.all([5006, 5008].map(port => fetchJson(`http://127.0.0.1:${port}/health`)));
  check('application-ha', health.every(item => item.status === 'ok' && item.database === 'ok'));
  check('redis-sentinel-clients', health.every(item => item.redis?.ready && item.redis?.mode === 'sentinel'));
  check('search-ha-config', health.every(item => item.search?.externalConfigured && item.search?.endpointCount >= 2));
  check('otel-exporters', health.every(item => item.telemetry?.enabled && item.telemetry?.dropped === 0));

  const dependencyHealth = await Promise.all([
    fetch('http://127.0.0.1:9000/minio/health/live', { signal: AbortSignal.timeout(5000) }),
    fetch('http://127.0.0.1:9010/minio/health/live', { signal: AbortSignal.timeout(5000) }),
    fetchJson('http://127.0.0.1:7700/health'),
    fetchJson('http://127.0.0.1:7710/health'),
  ]);
  check('object-storage-pair', dependencyHealth[0].ok && dependencyHealth[1].ok);
  check('search-node-pair', dependencyHealth[2].status === 'available' && dependencyHealth[3].status === 'available');

  const sentinelResults = [];
  for (const port of [26379, 26380, 26381]) {
    const sentinel = new Redis({ host: '127.0.0.1', port, lazyConnect: true, connectTimeout: 1500, commandTimeout: 1500, maxRetriesPerRequest: 1 });
    try {
      await sentinel.connect();
      const quorum = await sentinel.call('SENTINEL', 'ckquorum', 'ailaoda-primary');
      sentinelResults.push(String(quorum).startsWith('OK'));
    } finally {
      sentinel.disconnect();
    }
  }
  check('redis-sentinel-quorum', sentinelResults.every(Boolean), { sentinels: sentinelResults.length });

  const prometheus = await fetchJson('http://127.0.0.1:9090/api/v1/targets');
  const appTargets = prometheus.data.activeTargets.filter(target => target.labels?.job === 'ailao-app');
  check('prometheus-ha-targets', appTargets.length === 2 && appTargets.every(target => target.health === 'up'), { targets: appTargets.length });
  const grafana = await fetchJson('http://127.0.0.1:3001/api/health');
  check('grafana', grafana.database === 'ok');
  const grafanaPasswordPath = process.env.AILAODA_GRAFANA_ADMIN_PASSWORD_FILE || 'C:/AilaoDaPostgresRehearsal/observability/.grafana-admin-password.txt';
  const grafanaPassword = fs.readFileSync(grafanaPasswordPath, 'utf8').trim();
  const grafanaAuth = `Basic ${Buffer.from(`admin:${grafanaPassword}`, 'utf8').toString('base64')}`;
  const grafanaDashboard = await fetchJson('http://127.0.0.1:3001/api/dashboards/uid/ailaoda-overview', { headers: { authorization: grafanaAuth } });
  check('grafana-governed-ai-panel', Array.isArray(grafanaDashboard.dashboard?.panels) && grafanaDashboard.dashboard.panels.some(panel => panel.title === 'Governed AI Outcomes'));
  const prometheusRules = await fetchJson('http://127.0.0.1:9090/api/v1/rules');
  const prometheusRuleNames = (prometheusRules.data?.groups || []).flatMap(group => (group.rules || []).map(rule => rule.name));
  check('prometheus-governed-ai-alerts', prometheusRuleNames.includes('AilaoDaAIProviderFailureSpike') && prometheusRuleNames.includes('AilaoDaAIRateLimitSpike') && prometheusRuleNames.includes('AilaoDaAIBudgetExhausted') && prometheusRuleNames.includes('AilaoDaAICircuitOpen'));
  const aiMetrics = await waitForJson(
    'http://127.0.0.1:9090/api/v1/query?query=ailaoda_ai_operations_total',
    value => Array.isArray(value.data?.result) && value.data.result.length > 0,
  );
  check('prometheus-governed-ai-series', Array.isArray(aiMetrics.data?.result) && aiMetrics.data.result.length > 0, { series: aiMetrics.data?.result?.length || 0 });
  const collectorMetrics = await (await fetch('http://127.0.0.1:8888/metrics', { signal: AbortSignal.timeout(5000) })).text();
  check('otel-collector', /otelcol_receiver_accepted_spans\{[^\n]+\}\s+[1-9][0-9]*/.test(collectorMetrics));

  const aiSecurity = fs.readFileSync(path.join(ROOT, 'services', 'aiSecurity.ts'), 'utf8');
  const aiGateway = fs.readFileSync(path.join(ROOT, 'backend', 'src', 'services', 'ai-governance.service.ts'), 'utf8');
  const aiRoutes = fs.readFileSync(path.join(ROOT, 'backend', 'src', 'routes', 'ai.routes.ts'), 'utf8');
  const productionEnv = fs.readFileSync(path.join(ROOT, '.env.production.example'), 'utf8');
  check('external-ai-default-deny', aiSecurity.includes('isBrowserExternalAIPolicyEnabled') && productionEnv.includes('VITE_AILAODA_ALLOW_BROWSER_EXTERNAL_AI=false'));
  check('server-governed-ai-boundary',
    aiGateway.includes('AI_GATEWAY_EXTERNAL_ENABLED')
      && aiGateway.includes('AI_GATEWAY_ALLOWED_HOSTS')
      && aiGateway.includes("localAnswer(input, 'sensitive')")
      && aiRoutes.includes("authorizePermission('ai.assistant.use')")
      && productionEnv.includes('AI_GATEWAY_EXTERNAL_ENABLED=false'));
  report.status = 'passed';
}

main().catch(error => {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
  fs.writeFileSync(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const lines = [
    '# Enterprise Pilot Readiness Audit', '',
    `- Status: ${report.status}`, `- Finished: ${report.finishedAt}`, '',
    '## Evidence', ...report.reportChecks.map(item => `- ${item.status.toUpperCase()} ${item.name}: ${item.path}`), '',
    '## Runtime', ...report.runtimeChecks.map(item => `- ${item.status.toUpperCase()} ${item.name}`), '',
    '## Boundary',
    '- This gate proves the controlled two-instance pilot topology and tested recovery paths.',
    '- PostgreSQL promotion is operationally controlled; production automatic leader election still requires Patroni or a managed PostgreSQL service.',
    '- The Kubernetes manifest proves the cross-host application deployment contract, not a physical cluster failover drill.',
    '- The secondary Meilisearch node is dump-restored disaster recovery, not synchronous index replication.',
  ];
  fs.writeFileSync(REPORT_MD, `${lines.join('\n')}\n`, 'utf8');
  console.log(`Enterprise Pilot Readiness Audit: ${report.status.toUpperCase()}`);
  console.log(`Report: ${REPORT_JSON}`);
});
