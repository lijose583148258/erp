#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const operation = String(process.argv[2] || '').trim();
const operationArgs = process.argv.slice(3).map(value => String(value).trim());
const namespace = String(process.env.MEILI_K8S_NAMESPACE || '').trim();
const recoveryNamespace = String(process.env.MEILI_K8S_RECOVERY_NAMESPACE || '').trim();
const selector = String(process.env.MEILI_K8S_SELECTOR || '').trim();
const dataVolumeName = String(process.env.MEILI_K8S_DATA_VOLUME_NAME || '').trim();
const snapshotClass = String(process.env.MEILI_K8S_SNAPSHOT_CLASS || '').trim();
const endpointMapFile = path.resolve(String(process.env.MEILI_K8S_ENDPOINT_MAP_FILE || ''));
const tokenFile = path.resolve(String(process.env.MEILI_K8S_TOKEN_FILE || ''));
const restoreUrlTemplate = String(process.env.MEILI_K8S_RESTORE_URL_TEMPLATE || '').trim();
const restoreImage = String(process.env.MEILI_K8S_RESTORE_IMAGE || '').trim();
const restoreSecret = String(process.env.MEILI_K8S_RESTORE_SECRET || '').trim();
const restoreSecretKey = String(process.env.MEILI_K8S_RESTORE_SECRET_KEY || 'masterKey').trim();
const restoreStorage = String(process.env.MEILI_K8S_RESTORE_STORAGE || '10Gi').trim();
const indexUid = String(process.env.MEILI_K8S_INDEX_UID || 'orders').trim();
const stateRoot = path.resolve(String(process.env.MEILI_K8S_STATE_DIR || '/tmp/ailaoda-meili-drill'));
const timeoutMs = Math.max(10_000, Number(process.env.MEILI_K8S_TIMEOUT_MS || 120_000));
const minimumReady = Math.max(2, Number(process.env.MEILI_K8S_MIN_READY || 2));

const fail = message => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};
const dnsLabel = value => /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/.test(value);
const safeValue = value => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const fileExists = file => Boolean(file) && fs.existsSync(file) && fs.statSync(file).isFile();
const privateFile = file => process.platform === 'win32' || (fs.statSync(file).mode & 0o077) === 0;
const validUrl = value => /^https:\/\//i.test(value) || /^http:\/\/127\.0\.0\.1(?::\d+)?(?:\/|$)/i.test(value);
if (!dnsLabel(namespace) || !dnsLabel(recoveryNamespace) || namespace === recoveryNamespace) {
  fail('Meilisearch source and recovery namespaces must be distinct DNS labels.');
}
if (!selector || !dataVolumeName || !snapshotClass) {
  fail('MEILI_K8S_SELECTOR, MEILI_K8S_DATA_VOLUME_NAME, and MEILI_K8S_SNAPSHOT_CLASS are required.');
}
for (const file of [endpointMapFile, tokenFile]) {
  if (!fileExists(file) || !privateFile(file)) fail('Meilisearch endpoint map and token files must exist with private permissions.');
}
if (!restoreUrlTemplate.includes('{restoreId}')
  || !validUrl(restoreUrlTemplate.replace('{restoreId}', 'restore-check'))) {
  fail('MEILI_K8S_RESTORE_URL_TEMPLATE must be HTTPS and contain {restoreId}; loopback HTTP is contract-only.');
}
if (!/^\S+@sha256:[0-9a-f]{64}$/.test(restoreImage)) fail('MEILI_K8S_RESTORE_IMAGE must be pinned by SHA-256 digest.');
if (!dnsLabel(restoreSecret) || !/^[A-Za-z0-9._-]{1,253}$/.test(restoreSecretKey)) {
  fail('Restore secret name or key is invalid.');
}
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(indexUid)) fail('MEILI_K8S_INDEX_UID is invalid.');

