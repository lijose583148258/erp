const fs = require('fs');
const path = require('path');

const profileValue = process.argv[2] || '';
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
  'schemaVersion', 'environment', 'platform', 'postgresql', 'redis',
  'objectStorage', 'search', 'observability', 'ai', 'observation',
], 'profile');
if (profile.schemaVersion !== 1) fail('Unsupported provider profile schemaVersion.');
const environment = requireString(profile.environment, 'environment');
if (/prod/i.test(environment)) fail('Provider profile is restricted to staging or formal pilot.');

requireKeys(profile.platform, [
  'kind', 'failureDomains', 'applicationNamespace', 'recoveryNamespace',
], 'platform');
if (profile.platform.kind !== 'kubernetes-native') fail('platform.kind must be kubernetes-native.');
const domains = [...new Set((profile.platform.failureDomains || []).map(value => requireString(value, 'failure domain')))];
if (domains.length < 3) fail('At least three provider-observed failure domains are required.');
const applicationNamespace = requireDns(profile.platform.applicationNamespace, 'platform.applicationNamespace');
const recoveryNamespace = requireDns(profile.platform.recoveryNamespace, 'platform.recoveryNamespace');
if (applicationNamespace === recoveryNamespace) fail('Recovery resources require a dedicated namespace.');

requireKeys(profile.postgresql, ['kind', 'instances', 'haAdapter', 'backup'], 'postgresql');
if (profile.postgresql.kind !== 'cloudnativepg') fail('postgresql.kind must be cloudnativepg.');
requireInteger(profile.postgresql.instances, 3, 'postgresql.instances');
if (profile.postgresql.haAdapter !== 'cnpg-ha-adapter.cjs') fail('Unexpected PostgreSQL HA adapter.');
requireKeys(profile.postgresql.backup, [
  'method', 'encrypted', 'checksumEvidence', 'isolatedRestore',
], 'postgresql.backup');
if (!['barman-object-store', 'csi-volume-snapshot'].includes(profile.postgresql.backup.method)) {
  fail('Unsupported PostgreSQL backup method.');
}
if (profile.postgresql.backup.encrypted !== true) fail('PostgreSQL backups must be encrypted.');
if (!['barman-manifest', 'provider-checksum'].includes(profile.postgresql.backup.checksumEvidence)) {
  fail('PostgreSQL backup checksum evidence must come from Barman or the provider.');
}
if (profile.postgresql.backup.isolatedRestore !== true) fail('PostgreSQL restore must be isolated.');

requireKeys(profile.redis, ['kind', 'dataInstances', 'sentinelCount', 'haAdapter'], 'redis');
if (profile.redis.kind !== 'sentinel') fail('redis.kind must be sentinel.');
requireInteger(profile.redis.dataInstances, 3, 'redis.dataInstances');
requireInteger(profile.redis.sentinelCount, 3, 'redis.sentinelCount');
if (profile.redis.haAdapter !== 'redis-kubernetes-ha-adapter.cjs') fail('Unexpected Redis HA adapter.');

requireKeys(profile.objectStorage, [
  'kind', 'dataPods', 'haAdapter', 'pvcDeletePermission',
], 'objectStorage');
if (profile.objectStorage.kind !== 'minio-distributed') fail('objectStorage.kind must be minio-distributed.');
requireInteger(profile.objectStorage.dataPods, 4, 'objectStorage.dataPods');
if (profile.objectStorage.haAdapter !== 'minio-kubernetes-object-adapter.cjs') fail('Unexpected object-storage HA adapter.');
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
requireKeys(profile.observation, ['continuousHours', 'pilotDays'], 'observation');
if (typeof profile.observation.continuousHours !== 'number'
  || profile.observation.continuousHours < 8 || profile.observation.continuousHours > 24) {
  fail('observation.continuousHours must be between 8 and 24.');
}
requireInteger(profile.observation.pilotDays, 7, 'observation.pilotDays');

process.stdout.write(`${JSON.stringify({
  status: 'passed',
  environment,
  platform: profile.platform.kind,
  failureDomainCount: domains.length,
  applicationNamespace,
  recoveryNamespace,
  aiMode: profile.ai.mode,
  paidCallBudget: profile.ai.paidCallBudget,
})}\n`);
