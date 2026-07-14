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
const artifactSummary = Object.fromEntries(Object.entries(manifest.artifacts)
  .filter(([key]) => Object.hasOwn(artifactTypes, key))
  .map(([key, value]) => [key, value]));
if (args.includes('--check-only')) {
  console.log(JSON.stringify({
    status: 'valid',
    namespace: manifest.namespace,
    release,
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