let endpointMap;
try { endpointMap = JSON.parse(fs.readFileSync(endpointMapFile, 'utf8').replace(/^\uFEFF/, '')); }
catch { fail('MEILI_K8S_ENDPOINT_MAP_FILE must be valid JSON.'); }
if (!endpointMap || typeof endpointMap !== 'object' || Array.isArray(endpointMap)) fail('Meilisearch endpoint map must be an object.');
for (const [pod, url] of Object.entries(endpointMap)) {
  if (!dnsLabel(pod) || !validUrl(String(url))) fail('Meilisearch endpoint map contains an invalid pod or URL.');
}
const token = fs.readFileSync(tokenFile, 'utf8').trim();
if (!token) fail('Meilisearch token file is empty.');

const kubeResult = (args, options = {}) => spawnSync('kubectl', args, {
  encoding: 'utf8',
  timeout: timeoutMs,
  input: options.input,
  stdio: options.input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
});
const kubectl = (args, options = {}) => {
  const result = kubeResult(args, options);
  if (result.error) fail(`kubectl failed: ${result.error.message}`);
  if (result.status !== 0) fail(String(result.stderr || 'kubectl command failed.').trim());
  return String(result.stdout || '').trim();
};
const kubectlJson = args => {
  const output = kubectl(args);
  try { return JSON.parse(output); } catch { fail(`kubectl returned invalid JSON for: ${args.join(' ')}`); }
};
const createJson = resource => kubectl(['create', '-f', '-'], { input: `${JSON.stringify(resource)}\n` });
const statePath = id => path.join(stateRoot, `${id}.json`);
const writeState = (id, state) => {
  if (!dnsLabel(id)) fail('Meilisearch operation ID must be a DNS label.');
  fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  const target = statePath(id);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, target);
};
const readState = id => {
  if (!dnsLabel(id) || !fileExists(statePath(id))) fail('Meilisearch adapter state is missing.');
  return JSON.parse(fs.readFileSync(statePath(id), 'utf8'));
};
const podReady = pod => pod?.status?.phase === 'Running'
  && pod?.status?.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True');
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
  return (pods.items || []).filter(podReady).map(pod => {
    const id = String(pod?.metadata?.name || '');
    const volume = (pod?.spec?.volumes || []).find(item => item?.name === dataVolumeName);
    return {
      id,
      failureDomain: zones.get(String(pod?.spec?.nodeName || '')) || '',
      url: String(endpointMap[id] || ''),
      pvc: String(volume?.persistentVolumeClaim?.claimName || ''),
    };
  }).filter(item => item.id && item.failureDomain && item.url && item.pvc)
    .sort((a, b) => a.id.localeCompare(b.id));
};
const topology = () => {
  const endpoints = readyEndpoints();
  const failureDomains = [...new Set(endpoints.map(item => item.failureDomain))];
  if (endpoints.length < minimumReady) fail(`Meilisearch drill requires at least ${minimumReady} Ready serving pods.`);
  if (failureDomains.length < 2) fail('Meilisearch serving pods are not spread across at least two zones.');
  return { failureDomains, instanceCount: endpoints.length, observedAt: new Date().toISOString() };
};
const discover = () => {
  const endpoint = readyEndpoints()[0];
  if (!endpoint) fail('No Ready Meilisearch endpoint was discovered.');
  return endpoint;
};
const restoreUrl = restoreId => restoreUrlTemplate.replaceAll('{restoreId}', restoreId).replace(/\/$/, '');
const requestJson = async (baseUrl, pathname, options = {}) => {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${pathname}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json().catch(() => null);
  return { response, body };
};
const documentAt = async (baseUrl, markerId) => requestJson(
  baseUrl,
  `/indexes/${encodeURIComponent(indexUid)}/documents/${encodeURIComponent(markerId)}`,
);
const statsAt = async baseUrl => requestJson(baseUrl, `/indexes/${encodeURIComponent(indexUid)}/stats`);
const snapshotResource = (backupId, pvc) => ({
  apiVersion: 'snapshot.storage.k8s.io/v1',
  kind: 'VolumeSnapshot',
  metadata: {
    name: backupId,
    namespace,
    labels: {
      'app.kubernetes.io/managed-by': 'ailaoda-enterprise-admission',
      'erp.ailaoda.io/search-backup': backupId,
    },
  },
  spec: {
    volumeSnapshotClassName: snapshotClass,
    source: { persistentVolumeClaimName: pvc },
  },
});
const restoreResources = (backupId, restoreId) => ({
  apiVersion: 'v1',
  kind: 'List',
  items: [
    {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: {
        name: restoreId,
        namespace: recoveryNamespace,
        labels: { 'erp.ailaoda.io/search-restore': restoreId },
      },
      spec: {
        accessModes: ['ReadWriteOnce'],
        resources: { requests: { storage: restoreStorage } },
        dataSource: {
          apiGroup: 'snapshot.storage.k8s.io',
          kind: 'VolumeSnapshot',
          name: backupId,
        },
      },
    },
    {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        name: restoreId,
        namespace: recoveryNamespace,
        labels: { 'erp.ailaoda.io/search-restore': restoreId },
      },
      spec: {
        replicas: 1,
        selector: { matchLabels: { 'erp.ailaoda.io/search-restore': restoreId } },
        template: {
          metadata: { labels: { 'erp.ailaoda.io/search-restore': restoreId } },
          spec: {
            automountServiceAccountToken: false,
            containers: [{
              name: 'meilisearch',
              image: restoreImage,
              imagePullPolicy: 'IfNotPresent',
              args: ['--db-path=/meili_data/data.ms', '--http-addr=0.0.0.0:7700'],
              env: [{
                name: 'MEILI_MASTER_KEY',
                valueFrom: { secretKeyRef: { name: restoreSecret, key: restoreSecretKey } },
              }],
              ports: [{ name: 'http', containerPort: 7700 }],
              readinessProbe: { httpGet: { path: '/health', port: 'http' }, initialDelaySeconds: 5, periodSeconds: 5 },
              securityContext: {
                allowPrivilegeEscalation: false,
                capabilities: { drop: ['ALL'] },
                runAsNonRoot: true,
                seccompProfile: { type: 'RuntimeDefault' },
              },
              volumeMounts: [{ name: 'data', mountPath: '/meili_data' }],
            }],
            volumes: [{ name: 'data', persistentVolumeClaim: { claimName: restoreId } }],
          },
        },
      },
    },
    {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name: restoreId,
        namespace: recoveryNamespace,
        labels: { 'erp.ailaoda.io/search-restore': restoreId },
      },
      spec: {
        selector: { 'erp.ailaoda.io/search-restore': restoreId },
        ports: [{ name: 'http', port: 7700, targetPort: 'http' }],
      },
    },
  ],
});

