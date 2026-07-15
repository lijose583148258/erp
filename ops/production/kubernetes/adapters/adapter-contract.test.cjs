const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '../../../..');
const cnpgAdapter = path.join(__dirname, 'cnpg-ha-adapter.cjs');
const redisAdapter = path.join(__dirname, 'redis-kubernetes-ha-adapter.cjs');
const objectAdapter = path.join(__dirname, 'minio-kubernetes-object-adapter.cjs');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ailaoda-ha-adapter-contract-'));
const binDir = path.join(tempRoot, 'bin');
const fakeState = path.join(tempRoot, 'fake-state');
const adapterState = path.join(tempRoot, 'adapter-state');
fs.mkdirSync(binDir, { recursive: true });
fs.mkdirSync(fakeState, { recursive: true });
const fakeKubectl = "#!/usr/bin/env node\nconst fs = require('fs');\nconst path = require('path');\nconst args = process.argv.slice(2);\nconst state = process.env.FAKE_KUBE_STATE;\nconst pgFailed = fs.existsSync(path.join(state, 'pg-failed'));\nconst redisFailed = fs.existsSync(path.join(state, 'redis-failed'));\nconst minioFailed = fs.existsSync(path.join(state, 'minio-failed'));\nconst ready = [{ type: 'Ready', status: 'True' }];\nconst pod = (name, nodeName, labels) => ({ metadata: { name, labels }, spec: { nodeName }, status: { phase: 'Running', conditions: ready } });\nconst nodes = ['a', 'b', 'c'].map(id => ({ metadata: { name: 'node-' + id, labels: { 'topology.kubernetes.io/zone': 'zone-' + id } }, spec: {}, status: { conditions: ready } }));\nconst print = value => process.stdout.write(JSON.stringify(value));\nif (args[0] === 'get' && args[1] === 'nodes') { print({ items: nodes }); process.exit(0); }\nif (args[0] === 'get' && args[1] === 'node') { const node = nodes.find(item => item.metadata.name === args[2]); if (!node) process.exit(1); print(node); process.exit(0); }\nif (args[0] === 'get' && args[1] === 'lease.coordination.k8s.io') { print({ spec: { holderIdentity: pgFailed ? 'pg-2' : 'pg-1' } }); process.exit(0); }\nconst pgPods = [\n  pod('pg-1', 'node-a', { 'cnpg.io/cluster': 'demo', 'cnpg.io/instanceRole': pgFailed ? 'replica' : 'primary' }),\n  pod('pg-2', 'node-b', { 'cnpg.io/cluster': 'demo', 'cnpg.io/instanceRole': pgFailed ? 'primary' : 'replica' }),\n  pod('pg-3', 'node-c', { 'cnpg.io/cluster': 'demo', 'cnpg.io/instanceRole': 'replica' }),\n];\nconst redisPods = [\n  pod('redis-0', 'node-a', { app: 'redis-data', role: redisFailed ? 'replica' : 'master' }),\n  pod('redis-1', 'node-b', { app: 'redis-data', role: redisFailed ? 'master' : 'replica' }),\n  pod('redis-2', 'node-c', { app: 'redis-data', role: 'replica' }),\n];\nconst sentinelPods = [\n  pod('sentinel-0', 'node-a', { app: 'redis-sentinel' }),\n  pod('sentinel-1', 'node-b', { app: 'redis-sentinel' }),\n  pod('sentinel-2', 'node-c', { app: 'redis-sentinel' }),\n];\nconst minioPods = [\n  pod('minio-0', 'node-a', { app: 'minio' }),\n  pod('minio-1', 'node-b', { app: 'minio' }),\n  pod('minio-2', 'node-c', { app: 'minio' }),\n  pod('minio-3', 'node-a', { app: 'minio' }),\n];\nconst allPods = [...pgPods, ...redisPods, ...sentinelPods, ...minioPods];\nif (args[0] === 'get' && args[1] === 'pod') { const found = allPods.find(item => item.metadata.name === args[2]); if (!found || (minioFailed && args[2] === 'minio-0')) process.exit(1); print(found); process.exit(0); }\nif (args[0] === 'get' && args[1] === 'pods') {\n  const selector = args[args.indexOf('-l') + 1];\n  let items = [];\n  if (selector === 'cnpg.io/cluster=demo') items = pgPods;\n  if (selector === 'app=redis-data') items = redisPods;\n  if (selector === 'role=master') items = redisPods.filter(item => item.metadata.labels.role === 'master');\n  if (selector === 'role=replica') items = redisPods.filter(item => item.metadata.labels.role === 'replica');\n  if (selector === 'app=redis-sentinel') items = sentinelPods;\n  if (selector === 'app=minio') items = minioFailed ? minioPods.slice(1) : minioPods;\n  print({ items });\n  process.exit(0);\n}\nif (args[0] === 'delete' && args[1] === 'pod') {\n  if (args[2] === 'pg-1') fs.writeFileSync(path.join(state, 'pg-failed'), '1');\n  else if (args[2] === 'redis-0') fs.writeFileSync(path.join(state, 'redis-failed'), '1');\n  else if (args[2] === 'minio-0') fs.writeFileSync(path.join(state, 'minio-failed'), '1');\n  else process.exit(1);\n  process.exit(0);\n}\nif (args[0] === 'wait' && args.includes('pod/minio-0')) { fs.rmSync(path.join(state, 'minio-failed'), { force: true }); process.exit(0); }\nprocess.stderr.write('Unsupported fake kubectl args: ' + JSON.stringify(args) + '\\n');\nprocess.exit(2);\n";
const kubectlPath = path.join(binDir, process.platform === 'win32' ? 'kubectl.cmd' : 'kubectl');
if (process.platform === 'win32') {
  fs.writeFileSync(kubectlPath, '@node "%~dp0\\kubectl.js" %*\r\n');
  fs.writeFileSync(path.join(binDir, 'kubectl.js'), fakeKubectl.replace(/^#!.*\n/, ''));
} else {
  fs.writeFileSync(kubectlPath, fakeKubectl, { mode: 0o755 });
  fs.chmodSync(kubectlPath, 0o755);
}
const baseEnv = {
  ...process.env,
  PATH: binDir + path.delimiter + (process.env.PATH || ''),
  FAKE_KUBE_STATE: fakeState,
  HA_ADAPTER_STATE_DIR: adapterState,
};
const run = (adapter, operation, env, ...operationArgs) => {
  const output = execFileSync(process.execPath, [adapter, operation, ...operationArgs], {
    cwd: root, env: { ...baseEnv, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  return output ? JSON.parse(output) : null;
};
try {
  const cnpgEnv = { CNPG_NAMESPACE: 'pilot', CNPG_CLUSTER: 'demo' };
  const pgTopology = run(cnpgAdapter, 'topology', cnpgEnv);
  assert.equal(pgTopology.instanceCount, 3);
  assert.deepEqual(pgTopology.failureDomains, ['zone-a', 'zone-b', 'zone-c']);
  assert.deepEqual(run(cnpgAdapter, 'discover', cnpgEnv), { id: 'pg-1', failureDomain: 'zone-a' });
  run(cnpgAdapter, 'fail-primary', cnpgEnv);
  assert.deepEqual(run(cnpgAdapter, 'discover', cnpgEnv), { id: 'pg-2', failureDomain: 'zone-b' });
  run(cnpgAdapter, 'recover', cnpgEnv);
  assert.deepEqual(run(cnpgAdapter, 'old-primary-status', cnpgEnv), { rejoinedAsReplica: true });

  const redisEnv = {
    REDIS_K8S_NAMESPACE: 'pilot',
    REDIS_DATA_SELECTOR: 'app=redis-data',
    REDIS_MASTER_SELECTOR: 'role=master',
    REDIS_REPLICA_SELECTOR: 'role=replica',
    REDIS_SENTINEL_SELECTOR: 'app=redis-sentinel',
  };
  const redisTopology = run(redisAdapter, 'topology', redisEnv);
  assert.equal(redisTopology.dataInstanceCount, 3);
  assert.equal(redisTopology.sentinelCount, 3);
  assert.deepEqual(redisTopology.failureDomains, ['zone-a', 'zone-b', 'zone-c']);
  assert.deepEqual(run(redisAdapter, 'discover', redisEnv), { id: 'redis-0', failureDomain: 'zone-a' });
  run(redisAdapter, 'fail-primary', redisEnv);
  assert.deepEqual(run(redisAdapter, 'discover', redisEnv), { id: 'redis-1', failureDomain: 'zone-b' });
  run(redisAdapter, 'recover', redisEnv);
  assert.deepEqual(run(redisAdapter, 'old-primary-status', redisEnv), { rejoinedAsReplica: true });
  const objectEnv = {
    MINIO_K8S_NAMESPACE: 'pilot',
    MINIO_K8S_SELECTOR: 'app=minio',
    MINIO_K8S_ALLOW_POD_DELETE: 'true',
    MINIO_K8S_STATE_DIR: adapterState,
  };
  const objectTopology = run(objectAdapter, 'topology', objectEnv);
  assert.equal(objectTopology.instanceCount, 4);
  assert.deepEqual(objectTopology.failureDomains, ['zone-a', 'zone-b', 'zone-c']);
  assert.deepEqual(run(objectAdapter, 'discover', objectEnv), { id: 'minio-0', failureDomain: 'zone-a' });
  run(objectAdapter, 'fail-primary', objectEnv, 'object-drill-1');
  assert.deepEqual(run(objectAdapter, 'discover', objectEnv), { id: 'minio-1', failureDomain: 'zone-b' });
  run(objectAdapter, 'recover', objectEnv, 'object-drill-1');
  assert.deepEqual(run(objectAdapter, 'recovery-status', objectEnv, 'object-drill-1'), { recovered: true });

  console.log('HA and object adapter contract tests: PASSED');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
