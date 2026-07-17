const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const adapter = path.join(__dirname, 'meilisearch-kubernetes-search-adapter.cjs');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ailaoda-meili-adapter-contract-'));
const binDir = path.join(tempRoot, 'bin');
const kubeState = path.join(tempRoot, 'kube');
const adapterState = path.join(tempRoot, 'adapter');
const tokenFile = path.join(tempRoot, 'meili-token');
const endpointMapFile = path.join(tempRoot, 'endpoints.json');
const readyFile = path.join(tempRoot, 'server-ready');
fs.mkdirSync(binDir, { recursive: true });
fs.mkdirSync(kubeState, { recursive: true });
fs.writeFileSync(tokenFile, 'contract-master-key\n', { mode: 0o440 });
fs.chmodSync(tokenFile, 0o440);

const fakeKubectl = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const root = process.env.FAKE_KUBE_STATE;
const failed = path.join(root, 'failed');
const restoreFile = path.join(root, 'restore.json');
const namespacedDeleted = path.join(root, 'namespaced-deleted');
const contentDeleted = path.join(root, 'content-deleted');
const ready = [{ type: 'Ready', status: 'True' }];
const pod = (name, node, pvc) => ({
  metadata: { name },
  spec: { nodeName: node, volumes: [{ name: 'data', persistentVolumeClaim: { claimName: pvc } }] },
  status: { phase: 'Running', conditions: ready }
});
const pods = [
  pod('meili-0', 'node-a', 'meili-data-0'),
  pod('meili-1', 'node-b', 'meili-data-1')
];
const nodes = ['a', 'b'].map(id => ({
  metadata: { name: 'node-' + id, labels: { 'topology.kubernetes.io/zone': 'zone-' + id } }
}));
const print = value => process.stdout.write(JSON.stringify(value));
if (args[0] === 'get' && args[1] === 'nodes') { print({ items: nodes }); process.exit(0); }
if (args[0] === 'get' && args[1] === 'pods') {
  print({ items: fs.existsSync(failed) ? pods.slice(1) : pods });
  process.exit(0);
}
if (args[0] === 'get' && args[1] === 'pod') {
  const found = pods.find(item => item.metadata.name === args[2]);
  if (!found || (fs.existsSync(failed) && args[2] === 'meili-0')) process.exit(1);
  print(found);
  process.exit(0);
}
if (args[0] === 'delete' && args[1] === 'pod' && args[2] === 'meili-0') {
  fs.writeFileSync(failed, '1');
  process.exit(0);
}
if (args[0] === 'wait' && args.includes('pod/meili-0')) {
  fs.rmSync(failed, { force: true });
  process.exit(0);
}
if (args[0] === 'create' && args[1] === '-f') {
  const resource = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (resource.kind === 'VolumeSnapshot') {
    fs.writeFileSync(path.join(root, 'snapshot.json'), JSON.stringify(resource));
  } else if (resource.kind === 'List') {
    fs.writeFileSync(restoreFile, JSON.stringify(resource));
    fs.rmSync(namespacedDeleted, { force: true });
    fs.rmSync(contentDeleted, { force: true });
  } else process.exit(2);
  process.exit(0);
}
if (args[0] === 'get' && args[1] === 'volumesnapshot.snapshot.storage.k8s.io' && args[2].startsWith('meili-')) {
  print({
    metadata: { name: args[2] },
    status: { readyToUse: true, boundVolumeSnapshotContentName: 'source-content-1' }
  });
  process.exit(0);
}
if (args[0] === 'get' && args[1] === 'volumesnapshotcontent.snapshot.storage.k8s.io') {
  if (args[2] !== 'source-content-1' && fs.existsSync(contentDeleted)) process.exit(1);
  print({
    metadata: { name: args[2] },
    spec: {
      deletionPolicy: 'Retain',
      driver: 'contract.csi.example',
      source: { snapshotHandle: 'snapshot-handle-1' },
      sourceVolumeMode: 'Filesystem'
    },
    status: { snapshotHandle: 'snapshot-handle-1' }
  });
  process.exit(0);
}
if (args[0] === 'get' && args[1] === 'deployment.apps') {
  if (fs.existsSync(namespacedDeleted)) process.exit(1);
  print({ status: { availableReplicas: 1 } });
  process.exit(0);
}
if (args[0] === 'get' && ['service', 'persistentvolumeclaim'].includes(args[1])) {
  if (fs.existsSync(namespacedDeleted)) process.exit(1);
  print({ metadata: { name: args[2] } });
  process.exit(0);
}
if (args[0] === 'delete' && args[1] === 'deployment.apps') {
  fs.writeFileSync(namespacedDeleted, '1');
  process.exit(0);
}
if (args[0] === 'delete' && args[1] === 'volumesnapshotcontent.snapshot.storage.k8s.io') {
  fs.writeFileSync(contentDeleted, '1');
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

const port = 26000 + Math.floor(Math.random() * 8000);
const serverFile = path.join(tempRoot, 'meili-server.cjs');
fs.writeFileSync(serverFile, `
const fs = require('fs');
const http = require('http');
const server = http.createServer((request, response) => {
  response.setHeader('content-type', 'application/json');
  if (request.url.endsWith('/health')) return response.end(JSON.stringify({ status: 'available' }));
  if (request.url.includes('/indexes/orders/stats')) return response.end(JSON.stringify({ numberOfDocuments: 3 }));
  if (request.url.includes('/indexes/orders/documents/order-1')) return response.end(JSON.stringify({ id: 'order-1' }));
  if (request.method === 'POST' && request.url.endsWith('/dumps')) {
    response.statusCode = 202;
    return response.end(JSON.stringify({ taskUid: 7 }));
  }
  if (request.url.endsWith('/tasks/7')) {
    return response.end(JSON.stringify({ status: 'succeeded', details: { dumpUid: 'dump-contract-1' } }));
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ message: 'not found' }));
});
server.listen(Number(process.argv[2]), '127.0.0.1', () => fs.writeFileSync(process.argv[3], '1'));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`);
const server = spawn(process.execPath, [serverFile, String(port), readyFile], { stdio: 'ignore' });
const deadline = Date.now() + 5000;
while (!fs.existsSync(readyFile) && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
if (!fs.existsSync(readyFile)) throw new Error('Meilisearch contract server did not start.');

fs.writeFileSync(endpointMapFile, JSON.stringify({
  'meili-0': `http://127.0.0.1:${port}/meili-0`,
  'meili-1': `http://127.0.0.1:${port}/meili-1`,
}), { mode: 0o440 });
fs.chmodSync(endpointMapFile, 0o440);
const imageDigest = 'registry.example.invalid/meilisearch@sha256:' + 'b'.repeat(64);
const baseEnv = {
  ...process.env,
  PATH: binDir + path.delimiter + (process.env.PATH || ''),
  FAKE_KUBE_STATE: kubeState,
  MEILI_K8S_NAMESPACE: 'pilot',
  MEILI_K8S_RECOVERY_NAMESPACE: 'pilot-recovery',
  MEILI_K8S_SELECTOR: 'app=meilisearch',
  MEILI_K8S_DATA_VOLUME_NAME: 'data',
  MEILI_K8S_SNAPSHOT_CLASS: 'contract-snapshots',
  MEILI_K8S_ENDPOINT_MAP_FILE: endpointMapFile,
  MEILI_K8S_TOKEN_FILE: tokenFile,
  MEILI_K8S_RESTORE_URL_TEMPLATE: `http://127.0.0.1:${port}/{restoreId}`,
  MEILI_K8S_RESTORE_IMAGE: imageDigest,
  MEILI_K8S_RESTORE_SECRET: 'meili-restore-key',
  MEILI_K8S_STATE_DIR: adapterState,
  MEILI_K8S_ALLOW_POD_DELETE: 'true',
  MEILI_K8S_ALLOW_RESOURCE_CREATION: 'true',
  MEILI_K8S_INDEX_UID: 'orders',
};
const run = (operation, args = [], env = {}) => {
  const output = execFileSync(process.execPath, [adapter, operation, ...args], {
    env: { ...baseEnv, ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  return output ? JSON.parse(output) : null;
};

try {
  const topology = run('topology');
  assert.equal(topology.instanceCount, 2);
  assert.deepEqual(topology.failureDomains, ['zone-a', 'zone-b']);
  assert.deepEqual(run('discover'), { id: 'meili-0', failureDomain: 'zone-a' });
  assert.deepEqual(run('verify-live-query', ['order-1']), {
    found: true, endpointId: 'meili-0', failureDomain: 'zone-a',
  });

  run('fail-primary', ['search-contract-1']);
  assert.deepEqual(run('discover'), { id: 'meili-1', failureDomain: 'zone-b' });
  assert.deepEqual(run('verify-live-query', ['order-1']), {
    found: true, endpointId: 'meili-1', failureDomain: 'zone-b',
  });
  run('recover', ['search-contract-1']);
  assert.deepEqual(run('recovery-status', ['search-contract-1']), { recovered: true });

  const started = run('start-backup', ['order-1']);
  assert.match(started.backupId, /^meili-[a-z0-9-]+$/);
  assert.equal(run('backup-status', [started.backupId]).status, 'pending');
  const completed = run('backup-status', [started.backupId]);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.snapshotDriver, 'contract.csi.example');
  assert.equal(completed.snapshotHandle, 'snapshot-handle-1');

  const restoreId = 'search-restore-contract';
  assert.equal(run('restore-isolated', [started.backupId, restoreId]).restoreId, restoreId);
  const resources = JSON.parse(fs.readFileSync(path.join(kubeState, 'restore.json'), 'utf8')).items;
  const content = resources.find(item => item.kind === 'VolumeSnapshotContent');
  const snapshot = resources.find(item => item.kind === 'VolumeSnapshot');
  const pvcs = resources.filter(item => item.kind === 'PersistentVolumeClaim');
  const backupPvc = pvcs.find(item => item.spec.dataSource);
  const dataPvc = pvcs.find(item => !item.spec.dataSource);
  const deployment = resources.find(item => item.kind === 'Deployment');
  assert.equal(content.spec.source.snapshotHandle, 'snapshot-handle-1');
  assert.equal(content.spec.deletionPolicy, 'Retain');
  assert.equal(content.spec.volumeSnapshotRef.namespace, 'pilot-recovery');
  assert.equal(snapshot.metadata.namespace, 'pilot-recovery');
  assert.equal(backupPvc.spec.dataSource.name, restoreId);
  assert.equal(dataPvc.metadata.name, restoreId);
  const container = deployment.spec.template.spec.containers[0];
  assert.equal(container.image, imageDigest);
  assert(container.args.includes('--import-dump=/backup/dumps/dump-contract-1.dump'));
  assert.equal(container.volumeMounts.find(item => item.name === 'backup').readOnly, true);
  assert.equal(deployment.spec.template.spec.automountServiceAccountToken, false);

  assert.equal(run('restore-status', [restoreId]).status, 'completed');
  assert.deepEqual(run('verify-restored-query', [restoreId, 'order-1']), {
    found: true, documentCountMatched: true,
  });
  run('cleanup', [restoreId]);
  assert.deepEqual(run('cleanup-status', [restoreId]), { removed: true });

  assert.throws(() => run('fail-primary', ['search-contract-2'], {
    MEILI_K8S_ALLOW_POD_DELETE: 'false',
  }), /Command failed/);

  console.log('Meilisearch Kubernetes adapter contract: PASSED');
} finally {
  server.kill('SIGTERM');
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