(async () => {
  switch (operation) {
    case 'topology':
      process.stdout.write(`${JSON.stringify(topology())}\n`);
      break;
    case 'discover': {
      const endpoint = discover();
      process.stdout.write(`${JSON.stringify({ id: endpoint.id, failureDomain: endpoint.failureDomain })}\n`);
      break;
    }
    case 'fail-primary': {
      const injectionId = operationArgs[0];
      if (!dnsLabel(injectionId)) fail('A valid failure injection ID is required.');
      if (process.env.MEILI_K8S_ALLOW_POD_DELETE !== 'true') {
        fail('MEILI_K8S_ALLOW_POD_DELETE=true is required for the approved pilot drill.');
      }
      topology();
      const endpoint = discover();
      writeState(injectionId, { injectionId, endpoint, namespace, selector, injectedAt: new Date().toISOString() });
      kubectl(['delete', 'pod', endpoint.id, '-n', namespace, '--wait=false']);
      break;
    }
    case 'recover': {
      const injectionId = operationArgs[0];
      const state = readState(injectionId);
      if (state.namespace !== namespace || state.selector !== selector) fail('Meilisearch recovery state scope mismatch.');
      const seconds = Math.max(10, Math.ceil(timeoutMs / 1000));
      kubectl(['wait', '--for=condition=Ready', `pod/${state.endpoint.id}`, '-n', namespace, `--timeout=${seconds}s`]);
      break;
    }
    case 'recovery-status': {
      const state = readState(operationArgs[0]);
      const result = kubeResult(['get', 'pod', state.endpoint.id, '-n', namespace, '-o', 'json']);
      let recovered = false;
      if (result.status === 0) {
        try { recovered = podReady(JSON.parse(result.stdout)); } catch { recovered = false; }
      }
      process.stdout.write(`${JSON.stringify({ recovered })}\n`);
      break;
    }
    case 'verify-live-query': {
      const markerId = operationArgs[0];
      if (!safeValue(markerId)) fail('A valid marker ID is required.');
      const endpoint = discover();
      const document = await documentAt(endpoint.url, markerId);
      process.stdout.write(`${JSON.stringify({
        found: document.response.ok,
        endpointId: endpoint.id,
        failureDomain: endpoint.failureDomain,
      })}\n`);
      break;
    }
    case 'start-backup': {
      const markerId = operationArgs[0];
      if (!safeValue(markerId)) fail('A valid marker ID is required.');
      if (process.env.MEILI_K8S_ALLOW_RESOURCE_CREATION !== 'true') {
        fail('MEILI_K8S_ALLOW_RESOURCE_CREATION=true is required for the approved pilot drill.');
      }
      const endpoint = discover();
      const [document, stats, dump] = await Promise.all([
        documentAt(endpoint.url, markerId),
        statsAt(endpoint.url),
        requestJson(endpoint.url, '/dumps', { method: 'POST' }),
      ]);
      const taskUid = dump.body?.taskUid ?? dump.body?.uid;
      const documentCount = Number(stats.body?.numberOfDocuments);
      if (!document.response.ok || !stats.response.ok || !dump.response.ok
        || !Number.isInteger(taskUid) || !Number.isInteger(documentCount) || documentCount < 1) {
        fail('Meilisearch dump could not be tied to a live marker and document count.');
      }
      const backupId = `meili-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
      const startedAt = new Date().toISOString();
      writeState(backupId, {
        backupId, markerId, taskUid, documentCount, sourceEndpoint: endpoint,
        phase: 'dump-pending', startedAt,
      });
      process.stdout.write(`${JSON.stringify({ backupId, startedAt })}\n`);
      break;
    }
    case 'backup-status': {
      const backupId = operationArgs[0];
      const state = readState(backupId);
      if (state.phase === 'dump-pending') {
        const task = await requestJson(state.sourceEndpoint.url, `/tasks/${state.taskUid}`);
        const taskStatus = String(task.body?.status || '').toLowerCase();
        if (!task.response.ok || ['failed', 'canceled'].includes(taskStatus)) {
          process.stdout.write(`${JSON.stringify({ status: 'failed', backupId })}\n`);
          break;
        }
        if (taskStatus !== 'succeeded') {
          process.stdout.write(`${JSON.stringify({ status: 'pending', backupId })}\n`);
          break;
        }
        const dumpUid = String(task.body?.details?.dumpUid || '').trim();
        if (!safeValue(dumpUid)) fail('Completed Meilisearch dump task lacks a valid dump UID.');
        createJson(snapshotResource(backupId, state.sourceEndpoint.pvc));
        writeState(backupId, { ...state, phase: 'snapshot-pending', dumpUid, snapshotCreatedAt: new Date().toISOString() });
        process.stdout.write(`${JSON.stringify({ status: 'pending', backupId })}\n`);
        break;
      }
      if (state.phase !== 'snapshot-pending' && state.phase !== 'completed') fail('Unsupported search backup state.');
      const snapshot = kubectlJson(['get', 'volumesnapshot.snapshot.storage.k8s.io', backupId, '-n', namespace, '-o', 'json']);
      if (snapshot?.status?.error) {
        process.stdout.write(`${JSON.stringify({ status: 'failed', backupId })}\n`);
      } else if (snapshot?.status?.readyToUse === true
        && String(snapshot?.status?.boundVolumeSnapshotContentName || '').trim()) {
        const completedAt = new Date().toISOString();
        const completed = { ...state, phase: 'completed', status: 'completed', completedAt };
        writeState(backupId, completed);
        process.stdout.write(`${JSON.stringify(completed)}\n`);
      } else {
        process.stdout.write(`${JSON.stringify({ status: 'pending', backupId })}\n`);
      }
      break;
    }
    case 'restore-isolated': {
      const [backupId, restoreId] = operationArgs;
      if (!dnsLabel(restoreId)) fail('A valid restore ID is required.');
      if (process.env.MEILI_K8S_ALLOW_RESOURCE_CREATION !== 'true') {
        fail('MEILI_K8S_ALLOW_RESOURCE_CREATION=true is required for the approved pilot drill.');
      }
      const backup = readState(backupId);
      if (backup.phase !== 'completed') fail('Only a completed CSI snapshot may be restored.');
      createJson(restoreResources(backupId, restoreId));
      const startedAt = new Date().toISOString();
      writeState(restoreId, {
        restoreId, backupId, markerId: backup.markerId,
        documentCount: backup.documentCount, startedAt,
      });
      process.stdout.write(`${JSON.stringify({ restoreId, startedAt })}\n`);
      break;
    }
    case 'restore-status': {
      const restoreId = operationArgs[0];
      readState(restoreId);
      const deployment = kubectlJson(['get', 'deployment.apps', restoreId, '-n', recoveryNamespace, '-o', 'json']);
      if (Number(deployment?.status?.availableReplicas || 0) < 1) {
        process.stdout.write(`${JSON.stringify({ status: 'pending', restoreId })}\n`);
        break;
      }
      const health = await requestJson(restoreUrl(restoreId), '/health');
      process.stdout.write(`${JSON.stringify({
        status: health.response.ok && health.body?.status === 'available' ? 'completed' : 'pending',
        restoreId,
      })}\n`);
      break;
    }
    case 'verify-restored-query': {
      const [restoreId, markerId] = operationArgs;
      const state = readState(restoreId);
      if (!safeValue(markerId) || markerId !== state.markerId) fail('Marker ID does not match restore state.');
      const [document, stats] = await Promise.all([
        documentAt(restoreUrl(restoreId), markerId),
        statsAt(restoreUrl(restoreId)),
      ]);
      process.stdout.write(`${JSON.stringify({
        found: document.response.ok,
        documentCountMatched: stats.response.ok
          && Number(stats.body?.numberOfDocuments) === state.documentCount,
      })}\n`);
      break;
    }
    case 'cleanup': {
      const restoreId = operationArgs[0];
      readState(restoreId);
      kubectl(['delete', 'deployment.apps', restoreId, 'service', restoreId,
        'persistentvolumeclaim', restoreId, '-n', recoveryNamespace, '--wait=false']);
      break;
    }
    case 'cleanup-status': {
      const restoreId = operationArgs[0];
      readState(restoreId);
      const kinds = ['deployment.apps', 'service', 'persistentvolumeclaim'];
      const removed = kinds.every(kind => kubeResult(['get', kind, restoreId, '-n', recoveryNamespace, '-o', 'json']).status !== 0);
      process.stdout.write(`${JSON.stringify({ removed })}\n`);
      break;
    }
    default:
      fail('Unsupported operation. Expected topology, discover, fail-primary, recover, recovery-status, verify-live-query, start-backup, backup-status, restore-isolated, restore-status, verify-restored-query, cleanup, or cleanup-status.');
  }
})().catch(error => fail(String(error?.message || error)));
