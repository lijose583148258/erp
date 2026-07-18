const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const bindEvidence = args.includes('--bind');
const valueFor = name => {
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || '').trim() : '';
};
const requiredPath = (flag, label) => {
  const value = valueFor(flag);
  if (!value) throw new Error(`${flag} is required.`);
  const file = path.resolve(value);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`${label} does not exist.`);
  return file;
};
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const sleep = milliseconds => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const writeReport = (file, value) => {
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
};

let reportPath = '';
let evidencePath = '';
let report = { schemaVersion: 1, status: 'failed', drill: 'kubernetes-network-policy-enforcement' };
let kubectl = '';
let probeNamespace = '';
let probeName = '';
let podCreated = false;
let cleanupVerified = false;
let failure = null;

const runKubectl = (commandArgs, options = {}) => {
  const executable = kubectl.endsWith('.cjs') ? process.execPath : kubectl;
  const actualArgs = kubectl.endsWith('.cjs') ? [kubectl, ...commandArgs] : commandArgs;
  return spawnSync(executable, actualArgs, {
    encoding: 'utf8',
    input: options.input,
    timeout: options.timeout || 30000,
    maxBuffer: 2 * 1024 * 1024,
  });
};
const checkedKubectl = (commandArgs, label, options = {}) => {
  const result = runKubectl(commandArgs, options);
  if (result.error || result.status !== 0) throw new Error(`${label} failed.`);
  return result.stdout;
};

