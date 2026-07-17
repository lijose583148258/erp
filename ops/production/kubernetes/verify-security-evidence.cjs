const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const valueFor = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
};
const reportsDir = path.resolve(valueFor('--reports-dir') || '');
const evidencePath = path.resolve(valueFor('--evidence') || '');
if (!valueFor('--reports-dir') || !fs.existsSync(reportsDir) || !fs.statSync(reportsDir).isDirectory()) {
  throw new Error('Security reports directory does not exist.');
}
if (!valueFor('--evidence') || !fs.existsSync(evidencePath) || !fs.statSync(evidencePath).isFile()) {
  throw new Error('Enterprise evidence file does not exist.');
}
const files = {
  readiness: path.join(reportsDir, 'security-production-readiness-v1.json'),
  credentials: path.join(reportsDir, 'default-credential-release-gate-v1.json'),
};
for (const [name, file] of Object.entries(files)) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`${name} security report does not exist.`);
}
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const evidence = read(evidencePath);
const reports = { readiness: read(files.readiness), credentials: read(files.credentials) };
const hashes = Object.fromEntries(Object.entries(files).map(([name, file]) => [
  name,
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
]));
const identityMatches = report => report.environment === evidence.environment
  && report.evidenceId === evidence.evidenceId
  && report.commitSha === evidence.commitSha
  && report.imageDigest === evidence.imageDigest;
const assertFresh = (name, report) => {
  const generatedMs = Date.parse(String(report.generatedAt || ''));
  const ageMs = Date.now() - generatedMs;
  if (!Number.isFinite(generatedMs) || ageMs < -300_000 || ageMs > 24 * 3_600_000
    || report.status !== 'passed' || !identityMatches(report)) {
    throw new Error(`${name} report is stale, failed, or belongs to another release.`);
  }
};

assertFresh('Security readiness', reports.readiness);
const requiredSteps = ['csp', 'csrf-boundary', 'mfa', 'secrets', 'distributed-auth', 'dependencies'];
const steps = new Map((reports.readiness.steps || []).map(step => [step.id, step]));
if (steps.size !== requiredSteps.length || requiredSteps.some(id => {
  const step = steps.get(id);
  return step?.status !== 'passed' || Number(step?.exitCode) !== 0
    || !/^[0-9a-f]{64}$/.test(String(step?.stdoutSha256 || ''))
    || !/^[0-9a-f]{64}$/.test(String(step?.stderrSha256 || ''));
}) || reports.readiness.failedStep !== null
  || JSON.stringify(reports.readiness).includes('"stdout":')
  || JSON.stringify(reports.readiness).includes('"stderr":')) {
  throw new Error('Security readiness does not prove all six redacted controls.');
}

assertFresh('Default credentials', reports.credentials);
const expectedUsers = ['admin', 'manager', 'sales', 'warehouse', 'finance'];
const results = new Map((reports.credentials.results || []).map(result => [result.username, result]));
if (reports.credentials.strictMode !== true || results.size !== expectedUsers.length
  || expectedUsers.some(username => {
    const result = results.get(username);
    return !result || result.accepted !== false || result.businessAccess !== false
      || result.transportVerified !== true || result.explicitRejection !== true
      || ![400, 401, 403].includes(Number(result.statusCode));
  }) || (reports.credentials.findings || []).some(finding => finding?.level === 'P0')) {
  throw new Error('Default credential gate did not reject every release credential.');
}

const binding = {
  status: 'passed',
  environment: evidence.environment,
  evidenceId: evidence.evidenceId,
  commitSha: evidence.commitSha,
  imageDigest: evidence.imageDigest,
  verifiedAt: new Date().toISOString(),
  cspPassed: true,
  csrfBoundaryPassed: true,
  mfaPassed: true,
  secretsPassed: true,
  distributedAuthPassed: true,
  dependencyAuditPassed: true,
  defaultCredentialsRejected: true,
  readinessReportSha256: hashes.readiness,
  defaultCredentialReportSha256: hashes.credentials,
};
if (args.includes('--bind')) {
  evidence.securityDrill = binding;
  const temporary = `${evidencePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, evidencePath);
} else {
  const current = evidence.securityDrill;
  for (const [key, value] of Object.entries(binding)) {
    if (key === 'verifiedAt') continue;
    if (current?.[key] !== value) throw new Error('Enterprise evidence is not bound to the security reports.');
  }
}
console.log('Security release evidence: PASSED');
