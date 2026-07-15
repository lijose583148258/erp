const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const valueFor = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
};
const bundleValue = valueFor('--bundle');
if (!bundleValue) throw new Error('Missing --bundle.');
const bundlePath = path.resolve(bundleValue);
if (!fs.existsSync(bundlePath) || !fs.statSync(bundlePath).isFile()) throw new Error('Admission bundle manifest does not exist.');
const bundleRoot = fs.realpathSync(path.dirname(bundlePath));
const manifest = JSON.parse(fs.readFileSync(bundlePath, 'utf8').replace(/^\uFEFF/, ''));
if (manifest.schemaVersion !== 1) throw new Error('Unsupported admission bundle schemaVersion.');
if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(String(manifest.namespace || ''))) {
  throw new Error('Admission namespace is invalid.');
}
const artifactTypes = {
  evidence: 'file',
  providerProfile: 'file',
  preflightReport: 'file',
  continuousReport: 'file',
  pilotLedger: 'file',
  dailyReportsDir: 'directory',
  backupReport: 'file',
  resilienceReportsDir: 'directory',
  observabilityReport: 'file',
  loadReconciliationReportsDir: 'directory',
  aiReportsDir: 'directory',
  securityReportsDir: 'directory',
};
const exactKeys = (value, expected, label) => {
  const actual = Object.keys(value || {}).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new Error(`${label} contains missing or unsupported fields.`);
  }
};
exactKeys(manifest, ['schemaVersion', 'namespace', 'release', 'artifacts'], 'Admission bundle');
exactKeys(manifest.release, ['environment', 'evidenceId', 'commitSha', 'imageDigest'], 'Admission release');
exactKeys(manifest.artifacts, Object.keys(artifactTypes), 'Admission artifacts');

const resolved = {};
for (const [key, expectedType] of Object.entries(artifactTypes)) {
  const relative = manifest.artifacts?.[key];
  if (typeof relative !== 'string' || !relative.trim() || path.isAbsolute(relative)) {
    throw new Error(`Artifact ${key} must be a non-empty relative path.`);
  }
  const candidate = path.resolve(bundleRoot, relative);
  if (!candidate.startsWith(`${bundleRoot}${path.sep}`)) throw new Error(`Artifact ${key} escapes the bundle root.`);
  if (!fs.existsSync(candidate)) throw new Error(`Artifact ${key} does not exist.`);
  const real = fs.realpathSync(candidate);
  if (!real.startsWith(`${bundleRoot}${path.sep}`)) throw new Error(`Artifact ${key} resolves outside the bundle root.`);
  const stats = fs.statSync(real);
  if (expectedType === 'file' ? !stats.isFile() : !stats.isDirectory()) {
    throw new Error(`Artifact ${key} is not a ${expectedType}.`);
  }
  resolved[key] = real;
}
const evidence = JSON.parse(fs.readFileSync(resolved.evidence, 'utf8').replace(/^\uFEFF/, ''));
const release = manifest.release || {};
if (release.environment !== evidence.environment || release.evidenceId !== evidence.evidenceId
  || release.commitSha !== evidence.commitSha || release.imageDigest !== evidence.imageDigest
  || !/^[0-9a-f]{40}$/.test(String(release.commitSha || ''))
  || !/^sha256:[0-9a-f]{64}$/.test(String(release.imageDigest || ''))) {
  throw new Error('Admission bundle release identity does not match enterprise evidence.');
}
const providerProfile = JSON.parse(fs.readFileSync(resolved.providerProfile, 'utf8').replace(/^\uFEFF/, ''));
if (providerProfile.environment !== release.environment) {
  throw new Error('Provider profile environment does not match the admission release.');
}
const providerVerifier = path.join(__dirname, 'verify-formal-pilot-provider-profile.cjs');
const providerOutput = execFileSync(process.execPath, [providerVerifier, resolved.providerProfile, '--evidence', resolved.evidence], {
  cwd: bundleRoot,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
}).trim();
const providerSummary = JSON.parse(providerOutput);
if (providerSummary.status !== 'passed' || providerSummary.environment !== release.environment) {
  throw new Error('Provider profile verification did not pass for this release environment.');
}
const preflightVerifier = path.join(__dirname, 'verify-formal-pilot-preflight-evidence.cjs');
const preflightOutput = execFileSync(process.execPath, [
  preflightVerifier,
  '--report', resolved.preflightReport,
  '--evidence', resolved.evidence,
  '--provider-profile', resolved.providerProfile,
], {
  cwd: bundleRoot,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
}).trim();
const preflightSummary = JSON.parse(preflightOutput);
if (preflightSummary.status !== 'passed'
  || preflightSummary.providerProfileSha256 !== providerSummary.providerProfileSha256) {
  throw new Error('Formal preflight evidence verification did not pass.');
}
const preflightReport = JSON.parse(fs.readFileSync(resolved.preflightReport, 'utf8').replace(/^\uFEFF/, ''));
if (evidence.haDrill?.providerProfileSha256 !== providerSummary.providerProfileSha256) {
  throw new Error('HA drill is not bound to the approved provider profile.');
}
for (const name of ['postgres', 'redis']) {
  const expectedSha256 = providerSummary.adapters?.[name]?.sha256;
  if (!expectedSha256
    || evidence.haDrill?.adapterSha256?.[name] !== expectedSha256
    || preflightReport.adapterSha256?.[name] !== expectedSha256) {
    throw new Error(`HA drill adapter identity mismatch: ${name}.`);
  }
}
const backupReport = JSON.parse(fs.readFileSync(resolved.backupReport, 'utf8').replace(/^\uFEFF/, ''));
const expectedBackupAdapterSha256 = providerSummary.adapters?.backup?.sha256;
if (!expectedBackupAdapterSha256
  || evidence.backupDrill?.providerProfileSha256 !== providerSummary.providerProfileSha256
  || evidence.backupDrill?.adapterSha256?.backup !== expectedBackupAdapterSha256
  || backupReport.providerProfileSha256 !== providerSummary.providerProfileSha256
  || backupReport.adapterSha256?.backup !== expectedBackupAdapterSha256
  || preflightReport.adapterSha256?.backup !== expectedBackupAdapterSha256) {
  throw new Error('Backup drill adapter identity does not match profile, preflight, report, and evidence.');
}
const artifactSummary = Object.fromEntries(Object.entries(manifest.artifacts)
  .filter(([key]) => Object.hasOwn(artifactTypes, key))
  .map(([key, value]) => [key, value]));
if (args.includes('--check-only')) {
  console.log(JSON.stringify({
    status: 'valid',
    namespace: manifest.namespace,
    release,
    provider: providerSummary,
    preflight: preflightSummary,
    artifacts: artifactSummary,
  }, null, 2));
  process.exit(0);
}

const admissionScript = path.join(__dirname, 'verify-enterprise-production-admission.sh');
execFileSync('bash', [
  admissionScript,
  manifest.namespace,
  resolved.evidence,
  resolved.continuousReport,
  resolved.pilotLedger,
  resolved.dailyReportsDir,
  resolved.backupReport,
  resolved.resilienceReportsDir,
  resolved.observabilityReport,
  resolved.loadReconciliationReportsDir,
  resolved.aiReportsDir,
  resolved.securityReportsDir,
], {
  cwd: bundleRoot,
  encoding: 'utf8',
  stdio: ['ignore', 'inherit', 'inherit'],
});
