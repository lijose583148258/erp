const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const operation = process.argv[2] || '';
const operationId = String(process.argv[3] || '').trim();
const namespace = String(process.env.MINIO_K8S_NAMESPACE || '').trim();
const selector = String(process.env.MINIO_K8S_SELECTOR || '').trim();
const stateRoot = path.resolve(String(process.env.MINIO_K8S_STATE_DIR || '/tmp/ailaoda-minio-drill'));
const timeoutMs = Math.max(10_000, Number(process.env.MINIO_K8S_TIMEOUT_MS || 120_000));
const minimumReady = Math.max(4, Number(process.env.MINIO_K8S_MIN_READY || 4));

const fail = message => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};
if (!namespace || !selector) fail('MINIO_K8S_NAMESPACE and MINIO_K8S_SELECTOR are required.');

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
const podReady = pod => pod?.status?.phase === 'Running'
  && Array.isArray(pod?.status?.conditions)
  && pod.status.conditions.some(condition => condition.type === 'Ready' && condition.status === 'True');
const validId = value => /^[a-z0-9](?:[-a-z0-9]{0,62})$/.test(value);
const statePath = id => path.join(stateRoot, `minio-${id}.json`);
const writeState = (id, state) => {
  fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  fs.writeFileSync(statePath(id), `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
};
const readState = id => {
  if (!validId(id)) fail('A valid failure injection ID is required.');
  const file = statePath(id);
  if (!fs.existsSync(file)) fail('MinIO adapter state is missing for this injection ID.');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};
const getPod = name => kubectlJson(['get', 'pod', name, '-n', namespace, '-o', 'json']);
const zonesByNode = () => {
  const nodes = kubectlJson(['get', 'nodes', '-o', 'json']);
  return new Map((nodes.items || []).map(node => [
    String(node?.metadata?.name || ''),
    String(node?.metadata?.labels?.['topology.kubernetes.io/zone'] || ''),
  ]));
};
const readyEndpoints = () => {
  const pods = kubectlJson(['get', 'pods', '-n', namespace, '-l', selector, '-o', 'json']);
  const zones = zonesByNode();
  return (pods.items || []).filter(podReady).map(pod => ({
    id: String(pod?.metadata?.name || ''),
    failureDomain: zones.get(String(pod?.spec?.nodeName || '')) || '',
  })).filter(item => item.id && item.failureDomain).sort((a, b) => a.id.localeCompare(b.id));
};
const topology = () => {
  const endpoints = readyEndpoints();
  const failureDomains = [...new Set(endpoints.map(item => item.failureDomain))];
  if (endpoints.length < minimumReady) fail(`MinIO drill requires at least ${minimumReady} Ready data pods.`);
  if (failureDomains.length < 2) fail('MinIO data pods are not spread across at least two zones.');
  return {
    failureDomains,
    instanceCount: endpoints.length,
    observedAt: new Date().toISOString(),
  };
};
const discover = () => {
  const endpoint = readyEndpoints()[0];
  if (!endpoint) fail('No Ready MinIO endpoint was discovered.');
  return endpoint;
};

switch (operation) {
  case 'topology':
    process.stdout.write(`${JSON.stringify(topology())}\n`);
    break;
  case 'discover':
    process.stdout.write(`${JSON.stringify(discover())}\n`);
    break;
  case 'fail-primary': {
    if (!validId(operationId)) fail('A valid failure injection ID is required.');
    if (process.env.MINIO_K8S_ALLOW_POD_DELETE !== 'true') {
      fail('MINIO_K8S_ALLOW_POD_DELETE=true is required for the approved pilot drill.');
    }
    const currentTopology = topology();
    const primary = discover();
    writeState(operationId, {
      primary,
      selector,
      namespace,
      failureDomains: currentTopology.failureDomains,
      injectedAt: new Date().toISOString(),
    });
    kubectl(['delete', 'pod', primary.id, '-n', namespace, '--wait=false']);
    break;
  }
  case 'recover': {
    const state = readState(operationId);
    if (state.namespace !== namespace || state.selector !== selector) fail('MinIO adapter state scope mismatch.');
    const timeoutSeconds = Math.max(10, Math.ceil(timeoutMs / 1000));
    kubectl(['wait', '--for=condition=Ready', `pod/${state.primary.id}`, '-n', namespace, `--timeout=${timeoutSeconds}s`]);
    break;
  }
  case 'recovery-status': {
    const state = readState(operationId);
    let recovered = false;
    try {
      const pod = getPod(state.primary.id);
      recovered = podReady(pod)
        && String(pod?.metadata?.name || '') === state.primary.id
        && readyEndpoints().some(endpoint => endpoint.id === state.primary.id);
    } catch {
      recovered = false;
    }
    process.stdout.write(`${JSON.stringify({ recovered })}\n`);
    break;
  }
  default:
    fail('Unsupported operation. Expected topology, discover, fail-primary, recover, or recovery-status.');
}
