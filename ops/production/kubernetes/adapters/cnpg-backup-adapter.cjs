#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const operation = String(process.argv[2] || '').trim();
const operationArgs = process.argv.slice(3).map(value => String(value).trim());
const namespace = String(process.env.CNPG_BACKUP_NAMESPACE || '').trim();
const cluster = String(process.env.CNPG_BACKUP_CLUSTER || '').trim();
const recoveryNamespace = String(process.env.CNPG_BACKUP_RECOVERY_NAMESPACE || '').trim();
const restoreTemplateFile = path.resolve(String(process.env.CNPG_BACKUP_RESTORE_TEMPLATE_FILE || ''));
const receiptUrl = String(process.env.CNPG_BACKUP_RECEIPT_URL || '').trim().replace(/\/$/, '');
const receiptTokenFile = path.resolve(String(process.env.CNPG_BACKUP_RECEIPT_TOKEN_FILE || ''));
const stateRoot = path.resolve(String(process.env.CNPG_BACKUP_STATE_DIR || '/tmp/ailaoda-cnpg-backup'));
const timeoutMs = Math.max(10_000, Number(process.env.CNPG_BACKUP_TIMEOUT_MS || 120_000));
const database = String(process.env.CNPG_BACKUP_DATABASE || 'app').trim();
const markerTable = String(process.env.CNPG_BACKUP_MARKER_TABLE || 'Customer').trim();
const markerColumn = String(process.env.CNPG_BACKUP_MARKER_COLUMN || 'id').trim();
const backupMethod = String(process.env.CNPG_BACKUP_METHOD || 'plugin').trim();
const pluginName = String(process.env.CNPG_BACKUP_PLUGIN_NAME || 'barman-cloud.cloudnative-pg.io').trim();

const fail = message => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};
const dnsLabel = value => /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/.test(value);
const safeMarker = value => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const isoTime = value => Number.isFinite(Date.parse(String(value || '')));
const fileExists = file => Boolean(file) && fs.existsSync(file) && fs.statSync(file).isFile();
const privateFile = file => {
  if (process.platform === 'win32') return true;
  const stat = fs.statSync(file);
  if ((stat.mode & 0o007) !== 0 || (stat.mode & 0o022) !== 0) return false;
  return (stat.mode & 0o040) === 0
    || (typeof process.getegid === 'function' && stat.gid === process.getegid());
};
if (!dnsLabel(namespace) || !dnsLabel(cluster) || !dnsLabel(recoveryNamespace)) {
  fail('CNPG backup namespace, cluster, and recovery namespace must be DNS labels.');
}
if (namespace === recoveryNamespace) fail('CNPG backup restore requires a dedicated recovery namespace.');
if (!fileExists(restoreTemplateFile)) fail('CNPG_BACKUP_RESTORE_TEMPLATE_FILE does not exist.');
if (!fileExists(receiptTokenFile) || !privateFile(receiptTokenFile)) {
  fail('CNPG backup receipt token file is missing or accessible by group/other users.');
}
if (!/^https:\/\//i.test(receiptUrl) && !/^http:\/\/127\.0\.0\.1(?::\d+)?$/i.test(receiptUrl)) {
  fail('CNPG_BACKUP_RECEIPT_URL must use HTTPS; loopback HTTP is contract-only.');
}
if (!/^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/.test(database)
  || !/^[A-Za-z_][A-Za-z0-9_$]{0,62}$/.test(markerTable)
  || !/^[A-Za-z_][A-Za-z0-9_$]{0,62}$/.test(markerColumn)) {
  fail('Database, marker table, and marker column must be simple identifiers.');
}
if (!['plugin', 'barmanObjectStore'].includes(backupMethod)) fail('CNPG_BACKUP_METHOD must be plugin or barmanObjectStore.');
if (backupMethod === 'plugin' && !pluginName) fail('CNPG_BACKUP_PLUGIN_NAME is required for plugin backups.');

const kubectlResult = (args, options = {}) => spawnSync('kubectl', args, {
  encoding: 'utf8',
  timeout: timeoutMs,
  input: options.input,
  stdio: options.input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
});
const kubectl = (args, options = {}) => {
  const result = kubectlResult(args, options);
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
  if (!dnsLabel(id)) fail('Resource ID must be a DNS label.');
  fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  const target = statePath(id);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, target);
};
const readState = id => {
  if (!dnsLabel(id) || !fileExists(statePath(id))) fail('CNPG backup adapter state is missing.');
  return JSON.parse(fs.readFileSync(statePath(id), 'utf8'));
};
const token = fs.readFileSync(receiptTokenFile, 'utf8').trim();
if (!token) fail('CNPG backup receipt token file is empty.');

