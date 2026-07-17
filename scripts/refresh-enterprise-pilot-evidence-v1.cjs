const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = process.cwd();
const args = process.argv.slice(2);
const valueOf = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const profile = valueOf('--profile', 'daily');
const checkOnly = args.includes('--check-only');
const soakDurationMs = Math.max(30_000, Number(valueOf('--soak-duration-ms', '120000')));
const runtimeRoot = path.resolve(valueOf('--runtime-root', 'C:\\AilaoDaPostgresRehearsal'));
const reportPath = path.join(root, 'output/audit/enterprise-pilot-evidence-refresh-v1.json');
const report = { name: 'Enterprise Pilot Evidence Refresh', version: '1.1', status: 'failed', profile, checkOnly, soakDurationMs, startedAt: new Date().toISOString(), steps: [] };

if (!['daily', 'weekly'].includes(profile)) throw new Error('Use --profile daily or --profile weekly.');
if (/[^\x00-\x7F]/.test(runtimeRoot)) throw new Error(`Runtime root must be ASCII-only: ${runtimeRoot}`);

const npmCli = process.env.npm_execpath;
if (!npmCli || !fs.existsSync(npmCli)) throw new Error('npm_execpath is unavailable; run the evidence refresh through npm.');
const step = (name, command, commandArgs, env = {}) => {
  if (checkOnly) {
    report.steps.push({ name, status: 'planned', command: [command, ...commandArgs].join(' ') });
    console.log(`[planned] ${name}`);
    return;
  }
  const started = Date.now();
  console.log(`[running] ${name}`);
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    windowsHide: true,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${name} failed with exit code ${result.status}`);
  report.steps.push({ name, status: 'passed', durationMs: Date.now() - started });
  console.log(`[passed] ${name}`);
};
const npmStep = (name, script, env) => step(name, process.execPath, [npmCli, 'run', script], env);
const requiredSecret = (environmentName, fileEnvironmentName) => {
  const file = String(process.env[fileEnvironmentName] || '').trim();
  const value = file
    ? fs.readFileSync(path.resolve(file), 'utf8').trim()
    : String(process.env[environmentName] || '').trim();
  if (!value) throw new Error(`Missing ${environmentName} or ${fileEnvironmentName}.`);
  return value;
};

async function ensureRuntimeReady() {
  for (const port of [5006, 5008]) {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/ready`, { signal: AbortSignal.timeout(5000) });
    const body = await response.json();
    if (!response.ok || body.status !== 'ready') throw new Error(`Application instance ${port} is not ready.`);
  }
}

