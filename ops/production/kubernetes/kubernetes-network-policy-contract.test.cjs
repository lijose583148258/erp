const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const verifier = path.join(__dirname, 'verify-kubernetes-network-policy.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ailaoda-network-policy-contract-'));
const provider = {
  applicationNetworkPolicy: {
    name: 'ailaoda-app-ingress',
    ingressControllerNamespace: 'ingress-nginx',
    ingressControllerPodLabels: { 'app.kubernetes.io/name': 'ingress-nginx' },
    observabilityNamespace: 'monitoring',
    observabilityPodLabels: { 'app.kubernetes.io/name': 'prometheus' },
  },
};
const rule = (namespace, labels) => ({
  from: [{
    namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': namespace } },
    podSelector: { matchLabels: labels },
  }],
  ports: [{ protocol: 'TCP', port: 5001 }],
});
const valid = {
  metadata: { name: 'ailaoda-app-ingress', namespace: 'ailaoda-pilot' },
  spec: {
    podSelector: { matchLabels: { app: 'ailaoda-app' } },
    policyTypes: ['Ingress'],
    ingress: [
      rule('ingress-nginx', provider.applicationNetworkPolicy.ingressControllerPodLabels),
      rule('monitoring', provider.applicationNetworkPolicy.observabilityPodLabels),
    ],
  },
};
const clone = value => structuredClone(value);
const run = policy => {
  const policyFile = path.join(root, 'policy.json');
  const providerFile = path.join(root, 'provider.json');
  fs.writeFileSync(policyFile, JSON.stringify(policy));
  fs.writeFileSync(providerFile, JSON.stringify(provider));
  return spawnSync(process.execPath, [verifier,
    '--network-policy', policyFile, '--provider-summary', providerFile, '--namespace', 'ailaoda-pilot',
  ], { encoding: 'utf8' });
};

try {
  const accepted = run(valid);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).allowedCallerCount, 2);

  const openNamespace = clone(valid);
  openNamespace.spec.ingress[0].from[0].namespaceSelector = {};
  assert.notEqual(run(openNamespace).status, 0, 'an all-namespace caller must be rejected');

  const openPods = clone(valid);
  openPods.spec.ingress[1].from[0].podSelector = {};
  assert.notEqual(run(openPods).status, 0, 'an all-Pod caller must be rejected');

  const extraCaller = clone(valid);
  extraCaller.spec.ingress.push(rule('untrusted', { app: 'rogue' }));
  assert.notEqual(run(extraCaller).status, 0, 'an additional caller must be rejected');

  const broadPort = clone(valid);
  broadPort.spec.ingress[0].ports = [];
  assert.notEqual(run(broadPort).status, 0, 'an all-port rule must be rejected');

  const ipBlock = clone(valid);
  ipBlock.spec.ingress[0].from[0].ipBlock = { cidr: '0.0.0.0/0' };
  assert.notEqual(run(ipBlock).status, 0, 'an IP block bypass must be rejected');

  console.log('Kubernetes NetworkPolicy contract: PASSED');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
