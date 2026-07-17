const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const operation = process.argv[2] || '';
const namespace = String(process.env.REDIS_K8S_NAMESPACE || '').trim();
const dataSelector = String(process.env.REDIS_DATA_SELECTOR || '').trim();
const masterSelector = String(process.env.REDIS_MASTER_SELECTOR || '').trim();
const replicaSelector = String(process.env.REDIS_REPLICA_SELECTOR || '').trim();
const sentinelSelector = String(process.env.REDIS_SENTINEL_SELECTOR || '').trim();
const stateRoot = path.resolve(String(process.env.HA_ADAPTER_STATE_DIR || '/tmp/ailaoda-ha-drill'));
const statePath = path.join(stateRoot, 'redis-kubernetes.json');
const timeoutMs = Math.max(10_000, Number(process.env.HA_ADAPTER_TIMEOUT_MS || 60_000));

const fail = message => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};
for (const [name, value] of Object.entries({
  REDIS_K8S_NAMESPACE: namespace,
  REDIS_DATA_SELECTOR: dataSelector,
  REDIS_MASTER_SELECTOR: masterSelector,
  REDIS_REPLICA_SELECTOR: replicaSelector,
  REDIS_SENTINEL_SELECTOR: sentinelSelector,
})) {
  if (!value) fail(`${name} is required.`);
}

const kubectl = args => execFileSync('kubectl', args, {
  encoding: 'utf8',
  timeout: timeoutMs,
  stdio: ['ignore', 'pipe', 'inherit'],
}).trim();
const kubectlJson = args => {
  const output = kubectl(args);
  try {
    return JSON.parse(output);
  } catch {
    fail(`kubectl returned invalid JSON for: ${args.join(' ')}`);
  }
};

const podReady = pod => Array.isArray(pod?.status?.conditions)
  && pod.status.conditions.some(condition => condition.type === 'Ready' && condition.status === 'True');
const listPods = selector => kubectlJson(['get', 'pods', '-n', namespace, '-l', selector, '-o', 'json']).items || [];
const getPod = name => kubectlJson(['get', 'pod', name, '-n', namespace, '-o', 'json']);

const nodeZones = () => new Map((kubectlJson(['get', 'nodes', '-o', 'json']).items || []).map(node => [
  node.metadata?.name,
  node.metadata?.labels?.['topology.kubernetes.io/zone'] || '',
]));

const podFailureDomain = (pod, zones) => {
  const nodeName = String(pod?.spec?.nodeName || '').trim();
  const zone = String(zones.get(nodeName) || '').trim();
  if (!nodeName || !zone) fail(`Pod ${pod?.metadata?.name || 'unknown'} has no zone-labeled node assignment.`);
  return zone;
};

const discover = () => {
  const dataIds = new Set(listPods(dataSelector).map(pod => pod.metadata?.name));
  const masters = listPods(masterSelector).filter(pod => podReady(pod) && dataIds.has(pod.metadata?.name));
  if (masters.length !== 1) fail(`Expected exactly one Ready Redis master, found ${masters.length}.`);
  const zones = nodeZones();
  return {
    id: masters[0].metadata.name,
    failureDomain: podFailureDomain(masters[0], zones),
  };
};

const topology = () => {
  const zones = nodeZones();
  const dataPods = listPods(dataSelector).filter(podReady);
  const sentinelPods = listPods(sentinelSelector).filter(podReady);
  const dataDomains = Array.from(new Set(dataPods.map(pod => podFailureDomain(pod, zones))));
  const sentinelDomains = Array.from(new Set(sentinelPods.map(pod => podFailureDomain(pod, zones))));
  if (dataPods.length < 2 || dataDomains.length < 2) fail('Redis data pods require at least two Ready instances across two zones.');
  if (sentinelPods.length < 3 || sentinelDomains.length < 3) fail('Redis Sentinel requires at least three Ready voters across three zones.');
  return {
    failureDomains: Array.from(new Set([...sentinelDomains, ...dataDomains])),
    dataFailureDomains: dataDomains,
    dataInstanceCount: dataPods.length,
    sentinelCount: sentinelPods.length,
  };
};

const writeState = state => {
  fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
};
const readState = () => {
  if (!fs.existsSync(statePath)) fail('Redis adapter state is missing; fail-primary was not recorded.');
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
};
const isReplica = name => listPods(replicaSelector)
  .some(pod => pod.metadata?.name === name && podReady(pod));

switch (operation) {
  case 'topology':
    process.stdout.write(`${JSON.stringify(topology())}\n`);
    break;
  case 'discover':
    process.stdout.write(`${JSON.stringify(discover())}\n`);
    break;
  case 'fail-primary': {
    const primary = discover();
    writeState({ primary, injectedAt: new Date().toISOString() });
    kubectl(['delete', 'pod', primary.id, '-n', namespace, '--wait=false']);
    break;
  }
  case 'recover':
    // The Redis operator or StatefulSet recreates the deleted member.
    break;
  case 'old-primary-status': {
    const state = readState();
    let rejoinedAsReplica = false;
    try {
      const pod = getPod(state.primary.id);
      rejoinedAsReplica = podReady(pod) && isReplica(state.primary.id);
    } catch {
      rejoinedAsReplica = false;
    }
    process.stdout.write(`${JSON.stringify({ rejoinedAsReplica })}\n`);
    break;
  }
  default:
    fail('Unsupported operation. Expected topology, discover, fail-primary, recover, or old-primary-status.');
}
