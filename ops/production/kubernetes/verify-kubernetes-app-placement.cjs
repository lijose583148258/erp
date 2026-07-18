const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const valueFor = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
};
const fail = message => { throw new Error(message); };
const readJson = (flag, label) => {
  const value = valueFor(flag);
  if (!value) fail(`Missing ${flag}.`);
  const file = path.resolve(value);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`${label} file does not exist.`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { fail(`${label} is invalid JSON.`); }
};
const imageDigest = String(valueFor('--image-digest') || '').trim();
if (!/^sha256:[0-9a-f]{64}$/.test(imageDigest)) fail('A release image digest is required.');
const namespace = String(valueFor('--namespace') || '').trim();
if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(namespace)) fail('A valid application namespace is required.');

const nodes = readJson('--nodes', 'Nodes');
const pods = readJson('--pods', 'Pods');
const deployment = readJson('--deployment', 'Deployment');
const replicaSets = readJson('--replicasets', 'ReplicaSets');
const pdb = readJson('--pdb', 'PodDisruptionBudget');
const service = readJson('--service', 'Service');
const serviceAccount = readJson('--service-account', 'ServiceAccount');
const endpointSlices = readJson('--endpoint-slices', 'EndpointSlices');
const items = value => Array.isArray(value?.items) ? value.items : [];
const ready = value => Array.isArray(value?.status?.conditions)
  && value.status.conditions.some(condition => condition.type === 'Ready' && condition.status === 'True');
const controllerOwner = (value, kind) => (value?.metadata?.ownerReferences || [])
  .find(owner => owner.controller === true && owner.kind === kind);
const digestFromDeclaredImage = value => {
  const match = String(value || '').match(/@(sha256:[0-9a-f]{64})$/);
  return match ? match[1] : '';
};
const digestFromRuntimeImage = value => {
  const match = String(value || '').match(/(?:@|:\/\/)(sha256:[0-9a-f]{64})$/);
  return match ? match[1] : '';
};

const deploymentName = String(deployment?.metadata?.name || '').trim();
const deploymentUid = String(deployment?.metadata?.uid || '').trim();
const generation = Number(deployment?.metadata?.generation);
const deploymentLabels = deployment?.spec?.selector?.matchLabels;
if (!deploymentName || !deploymentUid || !Number.isInteger(generation) || generation < 1) {
  fail('Deployment identity is incomplete.');
}
const requireNamespace = (value, label) => {
  if (value?.metadata?.namespace !== namespace) fail(`${label} is outside the admitted namespace.`);
};
requireNamespace(deployment, 'Deployment');
requireNamespace(pdb, 'PodDisruptionBudget');
requireNamespace(service, 'Service');
requireNamespace(serviceAccount, 'ServiceAccount');
const serviceAccountName = String(serviceAccount?.metadata?.name || '').trim();
if (!serviceAccountName || serviceAccountName === 'default' || serviceAccount?.automountServiceAccountToken !== false
  || deployment?.spec?.template?.spec?.serviceAccountName !== serviceAccountName
  || deployment?.spec?.template?.spec?.automountServiceAccountToken !== false) {
  fail('Deployment must use a dedicated non-automounting ServiceAccount.');
}
if (!deploymentLabels || typeof deploymentLabels !== 'object' || Array.isArray(deploymentLabels)
  || Object.keys(deploymentLabels).length < 1
  || Object.entries(deploymentLabels).some(([key, value]) => deployment?.spec?.template?.metadata?.labels?.[key] !== value)) {
  fail('Deployment selector and Pod template labels are inconsistent.');
}
if (Number(deployment?.status?.observedGeneration) !== generation
  || Number(deployment?.status?.updatedReplicas) < 2
  || Number(deployment?.status?.readyReplicas) < 2
  || Number(deployment?.status?.availableReplicas) < 2
  || Number(deployment?.status?.unavailableReplicas || 0) !== 0) {
  fail('Deployment rollout is not fully observed and available.');
}
const appContainer = (deployment?.spec?.template?.spec?.containers || []).find(container => container.name === 'app');
if (!appContainer || digestFromDeclaredImage(appContainer.image) !== imageDigest) {
  fail('Deployment app container does not use the admitted image digest.');
}

const ownedReplicaSets = new Map(items(replicaSets)
  .filter(replicaSet => {
    if (replicaSet?.metadata?.namespace !== namespace) return false;
    const owner = controllerOwner(replicaSet, 'Deployment');
    return owner?.uid === deploymentUid && owner?.name === deploymentName;
  })
  .map(replicaSet => [String(replicaSet?.metadata?.name || ''), String(replicaSet?.metadata?.uid || '')])
  .filter(([name, uid]) => name && uid));
if (ownedReplicaSets.size < 1) fail('Deployment has no owned ReplicaSet.');

const readyNodes = new Map(items(nodes)
  .filter(node => node?.spec?.unschedulable !== true && ready(node))
  .map(node => [String(node?.metadata?.name || ''), String(node?.metadata?.labels?.['topology.kubernetes.io/zone'] || '')])
  .filter(([name, zone]) => name && zone));
