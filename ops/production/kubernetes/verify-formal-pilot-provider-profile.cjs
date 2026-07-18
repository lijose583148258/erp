const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const profileValue = args[0] || '';
const valueFor = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
};
const evidenceValue = valueFor('--evidence');
const bind = args.includes('--bind');
const fail = message => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};
if (!profileValue) fail('Usage: node verify-formal-pilot-provider-profile.cjs <profile.json>');
const profilePath = path.resolve(profileValue);
if (!fs.existsSync(profilePath) || !fs.statSync(profilePath).isFile()) fail('Provider profile does not exist.');

let profile;
try {
  profile = JSON.parse(fs.readFileSync(profilePath, 'utf8').replace(/^\uFEFF/, ''));
} catch {
  fail('Provider profile is not valid JSON.');
}
const requireObject = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  return value;
};
const requireKeys = (value, keys, label) => {
  requireObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} must contain exactly: ${expected.join(', ')}.`);
  }
};
const requireString = (value, label) => {
  const text = String(value || '').trim();
  if (!text) fail(`${label} is required.`);
  if (/replace|changeme|example/i.test(text)) fail(`${label} still contains a placeholder.`);
  return text;
};
const requireDns = (value, label) => {
  const text = requireString(value, label);
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(text)) fail(`${label} must be a DNS label.`);
  return text;
};
const requireHostname = (value, label) => {
  const text = requireString(value, label).toLowerCase();
  if (text.length > 253 || text.endsWith('.') || !text.includes('.')
    || text.split('.').some(part => !/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(part))
    || /\.(invalid|example|test|localhost)$/.test(text)) {
    fail(`${label} must be a real lowercase DNS hostname.`);
  }
  return text;
};
const requireInteger = (value, minimum, label) => {
  if (!Number.isInteger(value) || value < minimum) fail(`${label} must be an integer >= ${minimum}.`);
};
const rejectSensitiveFields = (value, location = 'profile') => {
  if (Array.isArray(value)) return value.forEach((entry, index) => rejectSensitiveFields(entry, `${location}[${index}]`));
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (/(password|token|credential|api[-_]?key|secret(value|key)?)/i.test(key)) {
      fail(`${location} contains forbidden secret-like field ${key}; keep credentials in the secret manager.`);
    }
    rejectSensitiveFields(entry, `${location}.${key}`);
  }
};

rejectSensitiveFields(profile);
requireKeys(profile, [
  'schemaVersion', 'environment', 'platform', 'adapters', 'postgresql', 'redis',
  'objectStorage', 'search', 'observability', 'ai', 'observation', 'approvals',
], 'profile');
if (profile.schemaVersion !== 2) fail('Unsupported provider profile schemaVersion; ingress-bound schemaVersion 2 is required.');
const environment = requireString(profile.environment, 'environment');
if (/prod/i.test(environment)) fail('Provider profile is restricted to staging or formal pilot.');

requireKeys(profile.platform, [
  'kind', 'failureDomains', 'applicationNamespace', 'recoveryNamespace', 'applicationIngress',
], 'platform');
if (profile.platform.kind !== 'kubernetes-native') fail('platform.kind must be kubernetes-native.');
const domains = [...new Set((profile.platform.failureDomains || []).map(value => requireString(value, 'failure domain')))];
if (domains.length < 3) fail('At least three provider-observed failure domains are required.');
const applicationNamespace = requireDns(profile.platform.applicationNamespace, 'platform.applicationNamespace');
const recoveryNamespace = requireDns(profile.platform.recoveryNamespace, 'platform.recoveryNamespace');
if (applicationNamespace === recoveryNamespace) fail('Recovery resources require a dedicated namespace.');
requireKeys(profile.platform.applicationIngress, ['name', 'className', 'publicHost'], 'platform.applicationIngress');
const applicationIngress = {
  name: requireDns(profile.platform.applicationIngress.name, 'platform.applicationIngress.name'),
  className: requireDns(profile.platform.applicationIngress.className, 'platform.applicationIngress.className'),
  publicHost: requireHostname(profile.platform.applicationIngress.publicHost, 'platform.applicationIngress.publicHost'),
};

requireKeys(profile.adapters, [
  'postgres', 'redis', 'objectStorage', 'search', 'backup', 'observability',
], 'adapters');
const adapterBindings = {};
for (const [name, binding] of Object.entries(profile.adapters)) {
  requireKeys(binding, ['fileName', 'sha256'], `adapters.${name}`);
  const fileName = requireString(binding.fileName, `adapters.${name}.fileName`);
  if (path.basename(fileName) !== fileName || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(fileName)) {
    fail(`adapters.${name}.fileName must be a plain file name.`);
  }
  const sha256 = String(binding.sha256 || '').trim();
  if (!/^[0-9a-f]{64}$/.test(sha256)) fail(`adapters.${name}.sha256 must be a lowercase SHA-256.`);
  adapterBindings[name] = { fileName, sha256 };
}

requireKeys(profile.postgresql, ['kind', 'instances', 'haAdapter', 'backup'], 'postgresql');
if (profile.postgresql.kind !== 'cloudnativepg') fail('postgresql.kind must be cloudnativepg.');
requireInteger(profile.postgresql.instances, 3, 'postgresql.instances');
if (profile.postgresql.haAdapter !== adapterBindings.postgres.fileName) fail('PostgreSQL adapter binding mismatch.');
requireKeys(profile.postgresql.backup, [
  'method', 'encrypted', 'checksumEvidence', 'isolatedRestore', 'receiptVerifier',
], 'postgresql.backup');
if (!['barman-object-store', 'csi-volume-snapshot'].includes(profile.postgresql.backup.method)) {
  fail('Unsupported PostgreSQL backup method.');
}
if (profile.postgresql.backup.encrypted !== true) fail('PostgreSQL backups must be encrypted.');
if (!['barman-manifest', 'provider-checksum'].includes(profile.postgresql.backup.checksumEvidence)) {
  fail('PostgreSQL backup checksum evidence must come from Barman or the provider.');
}
if (profile.postgresql.backup.isolatedRestore !== true) fail('PostgreSQL restore must be isolated.');
requireKeys(profile.postgresql.backup.receiptVerifier, [
  'mode', 'issuer', 'publicKeySha256', 'serviceFileName', 'serviceSha256',
], 'postgresql.backup.receiptVerifier');
if (profile.postgresql.backup.receiptVerifier.mode !== 'ed25519-provider-signed') {
  fail('PostgreSQL backup receipts must be Ed25519 provider-signed.');
}
const receiptIssuer = requireString(
  profile.postgresql.backup.receiptVerifier.issuer,
  'postgresql.backup.receiptVerifier.issuer',
);
if (receiptIssuer.length > 128) fail('PostgreSQL backup receipt issuer is too long.');
const receiptPublicKeySha256 = String(profile.postgresql.backup.receiptVerifier.publicKeySha256 || '').trim();
const receiptServiceSha256 = String(profile.postgresql.backup.receiptVerifier.serviceSha256 || '').trim();
if (!/^[0-9a-f]{64}$/.test(receiptPublicKeySha256)
  || !/^[0-9a-f]{64}$/.test(receiptServiceSha256)) {
  fail('PostgreSQL backup receipt public key and service require lowercase SHA-256 values.');
}
const receiptServiceFileName = requireString(
  profile.postgresql.backup.receiptVerifier.serviceFileName,
  'postgresql.backup.receiptVerifier.serviceFileName',
);
if (path.basename(receiptServiceFileName) !== receiptServiceFileName
  || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(receiptServiceFileName)) {
  fail('PostgreSQL backup receipt service file name must be plain.');
}

if (adapterBindings.backup.fileName === 'cnpg-backup-adapter.cjs'
  && profile.postgresql.backup.method !== 'barman-object-store') {
  fail('cnpg-backup-adapter.cjs requires the Barman object-store backup profile.');
}

requireKeys(profile.redis, ['kind', 'dataInstances', 'sentinelCount', 'haAdapter'], 'redis');
if (profile.redis.kind !== 'sentinel') fail('redis.kind must be sentinel.');
requireInteger(profile.redis.dataInstances, 3, 'redis.dataInstances');
requireInteger(profile.redis.sentinelCount, 3, 'redis.sentinelCount');
if (profile.redis.haAdapter !== adapterBindings.redis.fileName) fail('Redis adapter binding mismatch.');

requireKeys(profile.objectStorage, [
  'kind', 'dataPods', 'haAdapter', 'pvcDeletePermission',
], 'objectStorage');
if (profile.objectStorage.kind !== 'minio-distributed') fail('objectStorage.kind must be minio-distributed.');
requireInteger(profile.objectStorage.dataPods, 4, 'objectStorage.dataPods');
if (profile.objectStorage.haAdapter !== adapterBindings.objectStorage.fileName) fail('Object-storage adapter binding mismatch.');
if (profile.objectStorage.pvcDeletePermission !== false) fail('Object drill identity must not have PVC delete permission.');

requireKeys(profile.search, [
  'kind', 'servingInstances', 'backupMethod', 'isolatedRestore',
  'restoreNamespace',
], 'search');
if (profile.search.kind !== 'meilisearch') fail('search.kind must be meilisearch.');
requireInteger(profile.search.servingInstances, 2, 'search.servingInstances');
if (!['dump-to-object-store', 'csi-volume-snapshot'].includes(profile.search.backupMethod)) {
  fail('Unsupported search backup method.');
}
if (profile.search.isolatedRestore !== true) fail('Search restore must be isolated.');
if (adapterBindings.search.fileName === 'meilisearch-kubernetes-search-adapter.cjs'
  && profile.search.backupMethod !== 'csi-volume-snapshot') {
  fail('meilisearch-kubernetes-search-adapter.cjs requires the CSI volume-snapshot profile.');
}
if (requireDns(profile.search.restoreNamespace, 'search.restoreNamespace') !== recoveryNamespace) {
  fail('Search restore must use the dedicated recovery namespace.');
}

requireKeys(profile.observability, [
  'traceBackend', 'alertRoute', 'deliveryReceiptStore',
], 'observability');
if (!['tempo', 'jaeger', 'otel-compatible'].includes(profile.observability.traceBackend)) {
  fail('Unsupported trace backend.');
}
requireString(profile.observability.alertRoute, 'observability.alertRoute');
if (!['webhook-audit-store', 'ticketing-audit-store', 'provider-notification-audit'].includes(profile.observability.deliveryReceiptStore)) {
  fail('A real receiver-side alert delivery receipt store is required.');
}

requireKeys(profile.ai, ['mode', 'externalGateway', 'paidCallBudget'], 'ai');
if (profile.ai.mode !== 'local-only' || profile.ai.externalGateway !== false || profile.ai.paidCallBudget !== 0) {
  fail('Formal pilot AI must remain local-only with zero paid-call budget.');
}
requireKeys(profile.observation, ['continuousHours', 'pilotDays', 'collectorImageDigest'], 'observation');
if (typeof profile.observation.continuousHours !== 'number'
  || profile.observation.continuousHours < 8 || profile.observation.continuousHours > 24) {
  fail('observation.continuousHours must be between 8 and 24.');
}
requireInteger(profile.observation.pilotDays, 7, 'observation.pilotDays');
const collectorImageDigest = requireString(profile.observation.collectorImageDigest, 'observation.collectorImageDigest');
if (!/^sha256:[0-9a-f]{64}$/.test(collectorImageDigest)) fail('observation.collectorImageDigest must be immutable.');

const approvalRoles = ['platformOwner', 'databaseOwner', 'securityOwner', 'businessPilotOwner'];
requireKeys(profile.approvals, approvalRoles, 'approvals');
const approvalBindings = {};
for (const role of approvalRoles) {
  const binding = profile.approvals[role];
  requireKeys(binding, ['issuer', 'publicKeyFile', 'publicKeySha256'], `approvals.${role}`);
  const issuer = requireString(binding.issuer, `approvals.${role}.issuer`);
  if (issuer.length > 128) fail(`approvals.${role}.issuer is too long.`);
  const publicKeyFile = requireString(binding.publicKeyFile, `approvals.${role}.publicKeyFile`);
  if (path.basename(publicKeyFile) !== publicKeyFile || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(publicKeyFile)) {
    fail(`approvals.${role}.publicKeyFile must be a plain file name.`);
  }
  const publicKeySha256 = String(binding.publicKeySha256 || '').trim();
  if (!/^[0-9a-f]{64}$/.test(publicKeySha256)) fail(`approvals.${role}.publicKeySha256 must be a lowercase SHA-256.`);
  approvalBindings[role] = { issuer, publicKeyFile, publicKeySha256 };
}
if (new Set(Object.values(approvalBindings).map(binding => binding.publicKeySha256)).size !== approvalRoles.length) {
  fail('Each production approval role requires a distinct public key.');
}

const providerProfileSha256 = crypto.createHash('sha256').update(fs.readFileSync(profilePath)).digest('hex');
if (bind && !evidenceValue) fail('--bind requires --evidence.');
if (evidenceValue) {
  const evidencePath = path.resolve(evidenceValue);
  if (!fs.existsSync(evidencePath) || !fs.statSync(evidencePath).isFile()) fail('Enterprise evidence does not exist.');
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8').replace(/^\uFEFF/, ''));
  if (evidence.environment !== environment) fail('Provider profile environment does not match enterprise evidence.');
  if (bind) {
    evidence.providerProfile = {
      status: 'passed',
      environment,
      sha256: providerProfileSha256,
      verifiedAt: new Date().toISOString(),
    };
    const temporary = `${evidencePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, evidencePath);
  } else if (evidence.providerProfile?.status !== 'passed'
    || evidence.providerProfile?.environment !== environment
    || evidence.providerProfile?.sha256 !== providerProfileSha256
    || !Number.isFinite(Date.parse(String(evidence.providerProfile?.verifiedAt || '')))) {
    fail('Provider profile is not hash-bound to enterprise evidence.');
  }
}
process.stdout.write(`${JSON.stringify({
  status: 'passed',
  environment,
  platform: profile.platform.kind,
  failureDomainCount: domains.length,
  applicationNamespace,
  recoveryNamespace,
  applicationIngress,
  aiMode: profile.ai.mode,
  paidCallBudget: profile.ai.paidCallBudget,
  observation: {
    continuousHours: profile.observation.continuousHours,
    pilotDays: profile.observation.pilotDays,
    collectorImageDigest,
  },
  adapters: adapterBindings,
  backupReceiptVerifier: {
    mode: profile.postgresql.backup.receiptVerifier.mode,
    issuer: receiptIssuer,
    publicKeySha256: receiptPublicKeySha256,
    serviceFileName: receiptServiceFileName,
    serviceSha256: receiptServiceSha256,
  },
  approvals: approvalBindings,
  providerProfileSha256,
  evidenceBound: Boolean(evidenceValue),
})}\n`);
