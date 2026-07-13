const fs = require('fs');
const path = require('path');

const root = process.cwd();
const reportPath = path.join(root, 'output/audit/readiness-dependency-policy-audit-v1.json');
const instances = ['http://127.0.0.1:5006', 'http://127.0.0.1:5008'];
const report = { name: 'Readiness Dependency Policy Audit', version: '1.0', status: 'failed', startedAt: new Date().toISOString(), checks: [] };
const check = (name, passed, details = {}) => {
  report.checks.push({ name, status: passed ? 'passed' : 'failed', ...details });
  if (!passed) throw new Error(`Check failed: ${name}`);
};
const readReport = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8').replace(/^\uFEFF/, ''));

async function main() {
  const readiness = await Promise.all(instances.map(async instance => {
    const response = await fetch(`${instance}/api/v1/ready`, { signal: AbortSignal.timeout(5000) });
    return { instance, status: response.status, body: await response.json() };
  }));
  check('both-app-instances-ready', readiness.every(item => item.status === 200 && item.body.status === 'ready'), { readiness });
  check('critical-dependencies-explicit', readiness.every(item => JSON.stringify(item.body.dependencyPolicy?.critical) === JSON.stringify(['database', 'redis'])));
  check('degradable-dependencies-explicit', readiness.every(item => ['search', 'objectStorage', 'telemetry'].every(name => item.body.dependencyPolicy?.degradable?.includes(name))));
  check('degradable-topology-visible', readiness.every(item => item.body.degradable?.search?.endpointCount >= 2 && item.body.degradable?.objectStorage?.s3EndpointCount >= 2 && item.body.degradable?.telemetry?.enabled === true));

  const storageFailover = readReport('output/audit/object-storage-failover-audit-v1.json');
  const searchFailover = readReport('output/audit/meilisearch-failover-audit-v1.json');
  check('object-storage-failover-evidence', storageFailover.status === 'passed' && storageFailover.failoverMs < 5_000, { failoverMs: storageFailover.failoverMs });
  check('search-failover-evidence', searchFailover.status === 'passed' && searchFailover.failoverMs < 5_000, { failoverMs: searchFailover.failoverMs });
  report.status = 'passed';
  report.boundary = 'Readiness removes a pod only for instance-critical database or Redis failure. Shared search, object storage, and telemetry failures remain observable and use their documented fallback paths instead of removing every pod.';
}

main().catch(error => { report.error = String(error.message || error); process.exitCode = 1; }).finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Readiness Dependency Policy Audit: ${report.status.toUpperCase()}`);
  console.log(`Report: ${reportPath}`);
});