if (readyNodes.size < 2 || new Set(readyNodes.values()).size < 2) {
  fail('Cluster has fewer than two Ready nodes across two labeled zones.');
}

const admittedPods = items(pods).filter(pod => {
  if (pod?.metadata?.namespace !== namespace) return false;
  if (pod?.spec?.serviceAccountName !== serviceAccountName || pod?.spec?.automountServiceAccountToken !== false) return false;
  const owner = controllerOwner(pod, 'ReplicaSet');
  if (!owner || ownedReplicaSets.get(owner.name) !== owner.uid || pod?.status?.phase !== 'Running' || !ready(pod)) return false;
  const specContainer = (pod?.spec?.containers || []).find(container => container.name === 'app');
  const runtimeContainer = (pod?.status?.containerStatuses || []).find(container => container.name === 'app');
  return digestFromDeclaredImage(specContainer?.image) === imageDigest
    && runtimeContainer?.ready === true
    && digestFromRuntimeImage(runtimeContainer?.imageID) === imageDigest;
});
const admittedNodes = admittedPods.map(pod => String(pod?.spec?.nodeName || '')).filter(Boolean);
const admittedZones = admittedNodes.map(node => readyNodes.get(node) || '').filter(Boolean);
if (admittedPods.length < 2 || new Set(admittedNodes).size < 2 || new Set(admittedZones).size < 2) {
  fail('Admitted release Pods are not Ready across two nodes and two zones.');
}
const pdbLabels = pdb?.spec?.selector?.matchLabels;
if (!pdbLabels || Object.entries(deploymentLabels).some(([key, value]) => pdbLabels[key] !== value)) {
  fail('PodDisruptionBudget selector does not cover the admitted Deployment.');
}
if (Number(pdb?.status?.expectedPods) !== admittedPods.length
  || Number(pdb?.status?.currentHealthy) !== admittedPods.length
  || Number(pdb?.status?.disruptionsAllowed) < 1) {
  fail('PodDisruptionBudget cannot currently tolerate one admitted Pod loss.');
}

const serviceName = String(service?.metadata?.name || '').trim();
const serviceSelector = service?.spec?.selector;
if (serviceName !== deploymentName || service?.spec?.type === 'ExternalName'
  || !serviceSelector || typeof serviceSelector !== 'object' || Array.isArray(serviceSelector)
  || Object.keys(serviceSelector).length !== Object.keys(deploymentLabels).length
  || Object.entries(deploymentLabels).some(([key, value]) => serviceSelector[key] !== value)) {
  fail('Service does not exclusively select the admitted Deployment.');
}
const httpPort = (service?.spec?.ports || []).find(port => port.name === 'http');
if (!httpPort || String(httpPort.protocol || 'TCP') !== 'TCP' || String(httpPort.targetPort || '') !== 'http'
  || !Number.isInteger(Number(httpPort.port)) || Number(httpPort.port) < 1) {
  fail('Service does not expose the admitted HTTP container port.');
}

const admittedPodIds = new Map(admittedPods.map(pod => [
  String(pod?.metadata?.uid || ''),
  String(pod?.metadata?.name || ''),
]).filter(([uid, name]) => uid && name));
if (admittedPodIds.size !== admittedPods.length) fail('Admitted Pods have incomplete immutable identities.');
const endpointPodIds = new Map();
for (const slice of items(endpointSlices)) {
  requireNamespace(slice, 'EndpointSlice');
  if (slice?.metadata?.labels?.['kubernetes.io/service-name'] !== serviceName) {
    fail('EndpointSlice is not owned by the admitted Service.');
  }
  for (const endpoint of slice?.endpoints || []) {
    if (endpoint?.conditions?.ready !== true || endpoint?.conditions?.serving === false
      || endpoint?.conditions?.terminating === true) continue;
    const target = endpoint?.targetRef;
    if (target?.kind !== 'Pod' || target?.namespace !== namespace
      || admittedPodIds.get(String(target?.uid || '')) !== String(target?.name || '')) {
      fail('Service has a Ready endpoint outside the admitted Pod set.');
    }
    endpointPodIds.set(String(target.uid), String(target.name));
  }
}
if (endpointPodIds.size !== admittedPodIds.size
  || [...admittedPodIds.keys()].some(uid => !endpointPodIds.has(uid))) {
  fail('Service EndpointSlices do not cover every admitted Pod exactly.');
}

process.stdout.write(`${JSON.stringify({
  status: 'passed',
  namespace,
  deployment: deploymentName,
  service: serviceName,
  serviceAccount: serviceAccountName,
  imageDigest,
  replicaSetCount: ownedReplicaSets.size,
  readyPodCount: admittedPods.length,
  nodeCount: new Set(admittedNodes).size,
  failureDomainCount: new Set(admittedZones).size,
  readyServiceEndpointCount: endpointPodIds.size,
})}\n`);
