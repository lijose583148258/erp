const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const valueFor = name => {
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || '').trim() : '';
};
const fail = message => { throw new Error(message); };
const readFile = (flag, label) => {
  const value = valueFor(flag);
  if (!value) fail(`${flag} is required.`);
  const file = path.resolve(value);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`${label} does not exist.`);
  return file;
};
const readJson = file => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { fail(`${path.basename(file)} is invalid JSON.`); }
};
const exactKeys = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} contains missing or unsupported fields.`);
  }
};
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const reportPath = readFile('--report', 'NetworkPolicy enforcement report');
const evidencePath = readFile('--evidence', 'Enterprise evidence');
const providerProfilePath = readFile('--provider-profile', 'Provider profile');
const maxAgeSeconds = Number(valueFor('--max-age-seconds') || 86400);
if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 300 || maxAgeSeconds > 604800) {
  fail('Maximum report age must be an integer from 300 to 604800 seconds.');
}

const report = readJson(reportPath);
const evidence = readJson(evidencePath);
exactKeys(report, [
  'schemaVersion', 'status', 'drill', 'outcome', 'environment', 'evidenceId', 'commitSha', 'imageDigest',
  'providerProfileSha256', 'applicationNamespace', 'probeNamespace', 'networkPolicy', 'probeImage',
  'serviceName', 'serviceClusterIpSha256', 'servicePort', 'readyEndpointCount', 'startedAt', 'finishedAt',
  'cleanupVerified',
], 'NetworkPolicy enforcement report');
if (report.schemaVersion !== 1 || report.status !== 'passed'
  || report.drill !== 'kubernetes-network-policy-enforcement'
  || report.outcome !== 'unauthorized-service-connect-timed-out'
  || report.cleanupVerified !== true
  || report.serviceName !== 'ailaoda-app'
  || report.servicePort !== 80
  || !Number.isInteger(report.readyEndpointCount) || report.readyEndpointCount < 1
  || !/^[0-9a-f]{64}$/.test(String(report.serviceClusterIpSha256 || ''))) {
  fail('NetworkPolicy enforcement outcome is incomplete or failed.');
}
const started = Date.parse(String(report.startedAt || ''));
const finished = Date.parse(String(report.finishedAt || ''));
const now = Date.now();
if (!Number.isFinite(started) || !Number.isFinite(finished) || started > finished
  || finished > now + 300000 || now - finished > maxAgeSeconds * 1000 || finished - started > 600000) {
  fail('NetworkPolicy enforcement report timestamps are invalid, stale, or too long-running.');
}

const providerVerifier = path.join(__dirname, 'verify-formal-pilot-provider-profile.cjs');
const provider = JSON.parse(execFileSync(process.execPath, [
  providerVerifier, providerProfilePath, '--evidence', evidencePath,
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], timeout: 30000 }));
for (const key of ['environment', 'evidenceId', 'commitSha', 'imageDigest']) {
  if (report[key] !== evidence[key]) fail(`NetworkPolicy report release identity mismatch: ${key}.`);
}
if (report.providerProfileSha256 !== provider.providerProfileSha256
  || report.applicationNamespace !== provider.applicationNamespace
  || report.probeNamespace !== provider.recoveryNamespace
  || report.networkPolicy !== provider.applicationNetworkPolicy?.name
  || report.probeImage !== provider.applicationNetworkPolicy?.probeImage) {
  fail('NetworkPolicy report does not match the provider-approved runtime boundary.');
}
exactKeys(evidence.networkPolicyEnforcement, [
  'status', 'environment', 'evidenceId', 'commitSha', 'imageDigest', 'providerProfileSha256',
  'reportSha256', 'finishedAt',
], 'evidence.networkPolicyEnforcement');
const binding = evidence.networkPolicyEnforcement;
if (binding.status !== 'passed' || binding.environment !== report.environment
  || binding.evidenceId !== report.evidenceId || binding.commitSha !== report.commitSha
  || binding.imageDigest !== report.imageDigest || binding.providerProfileSha256 !== report.providerProfileSha256
  || binding.finishedAt !== report.finishedAt
  || binding.reportSha256 !== sha256(fs.readFileSync(reportPath))) {
  fail('NetworkPolicy report hash is not bound to enterprise evidence.');
}

process.stdout.write(`${JSON.stringify({
  status: 'passed', environment: report.environment, evidenceId: report.evidenceId,
  providerProfileSha256: report.providerProfileSha256,
  reportSha256: binding.reportSha256, finishedAt: report.finishedAt,
  ageSeconds: Math.floor((now - finished) / 1000),
})}\n`);
