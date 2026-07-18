const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ailaoda-network-policy-drill-'));
const runner = path.join(__dirname, 'run-network-policy-enforcement-drill.cjs');
const verifier = path.join(__dirname, 'verify-formal-pilot-provider-profile.cjs');
const fakeKubectl = path.join(root, 'fake-kubectl.cjs');
const profilePath = path.join(root, 'provider.json');
const evidencePath = path.join(root, 'evidence.json');
const probeImage = `docker.io/curlimages/curl@sha256:${'7'.repeat(64)}`;

const profile = {
  schemaVersion: 2,
  environment: 'formal-pilot',
  platform: {
    kind: 'kubernetes-native',
    failureDomains: ['zone-a', 'zone-b', 'zone-c'],
    applicationNamespace: 'ailaoda-pilot',
    recoveryNamespace: 'ailaoda-pilot-recovery',
    applicationIngress: { name: 'ailaoda-app', className: 'nginx', publicHost: 'erp.pilot.company.com' },
    applicationNetworkPolicy: {
      name: 'ailaoda-app-ingress',
      ingressControllerNamespace: 'ingress-nginx',
      ingressControllerPodLabels: { 'app.kubernetes.io/name': 'ingress-nginx' },
      observabilityNamespace: 'monitoring',
      observabilityPodLabels: { 'app.kubernetes.io/name': 'prometheus' },
      probeImage,
    },
  },
  adapters: {
    postgres: { fileName: 'postgres', sha256: 'a'.repeat(64) },
    redis: { fileName: 'redis', sha256: 'b'.repeat(64) },
    objectStorage: { fileName: 'object', sha256: 'c'.repeat(64) },
    search: { fileName: 'search', sha256: 'd'.repeat(64) },
    backup: { fileName: 'backup', sha256: 'e'.repeat(64) },
    observability: { fileName: 'observability', sha256: 'f'.repeat(64) },
  },
  postgresql: {
    kind: 'cloudnativepg', instances: 3, haAdapter: 'postgres',
    backup: {
      method: 'barman-object-store', encrypted: true, checksumEvidence: 'barman-manifest', isolatedRestore: true,
      receiptVerifier: {
        mode: 'ed25519-provider-signed', issuer: 'provider-control-plane', publicKeySha256: '1'.repeat(64),
        serviceFileName: 'receipt-service', serviceSha256: '2'.repeat(64),
      },
    },
  },
  redis: { kind: 'sentinel', dataInstances: 3, sentinelCount: 3, haAdapter: 'redis' },
  objectStorage: { kind: 'minio-distributed', dataPods: 4, haAdapter: 'object', pvcDeletePermission: false },
  search: {
    kind: 'meilisearch', servingInstances: 2, backupMethod: 'dump-to-object-store',
    isolatedRestore: true, restoreNamespace: 'ailaoda-pilot-recovery',
  },
  observability: { traceBackend: 'tempo', alertRoute: 'pilot-operations', deliveryReceiptStore: 'webhook-audit-store' },
  ai: { mode: 'local-only', externalGateway: false, paidCallBudget: 0 },
  observation: { continuousHours: 8, pilotDays: 7, collectorImageDigest: `sha256:${'8'.repeat(64)}` },
  approvals: {
    platformOwner: { issuer: 'platform-service', publicKeyFile: 'platform.pem', publicKeySha256: '3'.repeat(64) },
    databaseOwner: { issuer: 'database-service', publicKeyFile: 'database.pem', publicKeySha256: '4'.repeat(64) },
    securityOwner: { issuer: 'security-service', publicKeyFile: 'security.pem', publicKeySha256: '5'.repeat(64) },
    businessPilotOwner: { issuer: 'business-service', publicKeyFile: 'business.pem', publicKeySha256: '6'.repeat(64) },
  },
};

