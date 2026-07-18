const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const verifier = path.join(__dirname, 'verify-kubernetes-ingress.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ailaoda-ingress-contract-'));
const valid = {
  metadata: { name: 'ailaoda-app', namespace: 'ailaoda-pilot', annotations: {} },
  spec: {
    ingressClassName: 'nginx',
    tls: [{ hosts: ['erp.pilot.company.com'], secretName: 'ailaoda-app-tls' }],
    rules: [{ host: 'erp.pilot.company.com', http: { paths: [{
      path: '/', pathType: 'Prefix', backend: { service: { name: 'ailaoda-app', port: { name: 'http' } } },
    }] } }],
  },
  status: { loadBalancer: { ingress: [{ hostname: 'lb.pilot.company.com' }] } },
};
const clone = value => structuredClone(value);
const run = value => {
  const file = path.join(root, 'ingress.json');
  fs.writeFileSync(file, JSON.stringify(value));
  return spawnSync(process.execPath, [verifier,
    '--ingress', file, '--namespace', 'ailaoda-pilot', '--ingress-name', 'ailaoda-app',
    '--ingress-class', 'nginx', '--public-host', 'erp.pilot.company.com', '--service-name', 'ailaoda-app',
  ], { encoding: 'utf8' });
};

try {
  const accepted = run(valid);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).tlsConfigured, true);

  const wrongService = clone(valid);
  wrongService.spec.rules[0].http.paths[0].backend.service.name = 'rogue-app';
  assert.notEqual(run(wrongService).status, 0, 'another Service must not receive admitted traffic');

  const extraHost = clone(valid);
  extraHost.spec.rules.push(clone(valid.spec.rules[0]));
  extraHost.spec.rules[1].host = 'shadow.pilot.company.com';
  assert.notEqual(run(extraHost).status, 0, 'unapproved additional hosts must be rejected');

  const missingTls = clone(valid);
  missingTls.spec.tls = [];
  assert.notEqual(run(missingTls).status, 0, 'an ingress without bound TLS must be rejected');

  const unsafeSnippet = clone(valid);
  unsafeSnippet.metadata.annotations['nginx.ingress.kubernetes.io/server-snippet'] = 'return 200;';
  assert.notEqual(run(unsafeSnippet).status, 0, 'executable ingress snippets must be rejected');

  const pendingLoadBalancer = clone(valid);
  pendingLoadBalancer.status.loadBalancer.ingress = [];
  assert.notEqual(run(pendingLoadBalancer).status, 0, 'an unprovisioned ingress must be rejected');

  console.log('Kubernetes ingress contract: PASSED');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