async function main() {
  for (const relative of ['.pg-password.txt', 'observability/metrics-bearer-token.txt']) {
    if (!fs.existsSync(path.join(runtimeRoot, relative))) throw new Error(`Missing runtime prerequisite: ${relative}`);
  }
  await ensureRuntimeReady();
  const pgPassword = fs.readFileSync(path.join(runtimeRoot, '.pg-password.txt'), 'utf8').trim();
  const adminPassword = requiredSecret('PILOT_AUDIT_ADMIN_PASSWORD', 'PILOT_AUDIT_ADMIN_PASSWORD_FILE');
  const salesPassword = requiredSecret('PILOT_AUDIT_SALES_PASSWORD', 'PILOT_AUDIT_SALES_PASSWORD_FILE');
  const adminUsername = String(process.env.PILOT_AUDIT_ADMIN_USERNAME || 'enterprise_pilot_admin').trim();
  const salesUsername = String(process.env.PILOT_AUDIT_SALES_USERNAME || 'enterprise_pilot_sales').trim();
  const commonEnv = {
    AUDIT_PRISMA_PROVIDER: 'postgresql',
    AUDIT_DATABASE_URL: `postgresql://ailaoda:${encodeURIComponent(pgPassword)}@127.0.0.1:55432/ailaoda?schema=public`,
    AUDIT_PRISMA_CLIENT_PATH: 'output/postgres-server-artifact/backend/prisma/generated-client',
    APP_URL: 'http://127.0.0.1:5006/',
    HA_SOAK_DURATION_MS: String(soakDurationMs),
    PILOT_AUDIT_ADMIN_USERNAME: adminUsername,
    PILOT_AUDIT_ADMIN_PASSWORD: adminPassword,
    PILOT_AUDIT_SALES_USERNAME: salesUsername,
    PILOT_AUDIT_SALES_PASSWORD: salesPassword,
    AILAODA_LOAD_USERNAME: adminUsername,
    AILAODA_LOAD_PASSWORD: adminPassword,
  };

  step('prepare-audit-users', process.execPath, ['scripts/prepare-enterprise-pilot-audit-users-v1.cjs'], commonEnv);
  npmStep('deployment-readiness', 'audit:deployment:readiness', commonEnv);
  npmStep('security-readiness', 'audit:security:production-readiness', commonEnv);
  npmStep('frontend-readiness', 'audit:frontend:production-readiness', commonEnv);
  npmStep('postgres-replication', 'audit:ha:postgres-replication', commonEnv);
  npmStep('redis-replication', 'audit:ha:redis-replication', { ...commonEnv, REDIS_HA_SKIP_PROMOTION: 'true' });
  npmStep('observability-runtime', 'audit:observability:runtime', commonEnv);
  npmStep('ha-load', 'audit:load:ha', commonEnv);
  npmStep('ha-soak', 'audit:soak:ha', commonEnv);
  npmStep('orders-linkage', 'audit:orders:api', commonEnv);
  npmStep('procurement-linkage', 'audit:procurement:api', commonEnv);
  npmStep('module-linkage-gate', 'audit:modules:data-linkage', commonEnv);
  npmStep('readiness-dependency-policy', 'audit:runtime:dependency-policy', commonEnv);
  npmStep('default-credential-gate', 'audit:auth:default-credentials', commonEnv);

  step('ai-admin-browser', process.execPath, ['scripts/crm-ai-assistant-browser-audit-v1.cjs'], { ...commonEnv, AI_AUDIT_USERNAME: commonEnv.PILOT_AUDIT_ADMIN_USERNAME, AI_AUDIT_PASSWORD: commonEnv.PILOT_AUDIT_ADMIN_PASSWORD, AI_AUDIT_ROLE_LABEL: 'admin', AI_AUDIT_REPORT_SUFFIX: '' });
  step('ai-sales-browser', process.execPath, ['scripts/crm-ai-assistant-browser-audit-v1.cjs'], { ...commonEnv, AI_AUDIT_USERNAME: commonEnv.PILOT_AUDIT_SALES_USERNAME, AI_AUDIT_PASSWORD: commonEnv.PILOT_AUDIT_SALES_PASSWORD, AI_AUDIT_ROLE_LABEL: 'sales', AI_AUDIT_REPORT_SUFFIX: 'sales' });
  step('ai-governed-browser', process.execPath, ['scripts/crm-ai-assistant-browser-audit-v1.cjs'], { ...commonEnv, AI_AUDIT_USERNAME: commonEnv.PILOT_AUDIT_ADMIN_USERNAME, AI_AUDIT_PASSWORD: commonEnv.PILOT_AUDIT_ADMIN_PASSWORD, AI_AUDIT_ROLE_LABEL: 'admin', AI_AUDIT_REPORT_SUFFIX: 'governed' });
  npmStep('ai-governed-runtime', 'audit:ai:governed-runtime', commonEnv);

  if (profile === 'weekly') {
    npmStep('postgres-promotion', 'audit:ha:postgres-promotion', commonEnv);
    npmStep('redis-sentinel-automatic-failover', 'audit:ha:redis-sentinel-failover', commonEnv);
    npmStep('minio-application-failover', 'audit:ha:minio-failover', commonEnv);
    npmStep('meilisearch-dump-restore', 'audit:ha:meilisearch-restore', commonEnv);
    npmStep('meilisearch-application-failover', 'audit:ha:meilisearch-failover', commonEnv);
  }

  npmStep('enterprise-pilot-gate', 'audit:pilot:enterprise', commonEnv);
  report.status = checkOnly ? 'ready' : 'passed';
}

main().catch(error => {
  report.error = String(error.message || error);
  report.steps.push({ name: 'orchestrator', status: 'failed', error: report.error });
  process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Enterprise Pilot Evidence Refresh: ${report.status.toUpperCase()}`);
  console.log(`Report: ${reportPath}`);
});
