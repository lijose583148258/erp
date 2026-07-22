const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const verifier = path.join(__dirname, 'verify-kubernetes-app-placement.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ailaoda-placement-contract-'));
const digest = `sha256:${'a'.repeat(64)}`;
const image = `registry.example.invalid/ailaoda/erp@${digest}`;
const ready = [{ type: 'Ready', status: 'True' }];
const write = (name, value) => {
  const file = path.join(root, `${name}.json`);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
};
const node = (name, zone) => ({ metadata: { name, labels: { 'topology.kubernetes.io/zone': zone } }, spec: {}, status: { conditions: ready } });
const pod = (name, nodeName, ownerName, podImage = image, imageID = `containerd://${image}`, ownerUid = 'replicaset-uid') => ({
  metadata: { name, uid: `${name}-uid`, namespace: 'ailaoda-pilot', ownerReferences: [{ kind: 'ReplicaSet', name: ownerName, uid: ownerUid, controller: true }] },
  spec: { nodeName, serviceAccountName: 'ailaoda-app', automountServiceAccountToken: false, containers: [{ name: 'app', image: podImage }] },
  status: { phase: 'Running', conditions: ready, containerStatuses: [{ name: 'app', ready: true, imageID }] },
});

try {
  const fixture = {
    nodes: { items: [node('node-a', 'zone-a'), node('node-b', 'zone-b')] },
    deployment: {
      metadata: { name: 'ailaoda-app', uid: 'deployment-uid', namespace: 'ailaoda-pilot', generation: 3 },
      spec: { selector: { matchLabels: { app: 'ailaoda-app' } }, template: { metadata: { labels: { app: 'ailaoda-app' } }, spec: { serviceAccountName: 'ailaoda-app', automountServiceAccountToken: false, containers: [{ name: 'app', image }] } } },
      status: { observedGeneration: 3, updatedReplicas: 2, readyReplicas: 2, availableReplicas: 2, unavailableReplicas: 0 },
    },
    replicasets: { items: [{ metadata: { name: 'ailaoda-app-current', uid: 'replicaset-uid', namespace: 'ailaoda-pilot', ownerReferences: [{ kind: 'Deployment', name: 'ailaoda-app', uid: 'deployment-uid', controller: true }] } }] },
    pods: { items: [pod('app-a', 'node-a', 'ailaoda-app-current'), pod('app-b', 'node-b', 'ailaoda-app-current')] },
    pdb: { metadata: { name: 'ailaoda-app', namespace: 'ailaoda-pilot' }, spec: { selector: { matchLabels: { app: 'ailaoda-app' } } }, status: { expectedPods: 2, currentHealthy: 2, disruptionsAllowed: 1 } },
    service: { metadata: { name: 'ailaoda-app', namespace: 'ailaoda-pilot' }, spec: { type: 'ClusterIP', selector: { app: 'ailaoda-app' }, ports: [{ name: 'http', port: 80, targetPort: 'http', protocol: 'TCP' }] } },
    serviceAccount: { metadata: { name: 'ailaoda-app', namespace: 'ailaoda-pilot' }, automountServiceAccountToken: false },
    endpointSlices: { items: [{
      metadata: { name: 'ailaoda-app-abc', namespace: 'ailaoda-pilot', labels: { 'kubernetes.io/service-name': 'ailaoda-app' } },
      endpoints: ['app-a', 'app-b'].map(name => ({ conditions: { ready: true, serving: true, terminating: false }, targetRef: { kind: 'Pod', namespace: 'ailaoda-pilot', name, uid: `${name}-uid` } })),
    }] },
  };
  const run = value => {
    const files = Object.fromEntries(Object.entries(value).map(([name, content]) => [name, write(name, content)]));
    return spawnSync(process.execPath, [
      verifier,
      '--nodes', files.nodes,
      '--pods', files.pods,
      '--deployment', files.deployment,
      '--replicasets', files.replicasets,
      '--pdb', files.pdb,
      '--service', files.service,
      '--service-account', files.serviceAccount,
      '--endpoint-slices', files.endpointSlices,
      '--namespace', 'ailaoda-pilot',
      '--image-digest', digest,
    ], { encoding: 'utf8' });
  };

  const valid = run(fixture);
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(valid.stdout).failureDomainCount, 2);
  assert.equal(JSON.parse(valid.stdout).readyServiceEndpointCount, 2);

  const roguePod = structuredClone(fixture);
  roguePod.pods.items[1] = pod('rogue-b', 'node-b', 'unrelated-replicaset');
  assert.notEqual(run(roguePod).status, 0, 'an unrelated labeled Pod must not satisfy placement');

  const staleRollout = structuredClone(fixture);
  staleRollout.deployment.status.observedGeneration = 2;
  assert.notEqual(run(staleRollout).status, 0, 'a stale Deployment rollout must be rejected');

  const wrongDeploymentImage = structuredClone(fixture);
  wrongDeploymentImage.deployment.spec.template.spec.containers[0].image = `registry.example.invalid/ailaoda/erp@sha256:${'b'.repeat(64)}`;
  assert.notEqual(run(wrongDeploymentImage).status, 0, 'a different Deployment image must be rejected');

  const digestLikeTag = structuredClone(fixture);
  digestLikeTag.deployment.spec.template.spec.containers[0].image = `registry.example.invalid/ailaoda/erp:${digest}`;
  assert.notEqual(run(digestLikeTag).status, 0, 'a digest-shaped tag must not be accepted as an immutable image');

  const wrongRuntimeImage = structuredClone(fixture);
  wrongRuntimeImage.pods.items[1].status.containerStatuses[0].imageID = `containerd://registry.example.invalid/ailaoda/erp@sha256:${'c'.repeat(64)}`;
  assert.notEqual(run(wrongRuntimeImage).status, 0, 'a different running imageID must be rejected');

  const staleOwnerUid = structuredClone(fixture);
  staleOwnerUid.pods.items[1].metadata.ownerReferences[0].uid = 'deleted-replicaset-uid';
  assert.notEqual(run(staleOwnerUid).status, 0, 'a Pod from a deleted ReplicaSet UID must be rejected');

  const inflatedPdb = structuredClone(fixture);
  inflatedPdb.pdb.status.expectedPods = 3;
  inflatedPdb.pdb.status.currentHealthy = 3;
  assert.notEqual(run(inflatedPdb).status, 0, 'an unrelated Pod must not inflate disruption evidence');

  const wrongNamespace = structuredClone(fixture);
  wrongNamespace.deployment.metadata.namespace = 'other-pilot';
  assert.notEqual(run(wrongNamespace).status, 0, 'a deployment outside the approved namespace must be rejected');

  const broadService = structuredClone(fixture);
  broadService.service.spec.selector = { app: 'ailaoda-app', track: 'unbound' };
  assert.notEqual(run(broadService).status, 0, 'a service selector not identical to the deployment selector must be rejected');

  const rogueEndpoint = structuredClone(fixture);
  rogueEndpoint.endpointSlices.items[0].endpoints[1].targetRef = { kind: 'Pod', namespace: 'ailaoda-pilot', name: 'rogue', uid: 'rogue-uid' };
  assert.notEqual(run(rogueEndpoint).status, 0, 'a ready endpoint outside the admitted Pod set must be rejected');

  const missingEndpoint = structuredClone(fixture);
  missingEndpoint.endpointSlices.items[0].endpoints.pop();
  assert.notEqual(run(missingEndpoint).status, 0, 'every admitted Pod must be covered by the service endpoints');

  const defaultServiceAccount = structuredClone(fixture);
  defaultServiceAccount.serviceAccount.metadata.name = 'default';
  defaultServiceAccount.deployment.spec.template.spec.serviceAccountName = 'default';
  defaultServiceAccount.pods.items.forEach(item => { item.spec.serviceAccountName = 'default'; });
  assert.notEqual(run(defaultServiceAccount).status, 0, 'the default ServiceAccount must be rejected');

  const mountedApiToken = structuredClone(fixture);
  mountedApiToken.pods.items[0].spec.automountServiceAccountToken = true;
  assert.notEqual(run(mountedApiToken).status, 0, 'a Pod mounting a Kubernetes API token must be rejected');

  console.log('Kubernetes application placement contract: PASSED');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
