const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const valueFor = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
};
const resolveFile = (value, label) => {
  const absolute = path.resolve(value);
  if (!value || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    throw new Error(`${label} file does not exist.`);
  }
  return absolute;
};
const reportsDir = path.resolve(valueFor('--reports-dir'));
if (!valueFor('--reports-dir') || !fs.existsSync(reportsDir) || !fs.statSync(reportsDir).isDirectory()) {
  throw new Error('Resilience reports directory does not exist.');
}
const evidencePath = resolveFile(valueFor('--evidence'), 'Enterprise evidence');
const maxAgeHours = Math.max(1, Number(valueFor('--max-age-hours') || 168));
const bind = args.includes('--bind');
const files = {
  objectStorage: resolveFile(path.join(reportsDir, 'object-storage-failover-audit-v1.json'), 'Object storage failover report'),
  searchFailover: resolveFile(path.join(reportsDir, 'meilisearch-failover-audit-v1.json'), 'Search failover report'),
  searchRestore: resolveFile(path.join(reportsDir, 'meilisearch-dump-restore-audit-v1.json'), 'Search restore report'),
};
const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8').replace(/^\uFEFF/, ''));
const reports = Object.fromEntries(Object.entries(files).map(([key, file]) => [
  key,
  JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')),
]));
const hashes = Object.fromEntries(Object.entries(files).map(([key, file]) => [
  key,
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
]));

const requiredIdentity = report => report.environment === evidence.environment
  && report.evidenceId === evidence.evidenceId
  && report.commitSha === evidence.commitSha
  && report.imageDigest === evidence.imageDigest;
const assertReport = (name, report, requiredChecks) => {
  const finishedMs = Date.parse(String(report.finishedAt || ''));
  const ageHours = (Date.now() - finishedMs) / 3_600_000;
  if (report.status !== 'passed') throw new Error(`${name} report is not passed.`);
  if (!Number.isFinite(ageHours) || ageHours < -0.1 || ageHours > maxAgeHours) {
    throw new Error(`${name} report is stale or has an invalid timestamp.`);
  }
  if (!requiredIdentity(report)) throw new Error(`${name} report identity does not match enterprise evidence.`);
  if (!Array.isArray(report.checks) || report.checks.some(check => check?.status !== 'passed')) {
    throw new Error(`${name} report contains missing or failed checks.`);
  }
  const names = new Set(report.checks.map(check => check?.name));
  if (requiredChecks.some(check => !names.has(check))) throw new Error(`${name} report is missing required checks.`);
};

assertReport('Object storage failover', reports.objectStorage, [
  'dual-write-contract-created',
  'protected-primary-download',
  'primary-stopped',
  'protected-secondary-failover-download',
  'sha256-byte-integrity',
  'primary-restored',
]);
if (reports.objectStorage.scope !== 'formal-cross-domain'
  || reports.objectStorage.providerAdapterVerified !== true
  || !String(reports.objectStorage.failureInjectionId || '').trim()
  || !Number.isFinite(Date.parse(String(reports.objectStorage.topologyObservedAt || '')))
  || !/^[0-9a-f]{64}$/.test(String(reports.objectStorage.sha256 || ''))
  || !Number.isFinite(Number(reports.objectStorage.failoverMs))
  || Number(reports.objectStorage.failoverMs) < 0
  || new Set(reports.objectStorage.failureDomains || []).size < 2) {
  throw new Error('Object storage integrity, failover latency, or failure-domain evidence is invalid.');
}

assertReport('Search failover', reports.searchFailover, [
  'known-order-primary-hit',
  'primary-stopped',
  'known-order-secondary-hit',
  'surviving-provider-query',
  'primary-restored',
]);
if (reports.searchFailover.scope !== 'formal-cross-domain'
  || reports.searchFailover.providerAdapterVerified !== true
  || !String(reports.searchFailover.failureInjectionId || '').trim()
  || !Number.isFinite(Date.parse(String(reports.searchFailover.topologyObservedAt || '')))
  || !Number.isFinite(Number(reports.searchFailover.failoverMs))
  || Number(reports.searchFailover.failoverMs) < 0
  || new Set(reports.searchFailover.failureDomains || []).size < 2) {
  throw new Error('Search failover latency or failure-domain evidence is invalid.');
}

assertReport('Search restore', reports.searchRestore, [
  'primary-index-evidence',
  'provider-backup-started',
  'provider-backup-completed',
  'isolated-restore-started',
  'isolated-restore-ready',
  'restored-document-counts',
  'restored-query-equivalence',
  'isolated-restore-cleanup',
]);
if (reports.searchRestore.scope !== 'formal-isolated-provider-restore'
  || reports.searchRestore.providerAdapterVerified !== true
  || !String(reports.searchRestore.dumpUid || '').trim()
  || !String(reports.searchRestore.restoreResourceId || '').trim()
  || reports.searchRestore.cleanupVerified !== true) {
  throw new Error('Search restore report has no formal isolated restore evidence.');
}

const binding = {
  environment: evidence.environment,
  evidenceId: evidence.evidenceId,
  commitSha: evidence.commitSha,
  imageDigest: evidence.imageDigest,
  verifiedAt: new Date().toISOString(),
  objectStorageReportSha256: hashes.objectStorage,
  searchFailoverReportSha256: hashes.searchFailover,
  searchRestoreReportSha256: hashes.searchRestore,
};
if (bind) {
  evidence.objectStorage = {
    ...evidence.objectStorage,
    crossFailureDomainDurability: true,
    applicationReadFailover: true,
    writeReadback: true,
    reportSha256: hashes.objectStorage,
  };
  evidence.search = {
    ...evidence.search,
    applicationFallback: true,
    indexRecoveryReadback: true,
    backupRestoreReadback: true,
    failoverReportSha256: hashes.searchFailover,
    restoreReportSha256: hashes.searchRestore,
  };
  evidence.storageSearchDrill = { status: 'passed', ...binding };
  const temporary = `${evidencePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, evidencePath);
} else {
  const current = evidence.storageSearchDrill;
  if (current?.status !== 'passed'
    || current?.environment !== binding.environment
    || current?.evidenceId !== binding.evidenceId
    || current?.commitSha !== binding.commitSha
    || current?.imageDigest !== binding.imageDigest
    || current?.objectStorageReportSha256 !== binding.objectStorageReportSha256
    || current?.searchFailoverReportSha256 !== binding.searchFailoverReportSha256
    || current?.searchRestoreReportSha256 !== binding.searchRestoreReportSha256
    || evidence.objectStorage?.reportSha256 !== hashes.objectStorage
    || evidence.search?.failoverReportSha256 !== hashes.searchFailover
    || evidence.search?.restoreReportSha256 !== hashes.searchRestore) {
    throw new Error('Enterprise evidence is not bound to the storage and search reports.');
  }
}
console.log('Storage and search resilience evidence: PASSED');