fs.writeFileSync(fakeKubectl, `
const fs = require('fs');
const args = process.argv.slice(2);
const stateFile = process.env.FAKE_KUBECTL_STATE;
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state));
if (args.includes('service')) {
  process.stdout.write(JSON.stringify({spec:{clusterIP:'10.96.0.20',ports:[{name:'http',port:80,targetPort:'http',protocol:'TCP'}]}}));
} else if (args.includes('endpoints')) {
  const addresses = process.env.FAKE_NO_ENDPOINTS === '1' ? [] : [{ip:'10.244.1.8'}];
  process.stdout.write(JSON.stringify({subsets:[{addresses}]}));
} else if (args[0] === 'apply') {
  let input=''; process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => input += chunk);
  process.stdin.on('end', () => { state.pod=JSON.parse(input); state.deleted=false; save(); process.stdout.write('created\\n'); });
} else if (args.includes('delete')) {
  if (process.env.FAKE_DELETE_FAIL === '1') process.exit(1);
  state.deleted=true; save(); process.stdout.write('deleted\\n');
} else if (args.includes('pod')) {
  if (!state.pod || state.deleted) process.exit(1);
  const exitCode=Number(process.env.FAKE_PROBE_EXIT || 0);
  process.stdout.write(JSON.stringify({status:{phase:exitCode===0?'Succeeded':'Failed',containerStatuses:[{state:{terminated:{exitCode}}}]}}));
} else process.exit(2);
`);

const execute = (name, extraEnv = {}) => {
  const stateFile = path.join(root, `${name}-state.json`);
  const reportFile = path.join(root, `${name}-report.json`);
  const result = spawnSync(process.execPath, [
    runner, '--provider-profile', profilePath, '--evidence', evidencePath,
    '--report', reportFile, '--kubectl', fakeKubectl, '--poll-timeout-seconds', '15',
  ], {
    encoding: 'utf8',
    env: { ...process.env, FAKE_KUBECTL_STATE: stateFile, ...extraEnv },
    timeout: 30000,
  });
  return { result, report: JSON.parse(fs.readFileSync(reportFile, 'utf8')), stateFile };
};

try {
  fs.writeFileSync(profilePath, JSON.stringify(profile));
  fs.writeFileSync(evidencePath, JSON.stringify({
    environment: 'formal-pilot', evidenceId: 'CHG-12345', commitSha: 'a'.repeat(40), imageDigest: `sha256:${'b'.repeat(64)}`,
  }));
  const bind = spawnSync(process.execPath, [verifier, profilePath, '--evidence', evidencePath, '--bind'], { encoding: 'utf8' });
  assert.equal(bind.status, 0, bind.stderr);

  const blocked = execute('blocked');
  assert.equal(blocked.result.status, 0, blocked.result.stderr);
  assert.equal(blocked.report.status, 'passed');
  assert.equal(blocked.report.outcome, 'unauthorized-service-connect-timed-out');
  assert.equal(blocked.report.cleanupVerified, true);
  assert.equal(blocked.report.probeImage, probeImage);
  assert.match(blocked.report.serviceClusterIpSha256, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(blocked.report).includes('10.96.0.20'), false);
  const pod = JSON.parse(fs.readFileSync(blocked.stateFile, 'utf8')).pod;
  assert.equal(pod.metadata.namespace, 'ailaoda-pilot-recovery');
  assert.equal(pod.spec.automountServiceAccountToken, false);
  assert.equal(pod.spec.containers[0].securityContext.allowPrivilegeEscalation, false);
  assert.deepEqual(pod.spec.containers[0].securityContext.capabilities.drop, ['ALL']);
  assert.equal(pod.spec.containers[0].image, probeImage);

  const reachable = execute('reachable', { FAKE_PROBE_EXIT: '40' });
  assert.notEqual(reachable.result.status, 0);
  assert.equal(reachable.report.status, 'failed');
  assert.equal(reachable.report.cleanupVerified, true);

  const noEndpoints = execute('no-endpoints', { FAKE_NO_ENDPOINTS: '1' });
  assert.notEqual(noEndpoints.result.status, 0);
  assert.match(noEndpoints.report.failure, /no ready endpoints/i);

  const leakedPod = execute('cleanup-failed', { FAKE_DELETE_FAIL: '1' });
  assert.notEqual(leakedPod.result.status, 0);
  assert.equal(leakedPod.report.cleanupVerified, false);
  assert.equal(leakedPod.report.status, 'failed');

  console.log('NetworkPolicy enforcement drill contract: PASSED');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
