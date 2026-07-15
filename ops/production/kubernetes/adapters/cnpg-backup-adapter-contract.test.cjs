const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const adapter = path.join(__dirname, 'cnpg-backup-adapter.cjs');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ailaoda-cnpg-backup-contract-'));
const binDir = path.join(tempRoot, 'bin');
const kubeState = path.join(tempRoot, 'kube');
const adapterState = path.join(tempRoot, 'adapter');
const tokenFile = path.join(tempRoot, 'receipt-token');
const templateFile = path.join(tempRoot, 'restore-template.json');
const readyFile = path.join(tempRoot, 'receipt-ready');
fs.mkdirSync(binDir, { recursive: true });
fs.mkdirSync(kubeState, { recursive: true });
fs.writeFileSync(tokenFile, 'contract-token\n', { mode: 0o600 });
fs.chmodSync(tokenFile, 0o600);
fs.writeFileSync(templateFile, JSON.stringify({
  apiVersion: 'postgresql.cnpg.io/v1',
  kind: 'Cluster',
  metadata: {
    name: 'template-only',
    namespace: 'pilot-recovery',
    annotations: { 'erp.ailaoda.io/backup-adapter-template': 'v1' },
  },
  spec: {
    instances: 1,
    bootstrap: { recovery: { source: 'source' } },
    externalClusters: [{
      name: 'source',
      plugin: {
        name: 'barman-cloud.cloudnative-pg.io',
        parameters: { barmanObjectName: 'pilot-store', serverName: 'pilot-db' },
      },
    }],
    storage: { size: '1Gi' },
  },
}, null, 2));

