const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const operation = process.argv[2] || '';
const namespace = String(process.env.CNPG_NAMESPACE || '').trim();
const cluster = String(process.env.CNPG_CLUSTER || '').trim();
const changeTicket = String(process.env.HA_DRILL_CHANGE_TICKET || '').trim();
const stateRoot = path.resolve(String(process.env.HA_ADAPTER_STATE_DIR || '/tmp/ailaoda-ha-drill'));
const stateBinding = { namespace, cluster, changeTicket };
const stateKey = crypto.createHash('sha256').update(JSON.stringify(stateBinding)).digest('hex').slice(0, 24);
const statePath = path.join(stateRoot, `cnpg-${stateKey}.json`);
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

const discoverPrimary = () => {
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
  const uid = String(pod?.metadata?.uid || '').trim();
  if (!uid) fail('CloudNativePG primary pod has no Kubernetes UID.');
  return { id, failureDomain, uid };
};
const discover = () => {
  const { id, failureDomain } = discoverPrimary();
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
const requireChangeTicket = () => {
  if (changeTicket.length < 5) fail('HA_DRILL_CHANGE_TICKET is required for disruptive state operations.');
};

const readState = () => {
  requireChangeTicket();
  if (!fs.existsSync(statePath)) fail('CloudNativePG adapter state is missing; fail-primary was not recorded.');
  let state;
  try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { fail('CloudNativePG adapter state is invalid JSON.'); }
  if (state?.version !== 1 || JSON.stringify(state?.binding) !== JSON.stringify(stateBinding)
    || !state?.primary?.id || !state?.primary?.uid) {
    fail('CloudNativePG adapter state does not match this drill target.');
  }
  return state;
};

switch (operation) {
  case 'topology':
    process.stdout.write(`${JSON.stringify(topology())}\n`);
    break;
  case 'discover':
    process.stdout.write(`${JSON.stringify(discover())}\n`);
    break;
  case 'fail-primary': {
    requireChangeTicket();
    const primary = discoverPrimary();
    writeState({ version: 1, binding: stateBinding, primary, injectedAt: new Date().toISOString() });
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
        && pod?.metadata?.labels?.['cnpg.io/instanceRole'] === 'replica'
        && String(pod?.metadata?.uid || '').trim() !== state.primary.uid;
    } catch {
      rejoinedAsReplica = false;
    }
    process.stdout.write(`${JSON.stringify({ rejoinedAsReplica })}\n`);
    break;
  }
  default:
    fail('Unsupported operation. Expected topology, discover, fail-primary, recover, or old-primary-status.');
}
