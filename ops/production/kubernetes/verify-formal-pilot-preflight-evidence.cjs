const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const valueFor = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
};
const fail = message => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};
const readFile = (flag, label) => {
  const value = valueFor(flag);
  if (!value) fail(`Missing ${flag}.`);
  const absolute = path.resolve(value);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) fail(`${label} does not exist.`);
  return absolute;
};
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const reportPath = readFile('--report', 'Formal preflight report');
const evidencePath = readFile('--evidence', 'Enterprise evidence');
const profilePath = readFile('--provider-profile', 'Provider profile');
const report = readJson(reportPath);
const evidence = readJson(evidencePath);
const profile = readJson(profilePath);

if (report.status !== 'passed' || report.mode !== 'read-only') fail('Formal preflight report did not pass in read-only mode.');
for (const field of ['environment', 'evidenceId', 'commitSha', 'imageDigest']) {
  if (report[field] !== evidence[field]) fail(`Formal preflight ${field} does not match enterprise evidence.`);
}
const profileHash = sha256(profilePath);
if (evidence.providerProfile?.status !== 'passed'
  || evidence.providerProfile?.environment !== evidence.environment
  || evidence.providerProfile?.sha256 !== profileHash
  || report.providerProfileSha256 !== profileHash) {
  fail('Formal preflight provider profile binding is invalid.');
}
const expectedAdapters = profile.adapters || {};
const observedAdapters = report.adapterSha256 || {};
const expectedNames = ['postgres', 'redis', 'objectStorage', 'search', 'backup', 'observability'];
if (Object.keys(observedAdapters).length !== expectedNames.length) fail('Formal preflight adapter hash set is incomplete.');
for (const name of expectedNames) {
  const expected = String(expectedAdapters[name]?.sha256 || '');
  if (!/^[0-9a-f]{64}$/.test(expected) || observedAdapters[name] !== expected) {
    fail(`Formal preflight adapter hash mismatch: ${name}.`);
  }
}
const startedAt = Date.parse(String(report.startedAt || ''));
const finishedAt = Date.parse(String(report.finishedAt || ''));
const maxAgeMs = Math.max(60_000, Number(process.env.FORMAL_PREFLIGHT_MAX_AGE_MS || 86_400_000));
if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt)
  || finishedAt < startedAt || finishedAt > Date.now() + 60_000
  || Date.now() - finishedAt > maxAgeMs) {
  fail('Formal preflight report is stale or has invalid timestamps.');
}
const checks = Array.isArray(report.checks) ? report.checks : [];
if (!checks.length || checks.some(check => check?.status !== 'passed')) fail('Formal preflight contains a missing or failed check.');
const names = new Set(checks.map(check => check?.name));
for (const required of [
  'provider-profile-bound',
  'all-adapters-profile-bound',
  'all-adapters-executable',
  'postgres-provider-topology',
  'postgres-preferred-endpoint',
  'redis-provider-topology',
  'redis-preferred-endpoint',
  'objectStorage-provider-topology',
  'objectStorage-preferred-endpoint',
  'search-provider-topology',
  'search-preferred-endpoint',
  'two-distinct-application-instances',
  'least-privilege-audit-login',
  'cross-instance-session-readback',
  'application-search-marker',
  'provider-search-marker-readback',
]) {
  if (!names.has(required)) fail(`Formal preflight required check is missing: ${required}.`);
}
if (checks.filter(check => check?.name === 'application-health-and-readiness').length < 2) {
  fail('Formal preflight must include two healthy application instances.');
}
if (Number(report.topology?.postgresFailureDomains || 0) < 2
  || Number(report.topology?.redisFailureDomains || 0) < 3
  || Number(report.topology?.redisSentinelCount || 0) < 3
  || Number(report.topology?.objectStorageFailureDomains || 0) < 2
  || Number(report.topology?.searchFailureDomains || 0) < 2) {
  fail('Formal preflight topology summary is insufficient.');
}
process.stdout.write(`${JSON.stringify({
  status: 'passed',
  environment: evidence.environment,
  evidenceId: evidence.evidenceId,
  providerProfileSha256: profileHash,
  adapterCount: expectedNames.length,
  checkedAt: new Date().toISOString(),
})}\n`);
