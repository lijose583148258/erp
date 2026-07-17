const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const operation = process.argv[2] || '';
const namespace = String(process.env.CNPG_NAMESPACE || '').trim();
const cluster = String(process.env.CNPG_CLUSTER || '').trim();
const stateRoot = path.resolve(String(process.env.HA_ADAPTER_STATE_DIR || '/tmp/ailaoda-ha-drill'));
const statePath = path.join(stateRoot, `cnpg-${cluster || 'unknown'}.json`);
const timeoutMs = Math.max(10_000, Number(process.env.HA_ADAPTER_TIMEOUT_MS || 60_000));

const fail = message => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};
if (!namespace || !cluster) fail('CNPG_NAMESPACE and CNPG_CLUSTER are required.');

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

const getPod = name => kubectlJson(['get', 'pod', name, '-n', namespace, '-o', 'json']);

const discover = () => {
  const lease = kubectlJson(['get', 'lease.coordination.k8s.io', cluster, '-n', namespace, '-o', 'json']);
  const id = String(lease?.spec?.holderIdentity || '').trim();
  if (!id) fail('CloudNativePG primary Lease has no holderIdentity.');
  const pod = getPod(id);
  if (pod?.metadata?.labels?.['cnpg.io/cluster'] !== cluster) fail('Lease holder is outside the configured CloudNativePG cluster.');
  if (pod?.metadata?.labels?.['cnpg.io/instanceRole'] !== 'primary') fail('Lease holder is not labeled as the CloudNativePG primary.');
  if (!podReady(pod)) fail('CloudNativePG primary pod is not Ready.');
  const nodeName = String(pod?.spec?.nodeName || '').trim();
  if (!nodeName) fail('CloudNativePG primary pod has no node assignment.');
  const node = kubectlJson(['get', 'node', nodeName, '-o', 'json']);
  const failureDomain = String(node?.metadata?.labels?.['topology.kubernetes.io/zone'] || '').trim();
  if (!failureDomain) fail('CloudNativePG primary node has no topology.kubernetes.io/zone label.');
  return { id, failureDomain };
};

const topology = () => {
  const pods = kubectlJson([
    'get', 'pods', '-n', namespace,
    '-l', `cnpg.io/cluster=${cluster}`,
    '-o', 'json',
  ]);
  const nodes = kubectlJson(['get', 'nodes', '-o', 'json']);
  const zonesByNode = new Map((nodes.items || []).map(node => [
    node.metadata?.name,
    node.metadata?.labels?.['topology.kubernetes.io/zone'] || '',
  ]));
  const readyPods = (pods.items || []).filter(podReady);
  const failureDomains = Array.from(new Set(readyPods
    .map(pod => zonesByNode.get(pod.spec?.nodeName) || '')
    .filter(Boolean)));
  if (readyPods.length < 3) fail('CloudNativePG drill requires at least three Ready instances.');
  if (failureDomains.length < 2) fail('CloudNativePG instances are not spread across at least two zones.');
  return { failureDomains, instanceCount: readyPods.length };
};

const writeState = state => {
  fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
};

const readState = () => {
  if (!fs.existsSync(statePath)) fail('CloudNativePG adapter state is missing; fail-primary was not recorded.');
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
};

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
    // CloudNativePG recreates the deleted member and follows the new primary.
    break;
  case 'old-primary-status': {
    const state = readState();
    let rejoinedAsReplica = false;
    try {
      const pod = getPod(state.primary.id);
      rejoinedAsReplica = podReady(pod)
        && pod?.metadata?.labels?.['cnpg.io/cluster'] === cluster
        && pod?.metadata?.labels?.['cnpg.io/instanceRole'] === 'replica';
    } catch {
      rejoinedAsReplica = false;
    }
    process.stdout.write(`${JSON.stringify({ rejoinedAsReplica })}\n`);
    break;
  }
  default:
    fail('Unsupported operation. Expected topology, discover, fail-primary, recover, or old-primary-status.');
}