const fakeKubectl = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const root = process.env.FAKE_KUBE_STATE;
const readInput = () => fs.readFileSync(0, 'utf8');
const print = value => process.stdout.write(JSON.stringify(value));
const backupFile = path.join(root, 'backup.json');
const restoreFile = path.join(root, 'restore.json');
const deletedFile = path.join(root, 'deleted');
if (args[0] === 'create' && args[1] === '-f') {
  const resource = JSON.parse(readInput());
  if (resource.kind === 'Backup') fs.writeFileSync(backupFile, JSON.stringify(resource));
  else if (resource.kind === 'Cluster') { fs.writeFileSync(restoreFile, JSON.stringify(resource)); fs.rmSync(deletedFile, { force: true }); }
  else process.exit(2);
  process.stdout.write(resource.metadata.name);
  process.exit(0);
}
if (args[0] === 'get' && args[1] === 'backup.postgresql.cnpg.io') {
  const resource = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
  resource.status = {
    phase: 'completed',
    startedAt: '2026-07-15T02:00:00.000Z',
    stoppedAt: '2026-07-15T02:01:00.000Z',
    endWal: '000000010000000000000001'
  };
  print(resource);
  process.exit(0);
}
if (args[0] === 'get' && args[1] === 'cluster.postgresql.cnpg.io') {
  if (fs.existsSync(deletedFile)) process.exit(1);
  const resource = JSON.parse(fs.readFileSync(restoreFile, 'utf8'));
  resource.status = { phase: 'Cluster in healthy state', readyInstances: 1, currentPrimary: resource.metadata.name + '-1' };
  print(resource);
  process.exit(0);
}
if (args[0] === 'get' && args[1] === 'pods') {
  const restore = JSON.parse(fs.readFileSync(restoreFile, 'utf8'));
  print({ items: [{
    metadata: { name: restore.metadata.name + '-1' },
    status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }] }
  }] });
  process.exit(0);
}
if (args[0] === 'exec') {
  process.stdout.write('found\\n');
  process.exit(0);
}
if (args[0] === 'delete' && args[1] === 'cluster.postgresql.cnpg.io') {
  fs.writeFileSync(deletedFile, '1');
  process.exit(0);
}
process.stderr.write('Unsupported fake kubectl args: ' + JSON.stringify(args) + '\\n');
process.exit(2);
`;
const kubectlPath = path.join(binDir, process.platform === 'win32' ? 'kubectl.cmd' : 'kubectl');
if (process.platform === 'win32') {
  fs.writeFileSync(kubectlPath, '@node "%~dp0\\kubectl.js" %*\r\n');
  fs.writeFileSync(path.join(binDir, 'kubectl.js'), fakeKubectl.replace(/^#!.*\n/, ''));
} else {
  fs.writeFileSync(kubectlPath, fakeKubectl, { mode: 0o755 });
  fs.chmodSync(kubectlPath, 0o755);
}

const port = 25000 + Math.floor(Math.random() * 10000);
const serverFile = path.join(tempRoot, 'receipt-server.cjs');
fs.writeFileSync(serverFile, `
const fs = require('fs');
const http = require('http');
const port = Number(process.argv[2]);
const ready = process.argv[3];
const server = http.createServer((request, response) => {
  const parts = request.url.split('/').filter(Boolean);
  const backupId = parts[parts.length - 1];
  const bad = request.url.startsWith('/bad/');
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({
    backupId,
    cluster: 'pilot-db',
    objectStoreBackupId: 'barman-' + backupId,
    encrypted: !bad,
    checksumVerified: true,
    checksumAlgorithm: 'sha256',
    manifestSha256: 'a'.repeat(64),
    completedAt: '2026-07-15T02:01:02.000Z',
    recoveryPointAt: '2026-07-15T02:01:05.000Z'
  }));
});
server.listen(port, '127.0.0.1', () => fs.writeFileSync(ready, '1'));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`);
const server = spawn(process.execPath, [serverFile, String(port), readyFile], { stdio: 'ignore' });
const deadline = Date.now() + 5000;
while (!fs.existsSync(readyFile) && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
if (!fs.existsSync(readyFile)) throw new Error('Receipt contract server did not start.');

const baseEnv = {
  ...process.env,
  PATH: binDir + path.delimiter + (process.env.PATH || ''),
  FAKE_KUBE_STATE: kubeState,
  CNPG_BACKUP_NAMESPACE: 'pilot',
  CNPG_BACKUP_CLUSTER: 'pilot-db',
  CNPG_BACKUP_RECOVERY_NAMESPACE: 'pilot-recovery',
  CNPG_BACKUP_RESTORE_TEMPLATE_FILE: templateFile,
  CNPG_BACKUP_RECEIPT_TOKEN_FILE: tokenFile,
  CNPG_BACKUP_RECEIPT_URL: `http://127.0.0.1:${port}`,
  CNPG_BACKUP_STATE_DIR: adapterState,
  CNPG_BACKUP_ALLOW_RESOURCE_CREATION: 'true',
  CNPG_BACKUP_DATABASE: 'app',
};
const run = (operation, operationArgs = [], env = {}) => {
  const output = execFileSync(process.execPath, [adapter, operation, ...operationArgs], {
    env: { ...baseEnv, ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  return output ? JSON.parse(output) : null;
};

try {
  const started = run('start-backup', ['customer-123']);
  assert.match(started.backupId, /^ailaoda-[a-z0-9-]+$/);
  const backupResource = JSON.parse(fs.readFileSync(path.join(kubeState, 'backup.json'), 'utf8'));
  assert.equal(backupResource.spec.method, 'plugin');
  assert.equal(backupResource.spec.pluginConfiguration.name, 'barman-cloud.cloudnative-pg.io');
  assert.equal(backupResource.spec.target, 'prefer-standby');

  const completed = run('backup-status', [started.backupId]);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.checksumVerified, true);
  assert.equal(completed.encrypted, true);
  assert.equal(completed.checksumAlgorithm, 'sha256');

  const restoreId = 'ailaoda-restore-contract';
  const restore = run('restore-isolated', [started.backupId, restoreId]);
  assert.equal(restore.restoreId, restoreId);
  const restoreResource = JSON.parse(fs.readFileSync(path.join(kubeState, 'restore.json'), 'utf8'));
  assert.equal(restoreResource.metadata.namespace, 'pilot-recovery');
  assert.equal(restoreResource.metadata.name, restoreId);
  assert.equal(restoreResource.spec.instances, 1);
  assert.equal(restoreResource.spec.bootstrap.recovery.recoveryTarget.targetTime, completed.recoveryPointAt);
  assert.equal(restoreResource.spec.plugins, undefined);

  const restoreStatus = run('restore-status', [restoreId]);
  assert.equal(restoreStatus.status, 'completed');
  assert.equal(restoreStatus.recoveredThroughAt, completed.recoveryPointAt);
  assert.deepEqual(run('verify-marker', [restoreId, 'customer-123']), { found: true, schemaCompatible: true });
  run('cleanup', [restoreId]);
  assert.deepEqual(run('cleanup-status', [restoreId]), { removed: true });

  const unsafe = run('start-backup', ['customer-456']);
  assert.throws(() => run('backup-status', [unsafe.backupId], {
    CNPG_BACKUP_RECEIPT_URL: `http://127.0.0.1:${port}/bad`,
  }), /Command failed/);

  console.log('CloudNativePG backup adapter contract: PASSED');
} finally {
  server.kill('SIGTERM');
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
