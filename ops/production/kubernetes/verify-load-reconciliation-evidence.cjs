const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const valueFor = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
};
const reportsDirValue = valueFor('--reports-dir');
const evidenceValue = valueFor('--evidence');
if (!reportsDirValue || !evidenceValue) throw new Error('Missing --reports-dir or --evidence.');
const reportsDir = path.resolve(reportsDirValue);
const evidencePath = path.resolve(evidenceValue);
if (!fs.existsSync(reportsDir) || !fs.statSync(reportsDir).isDirectory()) throw new Error('Load reconciliation reports directory does not exist.');
if (!fs.existsSync(evidencePath) || !fs.statSync(evidencePath).isFile()) throw new Error('Enterprise evidence file does not exist.');
const files = {
  load: path.join(reportsDir, 'enterprise-ha-load-audit-v1.json'),
  concurrency: path.join(reportsDir, 'concurrency-consistency-audit-report-v1.json'),
};
for (const [name, file] of Object.entries(files)) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`${name} report does not exist.`);
}
const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8').replace(/^\uFEFF/, ''));
const load = JSON.parse(fs.readFileSync(files.load, 'utf8').replace(/^\uFEFF/, ''));
const concurrency = JSON.parse(fs.readFileSync(files.concurrency, 'utf8').replace(/^\uFEFF/, ''));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const hashes = { load: hash(files.load), concurrency: hash(files.concurrency) };
const identityMatches = report => report.environment === evidence.environment
  && report.evidenceId === evidence.evidenceId
  && report.commitSha === evidence.commitSha
  && report.imageDigest === evidence.imageDigest;
const assertFresh = (name, report) => {
  const finishedMs = Date.parse(String(report.finishedAt || ''));
  const ageMs = Date.now() - finishedMs;
  if (!Number.isFinite(finishedMs) || ageMs < -300_000 || ageMs > 24 * 3_600_000) {
    throw new Error(`${name} report is stale or has an invalid timestamp.`);
  }
  if (report.status !== 'passed' || !identityMatches(report)) {
    throw new Error(`${name} report status or release identity is invalid.`);
  }
};

assertFresh('Load', load);
const targetNames = Array.from(new Set(Array.isArray(load.targets) ? load.targets.filter(Boolean) : []));
const targetSummaries = Object.values(load.byTarget || {});
const routeSummaries = Object.values(load.byRoute || {});
if (targetNames.length < 2 || Number(load.totalRequests) < 1000 || Number(load.concurrency) < 20
  || Number(load.overall?.requests) !== Number(load.totalRequests)
  || Number(load.overall?.failures) !== 0 || Number(load.overall?.errorRate) !== 0
  || Number(load.overall?.latencyMs?.p95) > 1000 || Number(load.overall?.latencyMs?.p99) > 2000
  || !Number.isFinite(Number(load.throughputRps)) || Number(load.throughputRps) <= 0
  || targetSummaries.length < 2 || targetSummaries.some(item => Number(item?.requests) <= 0 || Number(item?.failures) !== 0)
  || routeSummaries.length < 5 || routeSummaries.some(item => Number(item?.requests) <= 0 || Number(item?.failures) !== 0)
  || !Array.isArray(load.healthBefore) || load.healthBefore.length < 2
  || !Array.isArray(load.healthAfter) || load.healthAfter.length < 2
  || [...load.healthBefore, ...load.healthAfter].some(item => item?.status !== 200 || item?.database !== 'ok'
    || item?.redisReady !== true || item?.cacheDriver !== 'redis'
    || item?.searchConfigured !== true || item?.telemetryEnabled !== true)
  || Object.values(load.gates || {}).length < 4 || Object.values(load.gates).some(value => value !== true)) {
  throw new Error('Load report does not satisfy the formal zero-error dual-instance envelope.');
}

assertFresh('Concurrency reconciliation', concurrency);
const requiredSteps = [
  'login-required-roles',
  'create-sales-owned-customer',
  'readback-customer-no-loss',
  'create-order-for-concurrency',
  'submit-two-payments-concurrently',
  'readback-pending-payments',
  'verify-two-payments-concurrently',
  'final-readback-consistency',
  'long-read-loop-no-drift',
];
const passedSteps = new Set((concurrency.steps || [])
  .filter(step => step?.result === 'passed').map(step => step.step));
if (requiredSteps.some(step => !passedSteps.has(step))
  || (concurrency.steps || []).some(step => step?.result === 'failed')
  || Number(concurrency.expectedPaidAmount) !== 300
  || Math.abs(Number(concurrency.finalOrder?.paidAmount) - 300) > 0.01
  || !['partial', 'paid'].includes(String(concurrency.finalOrder?.paymentStatus))
  || Number(concurrency.finalOrder?.paymentCount) < 2) {
  throw new Error('Concurrency report does not prove payment and readback reconciliation.');
}

const binding = {
  status: 'passed',
  environment: evidence.environment,
  evidenceId: evidence.evidenceId,
  commitSha: evidence.commitSha,
  imageDigest: evidence.imageDigest,
  verifiedAt: new Date().toISOString(),
  requests: load.totalRequests,
  concurrency: load.concurrency,
  failures: load.overall.failures,
  p95Ms: load.overall.latencyMs.p95,
  p99Ms: load.overall.latencyMs.p99,
  throughputRps: load.throughputRps,
  reconciledPaidAmount: concurrency.finalOrder.paidAmount,
  loadReportSha256: hashes.load,
  concurrencyReportSha256: hashes.concurrency,
};
if (args.includes('--bind')) {
  evidence.loadReconciliation = binding;
  const temporary = `${evidencePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, evidencePath);
} else {
  const current = evidence.loadReconciliation;
  for (const [key, value] of Object.entries(binding)) {
    if (key === 'verifiedAt') continue;
    if (current?.[key] !== value) throw new Error('Enterprise evidence is not bound to the load and reconciliation reports.');
  }
}
console.log('Load and reconciliation evidence: PASSED');
