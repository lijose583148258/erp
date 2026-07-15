const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const verifier = path.join(__dirname, 'verify-formal-pilot-provider-profile.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ailaoda-provider-profile-'));
const valid = {
  schemaVersion: 1,
  environment: 'formal-pilot',
  platform: {
    kind: 'kubernetes-native',
    failureDomains: ['zone-a', 'zone-b', 'zone-c'],
    applicationNamespace: 'ailaoda-pilot',
    recoveryNamespace: 'ailaoda-pilot-recovery',
  },
  postgresql: {
    kind: 'cloudnativepg',
    instances: 3,
    haAdapter: 'cnpg-ha-adapter.cjs',
    backup: {
      method: 'barman-object-store',
      encrypted: true,
      checksumEvidence: 'barman-manifest',
      isolatedRestore: true,
    },
  },
  redis: {
    kind: 'sentinel',
    dataInstances: 3,
    sentinelCount: 3,
    haAdapter: 'redis-kubernetes-ha-adapter.cjs',
  },
  objectStorage: {
    kind: 'minio-distributed',
    dataPods: 4,
    haAdapter: 'minio-kubernetes-object-adapter.cjs',
    pvcDeletePermission: false,
  },
  search: {
    kind: 'meilisearch',
    servingInstances: 2,
    backupMethod: 'dump-to-object-store',
    isolatedRestore: true,
    restoreNamespace: 'ailaoda-pilot-recovery',
  },
  observability: {
    traceBackend: 'tempo',
    alertRoute: 'pilot-operations',
    deliveryReceiptStore: 'webhook-audit-store',
  },
  ai: {
    mode: 'local-only',
    externalGateway: false,
    paidCallBudget: 0,
  },
  observation: {
    continuousHours: 8,
    pilotDays: 7,
  },
};
const run = (name, value) => {
  const file = path.join(root, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(value));
  return spawnSync(process.execPath, [verifier, file], { encoding: 'utf8' });
};
const clone = value => JSON.parse(JSON.stringify(value));

try {
  const accepted = run('valid', valid);
  assert.equal(accepted.status, 0, accepted.stderr);
  const summary = JSON.parse(accepted.stdout);
  assert.equal(summary.status, 'passed');
  assert.equal(summary.failureDomainCount, 3);
  assert.equal(summary.paidCallBudget, 0);

  const boundProfilePath = path.join(root, 'bound-profile.json');
  const evidencePath = path.join(root, 'evidence.json');
  fs.writeFileSync(boundProfilePath, JSON.stringify(valid));
  fs.writeFileSync(evidencePath, JSON.stringify({ environment: 'formal-pilot' }));
  const bind = spawnSync(process.execPath, [
    verifier, boundProfilePath, '--evidence', evidencePath, '--bind',
  ], { encoding: 'utf8' });
  assert.equal(bind.status, 0, bind.stderr);
  const boundEvidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  assert.equal(boundEvidence.providerProfile.status, 'passed');
  assert.match(boundEvidence.providerProfile.sha256, /^[0-9a-f]{64}$/);
  const recheck = spawnSync(process.execPath, [
    verifier, boundProfilePath, '--evidence', evidencePath,
  ], { encoding: 'utf8' });
  assert.equal(recheck.status, 0, recheck.stderr);
  const tamperedProfile = clone(valid);
  tamperedProfile.observation.continuousHours = 9;
  fs.writeFileSync(boundProfilePath, JSON.stringify(tamperedProfile));
  const tampered = spawnSync(process.execPath, [
    verifier, boundProfilePath, '--evidence', evidencePath,
  ], { encoding: 'utf8' });
  assert.notEqual(tampered.status, 0);

  const production = clone(valid);
  production.environment = 'production';
  assert.notEqual(run('production', production).status, 0);

  const inlineSecret = clone(valid);
  inlineSecret.observability.apiKey = 'forbidden';
  assert.notEqual(run('inline-secret', inlineSecret).status, 0);

  const sameNamespace = clone(valid);
  sameNamespace.platform.recoveryNamespace = sameNamespace.platform.applicationNamespace;
  sameNamespace.search.restoreNamespace = sameNamespace.platform.applicationNamespace;
  assert.notEqual(run('same-namespace', sameNamespace).status, 0);

  const unverifiedBackup = clone(valid);
  unverifiedBackup.postgresql.backup.checksumEvidence = 'manual';
  assert.notEqual(run('unverified-backup', unverifiedBackup).status, 0);

  const paidAi = clone(valid);
  paidAi.ai.externalGateway = true;
  paidAi.ai.paidCallBudget = 1;
  assert.notEqual(run('paid-ai', paidAi).status, 0);

  const shortObservation = clone(valid);
  shortObservation.observation.continuousHours = 2;
  assert.notEqual(run('short-observation', shortObservation).status, 0);

  console.log('Formal pilot provider profile contract: PASSED');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
