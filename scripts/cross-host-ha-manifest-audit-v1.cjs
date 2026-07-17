const fs = require('fs');
const path = require('path');

const root = process.cwd();
const manifestPath = 'ops/production/kubernetes/ailaoda-ha.yaml';
const readmePath = 'ops/production/kubernetes/README.md';
const reportPath = path.join(root, 'output/audit/cross-host-ha-manifest-audit-v1.json');
const findings = [];

const read = relative => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n/g, '\n');
const requireToken = (text, token, area) => {
  if (!text.includes(token)) findings.push({ level: 'P0', area, message: `Missing required token: ${token}` });
};

try {
  const manifest = read(manifestPath);
  const readme = read(readmePath);
  for (const token of [
    'replicas: 2',
    'maxUnavailable: 0',
    'requiredDuringSchedulingIgnoredDuringExecution',
    'whenUnsatisfiable: DoNotSchedule',
    'kind: PodDisruptionBudget',
    'readinessProbe:',
    'livenessProbe:',
    'startupProbe:',
    'secretKeyRef:',
    'OTEL_SERVICE_INSTANCE_ID',
    'REDIS_SENTINELS',
    'S3_ENDPOINTS',
    'SEARCH_ENDPOINTS',
    'AI_GATEWAY_EXTERNAL_ENABLED: "false"',
    'AI_DAILY_TOKEN_BUDGET: "50000"',
    'AI_CIRCUIT_FAILURE_THRESHOLD: "5"',
  ]) requireToken(manifest, token, 'manifest');

  if (/127\.0\.0\.1|localhost/.test(manifest)) findings.push({ level: 'P0', area: 'manifest', message: 'Cross-host manifest contains a loopback dependency.' });
  if (/kind:\s*Secret\b/.test(manifest)) findings.push({ level: 'P0', area: 'secrets', message: 'Do not commit Kubernetes Secret resources.' });
  if (/DATABASE_URL\s*:\s*(?!\s*$)/.test(manifest) && !manifest.includes('name: DATABASE_URL\n              valueFrom:')) {
    findings.push({ level: 'P0', area: 'secrets', message: 'DATABASE_URL must come from secretKeyRef.' });
  }
  for (const token of ['managed PostgreSQL writer endpoint', 'three Redis Sentinel', 'immutable digest', 'does not create PostgreSQL']) {
    requireToken(readme, token, 'runbook');
  }
} catch (error) {
  findings.push({ level: 'P0', area: 'files', message: String(error.message || error) });
}

const report = {
  name: 'Cross-host HA Manifest Audit',
  version: '1.0',
  status: findings.length === 0 ? 'passed' : 'failed',
  checkedAt: new Date().toISOString(),
  manifest: manifestPath,
  findings,
  boundary: 'Static deployment contract only; physical multi-host failover still requires a real cluster drill.',
};
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`Cross-host HA Manifest Audit: ${report.status.toUpperCase()}`);
console.log(`Report: ${reportPath}`);
if (findings.length) process.exit(1);
