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
  metadata: { name, ownerReferences: [{ kind: 'ReplicaSet', name: ownerName, uid: ownerUid, controller: true }] },
  spec: { nodeName, containers: [{ name: 'app', image: podImage }] },
  status: { phase: 'Running', conditions: ready, containerStatuses: [{ name: 'app', ready: true, imageID }] },
});

try {
  const fixture = {
    nodes: { items: [node('node-a', 'zone-a'), node('node-b', 'zone-b')] },
    deployment: {
      metadata: { name: 'ailaoda-app', uid: 'deployment-uid', generation: 3 },
      spec: { selector: { matchLabels: { app: 'ailaoda-app' } }, template: { metadata: { labels: { app: 'ailaoda-app' } }, spec: { containers: [{ name: 'app', image }] } } },
      status: { observedGeneration: 3, updatedReplicas: 2, readyReplicas: 2, availableReplicas: 2, unavailableReplicas: 0 },
    },
    replicasets: { items: [{ metadata: { name: 'ailaoda-app-current', uid: 'replicaset-uid', ownerReferences: [{ kind: 'Deployment', name: 'ailaoda-app', uid: 'deployment-uid', controller: true }] } }] },
    pods: { items: [pod('app-a', 'node-a', 'ailaoda-app-current'), pod('app-b', 'node-b', 'ailaoda-app-current')] },
    pdb: { spec: { selector: { matchLabels: { app: 'ailaoda-app' } } }, status: { expectedPods: 2, currentHealthy: 2, disruptionsAllowed: 1 } },
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
      '--image-digest', digest,
    ], { encoding: 'utf8' });
  };

  const valid = run(fixture);
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(valid.stdout).failureDomainCount, 2);

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

  console.log('Kubernetes application placement contract: PASSED');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