try {
  const providerProfilePath = requiredPath('--provider-profile', 'Provider profile');
  evidencePath = requiredPath('--evidence', 'Enterprise evidence');
  reportPath = path.resolve(valueFor('--report') || 'network-policy-enforcement-report.json');
  if (new Set([providerProfilePath, evidencePath, reportPath]).size !== 3) {
    throw new Error('Provider profile, evidence, and report paths must be distinct.');
  }
  kubectl = valueFor('--kubectl') || 'kubectl';
  const serviceName = valueFor('--service') || 'ailaoda-app';
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(serviceName)) throw new Error('Service name is invalid.');
  const connectTimeoutSeconds = Number(valueFor('--connect-timeout-seconds') || 8);
  const pollTimeoutSeconds = Number(valueFor('--poll-timeout-seconds') || 120);
  if (!Number.isInteger(connectTimeoutSeconds) || connectTimeoutSeconds < 3 || connectTimeoutSeconds > 30) {
    throw new Error('Connect timeout must be an integer from 3 to 30 seconds.');
  }
  if (!Number.isInteger(pollTimeoutSeconds) || pollTimeoutSeconds < 15 || pollTimeoutSeconds > 300) {
    throw new Error('Poll timeout must be an integer from 15 to 300 seconds.');
  }

  const verifier = path.join(__dirname, 'verify-formal-pilot-provider-profile.cjs');
  const verification = spawnSync(process.execPath, [
    verifier, providerProfilePath, '--evidence', evidencePath,
  ], { encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  if (verification.error || verification.status !== 0) throw new Error('Provider profile evidence binding failed.');
  const provider = JSON.parse(verification.stdout);
  const evidence = readJson(evidencePath);
  if (bindEvidence && evidence.approvals !== undefined) {
    throw new Error('Run and bind the NetworkPolicy drill before collecting production approvals.');
  }
  const requiredIdentity = ['environment', 'evidenceId', 'commitSha', 'imageDigest'];
  if (requiredIdentity.some(key => !String(evidence[key] || '').trim())) {
    throw new Error('Enterprise evidence release identity is incomplete.');
  }
  if (evidence.environment !== provider.environment) throw new Error('Evidence environment mismatch.');

  const applicationNamespace = provider.applicationNamespace;
  probeNamespace = provider.recoveryNamespace;
  const probeImage = provider.applicationNetworkPolicy?.probeImage;
  const service = JSON.parse(checkedKubectl(
    ['-n', applicationNamespace, 'get', 'service', serviceName, '-o', 'json'],
    'Application Service lookup',
  ));
  const clusterIp = String(service?.spec?.clusterIP || '').trim();
  if (!net.isIP(clusterIp) || clusterIp.toLowerCase() === 'none') throw new Error('Application Service requires a routable ClusterIP.');
  const servicePort = (service?.spec?.ports || []).find(port => port?.protocol !== 'UDP'
    && (port?.name === 'http' || Number(port?.targetPort) === 5001 || port?.targetPort === 'http'));
  if (!servicePort || !Number.isInteger(Number(servicePort.port))) throw new Error('Application HTTP Service port is missing.');
  const endpoints = JSON.parse(checkedKubectl(
    ['-n', applicationNamespace, 'get', 'endpoints', serviceName, '-o', 'json'],
    'Application endpoint lookup',
  ));
  const readyAddresses = (endpoints?.subsets || []).flatMap(subset => subset?.addresses || []);
  if (readyAddresses.length < 1) throw new Error('Application Service has no ready endpoints.');

  const startedAt = new Date().toISOString();
  probeName = `network-policy-denied-${crypto.randomBytes(5).toString('hex')}`;
  const urlHost = net.isIPv6(clusterIp) ? `[${clusterIp}]` : clusterIp;
  const command = [
    'rc=0',
    `curl --silent --show-error --output /dev/null --connect-timeout ${connectTimeoutSeconds} --max-time ${connectTimeoutSeconds} http://${urlHost}:${Number(servicePort.port)}/livez || rc=$?`,
    'if [ "$rc" -eq 28 ]; then exit 0; fi',
    'if [ "$rc" -eq 0 ]; then exit 40; fi',
    'exit "$rc"',
  ].join('; ');
  const pod = {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: probeName,
      namespace: probeNamespace,
      labels: { 'app.kubernetes.io/name': 'ailaoda-network-policy-probe' },
    },
    spec: {
      automountServiceAccountToken: false,
      restartPolicy: 'Never',
      activeDeadlineSeconds: pollTimeoutSeconds,
      securityContext: {
        runAsNonRoot: true,
        runAsUser: 10001,
        runAsGroup: 10001,
        seccompProfile: { type: 'RuntimeDefault' },
      },
      containers: [{
        name: 'denied-connectivity',
        image: probeImage,
        imagePullPolicy: 'IfNotPresent',
        command: ['/bin/sh', '-ec', command],
        securityContext: {
          allowPrivilegeEscalation: false,
          readOnlyRootFilesystem: true,
          capabilities: { drop: ['ALL'] },
        },
        resources: {
          requests: { cpu: '5m', memory: '8Mi' },
          limits: { cpu: '100m', memory: '64Mi' },
        },
      }],
    },
  };
  checkedKubectl(['apply', '-f', '-'], 'Denied probe Pod creation', { input: JSON.stringify(pod) });
  podCreated = true;

  const deadline = Date.now() + (pollTimeoutSeconds * 1000);
  let terminated = null;
  let lastPodState = 'unknown';
  while (Date.now() < deadline) {
    const observed = JSON.parse(checkedKubectl(
      ['-n', probeNamespace, 'get', 'pod', probeName, '-o', 'json'],
      'Denied probe Pod observation',
    ));
    const containerState = observed?.status?.containerStatuses?.[0]?.state || {};
    terminated = containerState.terminated || null;
    lastPodState = String(containerState.waiting?.reason || observed?.status?.phase || 'unknown')
      .replace(/[^A-Za-z0-9_.-]/g, '') || 'unknown';
    if (terminated) break;
    if (observed?.status?.phase === 'Failed') throw new Error('Denied probe Pod failed without a termination result.');
    sleep(1000);
  }
  if (!terminated) throw new Error(`Denied probe Pod did not terminate before the poll deadline (state: ${lastPodState}).`);
  if (Number(terminated.exitCode) !== 0) {
    throw new Error('Unauthorized connectivity was not rejected by a TCP timeout.');
  }

  report = {
    schemaVersion: 1,
    status: 'passed',
    drill: 'kubernetes-network-policy-enforcement',
    outcome: 'unauthorized-service-connect-timed-out',
    environment: evidence.environment,
    evidenceId: evidence.evidenceId,
    commitSha: evidence.commitSha,
    imageDigest: evidence.imageDigest,
    providerProfileSha256: provider.providerProfileSha256,
    applicationNamespace,
    probeNamespace,
    networkPolicy: provider.applicationNetworkPolicy.name,
    probeImage,
    serviceName,
    serviceClusterIpSha256: hash(clusterIp),
    servicePort: Number(servicePort.port),
    readyEndpointCount: readyAddresses.length,
    startedAt,
    finishedAt: new Date().toISOString(),
    cleanupVerified: false,
  };
} catch (error) {
  failure = error;
  report.failure = String(error?.message || 'NetworkPolicy enforcement drill failed.');
  report.finishedAt = new Date().toISOString();
} finally {
  if (podCreated) {
    const deletion = runKubectl([
      '-n', probeNamespace, 'delete', 'pod', probeName, '--ignore-not-found=true', '--wait=true', '--timeout=15s',
    ], { timeout: 30000 });
    const lookup = runKubectl(['-n', probeNamespace, 'get', 'pod', probeName, '-o', 'json']);
    cleanupVerified = !deletion.error && deletion.status === 0 && !lookup.error && lookup.status !== 0;
    if (!cleanupVerified && !failure) {
      failure = new Error('Probe Pod cleanup could not be verified.');
      report.failure = failure.message;
    }
  }
  report.cleanupVerified = cleanupVerified;
  if (failure) report.status = 'failed';
  try { writeReport(reportPath, report); } catch (error) { if (!failure) failure = error; }
}

if (failure) {
  process.stderr.write(`${String(failure.message || failure)}\n`);
  process.exit(1);
}
if (bindEvidence) {
  try {
    const evidence = readJson(evidencePath);
    evidence.networkPolicyEnforcement = {
      status: 'passed',
      environment: report.environment,
      evidenceId: report.evidenceId,
      commitSha: report.commitSha,
      imageDigest: report.imageDigest,
      providerProfileSha256: report.providerProfileSha256,
      reportSha256: hash(fs.readFileSync(reportPath)),
      finishedAt: report.finishedAt,
    };
    writeReport(evidencePath, evidence);
  } catch (error) {
    process.stderr.write(`NetworkPolicy evidence binding failed: ${String(error.message || error)}\n`);
    process.exit(1);
  }
}
process.stdout.write(`${JSON.stringify(report)}\n`);