const receiptFor = async backupId => {
  const response = await fetch(`${receiptUrl}/v1/cnpg/backups/${encodeURIComponent(namespace)}/${encodeURIComponent(backupId)}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) fail('Backup receipt service did not return an accepted receipt.');
  if (body.backupId !== backupId || body.cluster !== cluster
    || body.encrypted !== true || body.checksumVerified !== true
    || !['sha256', 'barman-manifest'].includes(body.checksumAlgorithm)
    || !isoTime(body.completedAt) || !isoTime(body.recoveryPointAt)) {
    fail('Backup receipt is incomplete, unencrypted, unchecked, or scoped to another backup.');
  }
  if (body.checksumAlgorithm === 'sha256' && !/^[0-9a-f]{64}$/.test(String(body.manifestSha256 || ''))) {
    fail('Backup receipt SHA-256 is invalid.');
  }
  return body;
};
const backupResource = backupId => ({
  apiVersion: 'postgresql.cnpg.io/v1',
  kind: 'Backup',
  metadata: {
    name: backupId,
    namespace,
    labels: {
      'app.kubernetes.io/managed-by': 'ailaoda-enterprise-admission',
      'erp.ailaoda.io/drill': 'backup-restore',
    },
  },
  spec: {
    cluster: { name: cluster },
    method: backupMethod,
    target: 'prefer-standby',
    ...(backupMethod === 'plugin' ? { pluginConfiguration: { name: pluginName } } : {}),
  },
});
const loadRestoreTemplate = () => {
  let resource;
  try { resource = JSON.parse(fs.readFileSync(restoreTemplateFile, 'utf8').replace(/^\uFEFF/, '')); }
  catch { fail('CNPG restore template must be valid JSON.'); }
  if (resource?.apiVersion !== 'postgresql.cnpg.io/v1' || resource?.kind !== 'Cluster') {
    fail('CNPG restore template must be a postgresql.cnpg.io/v1 Cluster.');
  }
  if (resource?.metadata?.namespace !== recoveryNamespace
    || resource?.metadata?.annotations?.['erp.ailaoda.io/backup-adapter-template'] !== 'v1') {
    fail('CNPG restore template must be explicitly approved for the configured recovery namespace.');
  }
  if (resource?.spec?.bootstrap?.recovery?.source !== 'source'
    || !Array.isArray(resource?.spec?.externalClusters)
    || resource.spec.externalClusters.length !== 1
    || resource.spec.externalClusters[0]?.name !== 'source') {
    fail('CNPG restore template must recover from exactly one external cluster named source.');
  }
  if (resource?.spec?.plugins?.some(plugin => plugin?.isWALArchiver === true)) {
    fail('Isolated restore template must not archive WAL into a writable backup destination.');
  }
  return resource;
};
const restoreResource = (backupState, restoreId) => {
  const resource = loadRestoreTemplate();
  delete resource.status;
  delete resource.metadata.uid;
  delete resource.metadata.resourceVersion;
  delete resource.metadata.creationTimestamp;
  delete resource.metadata.managedFields;
  resource.metadata.name = restoreId;
  resource.metadata.namespace = recoveryNamespace;
  resource.metadata.labels = {
    ...(resource.metadata.labels || {}),
    'app.kubernetes.io/managed-by': 'ailaoda-enterprise-admission',
    'erp.ailaoda.io/restore-id': restoreId,
    'erp.ailaoda.io/source-backup': backupState.backupId,
  };
  resource.spec.instances = 1;
  resource.spec.bootstrap.recovery.recoveryTarget = {
    ...(resource.spec.bootstrap.recovery.recoveryTarget || {}),
    targetTime: backupState.recoveryPointAt,
  };
  return resource;
};
const clusterReady = resource => Number(resource?.status?.readyInstances || 0) >= 1
  && Boolean(String(resource?.status?.currentPrimary || resource?.status?.writeService || '').trim())
  && !/fail|error/i.test(String(resource?.status?.phase || ''));
const primaryPod = restoreId => {
  const pods = kubectlJson(['get', 'pods', '-n', recoveryNamespace, '-l',
    `cnpg.io/cluster=${restoreId},cnpg.io/instanceRole=primary`, '-o', 'json']);
  const pod = (pods.items || []).find(item => item?.status?.phase === 'Running'
    && item?.status?.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True'));
  if (!pod?.metadata?.name) fail('Restored CloudNativePG primary pod is not Ready.');
  return pod.metadata.name;
};

(async () => {
  switch (operation) {
    case 'start-backup': {
      if (process.env.CNPG_BACKUP_ALLOW_RESOURCE_CREATION !== 'true') {
        fail('CNPG_BACKUP_ALLOW_RESOURCE_CREATION=true is required for the approved pilot drill.');
      }
      const markerId = operationArgs[0];
      if (!safeMarker(markerId)) fail('A valid marker ID is required.');
      const backupId = `ailaoda-${Date.now().toString(36)}-${require('crypto').randomBytes(4).toString('hex')}`;
      createJson(backupResource(backupId));
      writeState(backupId, { backupId, markerId, namespace, cluster, startedAt: new Date().toISOString() });
      process.stdout.write(`${JSON.stringify({ backupId, startedAt: new Date().toISOString() })}\n`);
      break;
    }
    case 'backup-status': {
      const backupId = operationArgs[0];
      const state = readState(backupId);
      const resource = kubectlJson(['get', 'backup.postgresql.cnpg.io', backupId, '-n', namespace, '-o', 'json']);
      const phase = String(resource?.status?.phase || '').toLowerCase();
      if (/fail|error/.test(phase) || resource?.status?.error) {
        process.stdout.write(`${JSON.stringify({ status: 'failed', backupId })}\n`);
        break;
      }
      if (phase !== 'completed') {
        process.stdout.write(`${JSON.stringify({ status: 'pending', backupId })}\n`);
        break;
      }
      const stoppedAt = resource?.status?.stoppedAt;
      if (!isoTime(resource?.status?.startedAt) || !isoTime(stoppedAt)
        || !String(resource?.status?.endWal || '').trim()) {
        fail('Completed CNPG Backup lacks start, stop, or ending WAL evidence.');
      }
      const receipt = await receiptFor(backupId);
      const clockSkewMs = Math.abs(Date.parse(receipt.completedAt) - Date.parse(stoppedAt));
      if (clockSkewMs > 300_000 || Date.parse(receipt.recoveryPointAt) < Date.parse(stoppedAt)) {
        fail('Backup receipt timing does not cover the completed CNPG Backup.');
      }
      const completed = {
        ...state,
        status: 'completed',
        completedAt: receipt.completedAt,
        recoveryPointAt: receipt.recoveryPointAt,
        checksumVerified: true,
        encrypted: true,
        objectStoreBackupId: String(receipt.objectStoreBackupId || ''),
        checksumAlgorithm: receipt.checksumAlgorithm,
        manifestSha256: receipt.manifestSha256 || null,
      };
      writeState(backupId, completed);
      process.stdout.write(`${JSON.stringify(completed)}\n`);
      break;
    }
    case 'restore-isolated': {
      if (process.env.CNPG_BACKUP_ALLOW_RESOURCE_CREATION !== 'true') {
        fail('CNPG_BACKUP_ALLOW_RESOURCE_CREATION=true is required for the approved pilot drill.');
      }
      const [backupId, restoreId] = operationArgs;
      if (!dnsLabel(restoreId)) fail('A valid restore ID is required.');
      const backupState = readState(backupId);
      if (backupState.status !== 'completed' || backupState.checksumVerified !== true || backupState.encrypted !== true) {
        fail('Only an attested completed backup may be restored.');
      }
      createJson(restoreResource(backupState, restoreId));
      writeState(restoreId, {
        restoreId, backupId, markerId: backupState.markerId,
        recoveryPointAt: backupState.recoveryPointAt, startedAt: new Date().toISOString(),
      });
      process.stdout.write(`${JSON.stringify({ restoreId, startedAt: new Date().toISOString() })}\n`);
      break;
    }
    case 'restore-status': {
      const restoreId = operationArgs[0];
      const state = readState(restoreId);
      const resource = kubectlJson(['get', 'cluster.postgresql.cnpg.io', restoreId, '-n', recoveryNamespace, '-o', 'json']);
      if (/fail|error/i.test(String(resource?.status?.phase || ''))) {
        process.stdout.write(`${JSON.stringify({ status: 'failed', restoreId })}\n`);
      } else if (clusterReady(resource)) {
        process.stdout.write(`${JSON.stringify({
          status: 'completed', restoreId, completedAt: new Date().toISOString(),
          recoveredThroughAt: state.recoveryPointAt,
        })}\n`);
      } else {
        process.stdout.write(`${JSON.stringify({ status: 'pending', restoreId })}\n`);
      }
      break;
    }
    case 'verify-marker': {
      const [restoreId, markerId] = operationArgs;
      const state = readState(restoreId);
      if (!safeMarker(markerId) || markerId !== state.markerId) fail('Marker ID does not match restore state.');
      const pod = primaryPod(restoreId);
      const sql = `SELECT CASE WHEN EXISTS (SELECT 1 FROM "${markerTable}" WHERE "${markerColumn}" = '${markerId}') THEN 'found' ELSE 'missing' END;`;
      const output = kubectl([
        'exec', '-n', recoveryNamespace, pod, '-c', 'postgres', '--',
        'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', database, '-c', sql,
      ]);
      const found = output.split(/\r?\n/).map(value => value.trim()).includes('found');
      process.stdout.write(`${JSON.stringify({ found, schemaCompatible: true })}\n`);
      break;
    }
    case 'cleanup': {
      const restoreId = operationArgs[0];
      readState(restoreId);
      kubectl(['delete', 'cluster.postgresql.cnpg.io', restoreId, '-n', recoveryNamespace, '--wait=false']);
      break;
    }
    case 'cleanup-status': {
      const restoreId = operationArgs[0];
      readState(restoreId);
      const result = kubectlResult(['get', 'cluster.postgresql.cnpg.io', restoreId, '-n', recoveryNamespace, '-o', 'json']);
      if (result.error) fail(`kubectl failed: ${result.error.message}`);
      process.stdout.write(`${JSON.stringify({ removed: result.status !== 0 })}\n`);
      break;
    }
    default:
      fail('Unsupported operation. Expected start-backup, backup-status, restore-isolated, restore-status, verify-marker, cleanup, or cleanup-status.');
  }
})().catch(error => fail(String(error?.message || error)));
