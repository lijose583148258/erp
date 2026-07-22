const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { execAdapterFileSync } = require('./adapter-process.cjs');

const args = process.argv.slice(2);
const valueFor = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
};
const has = name => args.includes(name);
const fail = message => {
  throw new Error(message);
};
const resolveFile = (flag, label) => {
  const value = valueFor(flag);
  if (!value) fail(`Missing ${flag}.`);
  const absolute = path.resolve(value);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) fail(`${label} file does not exist.`);
  return absolute;
};
const adapter = resolveFile('--adapter', 'Backup adapter');
const evidencePath = resolveFile('--evidence', 'Enterprise evidence');
const providerProfilePath = resolveFile('--provider-profile', 'Provider profile');
const reportValue = valueFor('--report');
if (!reportValue) fail('Missing --report.');
const reportPath = path.resolve(reportValue);
const environment = String(process.env.BACKUP_DRILL_ENVIRONMENT || '').trim();
const changeTicket = String(process.env.BACKUP_DRILL_CHANGE_TICKET || '').trim();
const appUrl = String(process.env.BACKUP_DRILL_APP_URL || '').trim().replace(/\/$/, '');
const username = String(process.env.BACKUP_DRILL_USERNAME || '').trim();
const passwordFile = String(process.env.BACKUP_DRILL_PASSWORD_FILE || '').trim();
const commitSha = String(process.env.BACKUP_DRILL_COMMIT_SHA || process.env.GITHUB_SHA || '').trim();
const imageDigest = String(process.env.BACKUP_DRILL_IMAGE_DIGEST || '').trim();
const timeoutMs = Math.max(60_000, Number(process.env.BACKUP_DRILL_TIMEOUT_MS || 3_600_000));
const maxRestoreRtoSeconds = Math.max(1, Number(process.env.BACKUP_DRILL_MAX_RESTORE_RTO_SECONDS || 1_800));
const maxBackupCompletionSeconds = Math.max(1, Number(process.env.BACKUP_DRILL_MAX_BACKUP_COMPLETION_SECONDS || 3_600));
const pollMs = Math.max(1_000, Math.min(30_000, Number(process.env.BACKUP_DRILL_POLL_MS || 5_000)));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = {
  name: 'Enterprise PostgreSQL Backup Restore Drill',
  version: '1.0',
  status: 'failed',
  environment,
  changeTicket,
  commitSha,
  imageDigest,
  startedAt: new Date().toISOString(),
  checks: [],
};
let restoreId = '';
let password = '';

if (!has('--confirm-resource-creation')) fail('Missing --confirm-resource-creation.');
if (!environment || /prod/i.test(environment)) fail('Backup drill requires a non-production staging or pilot environment.');
if (changeTicket.length < 5) fail('BACKUP_DRILL_CHANGE_TICKET is required.');
if (!/^https:\/\//.test(appUrl) && !/^http:\/\/127\.0\.0\.1(?::\d+)?$/.test(appUrl)) {
  fail('BACKUP_DRILL_APP_URL must use HTTPS, except an explicit 127.0.0.1 tunnel.');
}
if (!username) fail('BACKUP_DRILL_USERNAME is required.');
if (!passwordFile || !fs.existsSync(passwordFile) || !fs.statSync(passwordFile).isFile()) fail('Backup drill password file does not exist.');
password = fs.readFileSync(passwordFile, 'utf8').trim();
if (!password) fail('Backup drill password file is empty.');
if (!/^[0-9a-f]{40}$/.test(commitSha)) fail('Backup drill commit SHA is invalid.');
if (!/^sha256:[0-9a-f]{64}$/.test(imageDigest)) fail('Backup drill image digest is invalid.');

const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8').replace(/^\uFEFF/, ''));
if (evidence.environment !== environment || evidence.evidenceId !== changeTicket
  || evidence.commitSha !== commitSha || evidence.imageDigest !== imageDigest) {
  fail('Backup drill release identity does not match enterprise evidence.');
}
const providerVerifier = path.join(__dirname, 'verify-formal-pilot-provider-profile.cjs');
const providerOutput = execFileSync(process.execPath, [
  providerVerifier, providerProfilePath, '--evidence', evidencePath,
], {
  encoding: 'utf8',
  timeout: timeoutMs,
  stdio: ['ignore', 'pipe', 'inherit'],
}).trim();
let providerSummary;
try { providerSummary = JSON.parse(providerOutput); } catch { fail('Provider profile verifier returned invalid JSON.'); }
const adapterSha256 = crypto.createHash('sha256').update(fs.readFileSync(adapter)).digest('hex');
if (providerSummary.adapters?.backup?.fileName !== path.basename(adapter)
  || providerSummary.adapters?.backup?.sha256 !== adapterSha256) {
  fail('Backup adapter does not match the bound provider profile.');
}
report.providerProfileSha256 = providerSummary.providerProfileSha256;
report.adapterSha256 = { backup: adapterSha256 };

const check = (name, passed, details = {}) => {
  report.checks.push({ name, status: passed ? 'passed' : 'failed', ...details });
  if (!passed) fail(`Check failed: ${name}`);
};
const adapterJson = (operation, ...operationArgs) => {
  const output = execAdapterFileSync(adapter, operation, operationArgs, {
    encoding: 'utf8',
    timeout: timeoutMs,
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
  try {
    return JSON.parse(output);
  } catch {
    fail(`Backup adapter returned invalid JSON for ${operation}.`);
  }
};
const adapterRun = (operation, ...operationArgs) => {
  execAdapterFileSync(adapter, operation, operationArgs, {
    encoding: 'utf8',
    timeout: timeoutMs,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
};
const waitForStatus = async (operation, id) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = adapterJson(operation, id);
    if (status?.status === 'completed') return status;
    if (status?.status === 'failed') fail(`${operation} reported failure.`);
    if (status?.status !== 'pending') fail(`${operation} returned an unsupported status.`);
    await sleep(pollMs);
  }
  fail(`${operation} timed out.`);
};
const requestJson = async (url, init = {}) => {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  const body = await response.json().catch(() => null);
  return { response, body };
};
const writeReport = () => {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
};
const bindEvidence = () => {
  const reportHash = crypto.createHash('sha256').update(fs.readFileSync(reportPath)).digest('hex');
  evidence.postgres = {
    ...evidence.postgres,
    backupRestoreReadback: report.status === 'passed',
  };
  evidence.backupDrill = {
    status: report.status,
    environment,
    changeTicket,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    backupId: report.backupId || null,
    restoreId: report.restoreId || null,
    checksumVerified: report.checksumVerified === true,
    encrypted: report.encrypted === true,
    markerReadback: report.markerReadback === true,
    schemaCompatible: report.schemaCompatible === true,
    cleanupVerified: report.cleanupVerified === true,
    backupCompletionSeconds: report.backupCompletionSeconds ?? null,
    recoveryPointAt: report.recoveryPointAt || null,
    verifiedMarkerRpoSeconds: report.verifiedMarkerRpoSeconds ?? null,
    restoreRtoSeconds: report.restoreRtoSeconds ?? null,
    recoveredThroughAt: report.recoveredThroughAt || null,
    reportSha256: reportHash,
    providerProfileSha256: report.providerProfileSha256,
    adapterSha256: report.adapterSha256,
  };
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
};

(async () => {
  const login = await requestJson(`${appUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const token = login.body?.data?.token;
  check('audit-login', login.response.ok && Boolean(token));

  const markerTime = new Date();
  report.markerCreatedAt = markerTime.toISOString();
  const marker = `BACKUP-RESTORE-${markerTime.toISOString().replace(/[^0-9]/g, '').slice(0, 17)}`;
  const create = await requestJson(`${appUrl}/api/v1/customers`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      nameZh: marker,
      nameEn: marker,
      nameVi: marker,
      licenseNumber: `BR-${crypto.randomBytes(8).toString('hex')}`,
      creditLimit: 1,
      riskLevel: 'low',
      segment: 'direct',
      contactName: 'Backup restore audit',
      contactPhone: '0000000000',
      contactEmail: `${crypto.randomBytes(8).toString('hex')}@example.invalid`,
      address: 'Synthetic backup restore marker',
      status: 'active',
    }),
  });
  const markerId = create.body?.data?.id;
  check('synthetic-marker-created', create.response.status === 201 && Boolean(markerId));

  const backupStartedMs = Date.now();
  const backup = adapterJson('start-backup', markerId);
  check('backup-started', Boolean(backup?.backupId) && Number.isFinite(Date.parse(String(backup?.startedAt || ''))));
  report.backupId = String(backup.backupId);
  const backupStatus = await waitForStatus('backup-status', report.backupId);
  const backupCompletedMs = Date.parse(String(backupStatus.completedAt || ''));
  const recoveryPointMs = Date.parse(String(backupStatus.recoveryPointAt || ''));
  check('backup-completed', backupStatus.checksumVerified === true && backupStatus.encrypted === true
    && Number.isFinite(backupCompletedMs) && Number.isFinite(recoveryPointMs));
  report.checksumVerified = true;
  report.encrypted = true;
  report.backupCompletionSeconds = (Date.now() - backupStartedMs) / 1000;
  report.recoveryPointAt = backupStatus.recoveryPointAt;
  check('backup-completion-envelope', report.backupCompletionSeconds > 0
    && report.backupCompletionSeconds <= maxBackupCompletionSeconds, {
    backupCompletionSeconds: report.backupCompletionSeconds,
    maxBackupCompletionSeconds,
  });
  check('backup-recovery-point-covers-marker', recoveryPointMs >= markerTime.getTime(), {
    markerCreatedAt: markerTime.toISOString(),
    recoveryPointAt: backupStatus.recoveryPointAt,
  });

  restoreId = `ailaoda-restore-${crypto.randomBytes(8).toString('hex')}`;
  const restoreStartedMs = Date.now();
  const restore = adapterJson('restore-isolated', report.backupId, restoreId);
  check('isolated-restore-started', restore?.restoreId === restoreId && Number.isFinite(Date.parse(String(restore?.startedAt || ''))));
  report.restoreId = restoreId;
  const restoreStatus = await waitForStatus('restore-status', restoreId);
  const recoveredThroughMs = Date.parse(String(restoreStatus.recoveredThroughAt || ''));
  check('isolated-restore-completed', Number.isFinite(Date.parse(String(restoreStatus.completedAt || '')))
    && Number.isFinite(recoveredThroughMs) && recoveredThroughMs >= markerTime.getTime());
  report.restoreRtoSeconds = (Date.now() - restoreStartedMs) / 1000;
  check('restore-rto-envelope', report.restoreRtoSeconds <= maxRestoreRtoSeconds, {
    restoreRtoSeconds: report.restoreRtoSeconds,
    maxRestoreRtoSeconds,
  });

  const markerVerification = adapterJson('verify-marker', restoreId, markerId);
  check('restored-marker-readback', markerVerification?.found === true && markerVerification?.schemaCompatible === true);
  report.markerReadback = true;
  report.schemaCompatible = true;
  report.verifiedMarkerRpoSeconds = 0;
  report.recoveredThroughAt = restoreStatus.recoveredThroughAt;

  adapterRun('cleanup', restoreId);
  const cleanup = adapterJson('cleanup-status', restoreId);
  check('isolated-restore-cleanup', cleanup?.removed === true);
  report.cleanupVerified = true;
  restoreId = '';
  report.status = 'passed';
})().catch(error => {
  report.error = String(error?.message || error);
  process.exitCode = 1;
}).finally(() => {
  if (restoreId) {
    try {
      adapterRun('cleanup', restoreId);
      const cleanup = adapterJson('cleanup-status', restoreId);
      report.cleanupVerified = cleanup?.removed === true;
    } catch (error) {
      report.cleanupError = String(error?.message || error);
    }
  }
  report.finishedAt = new Date().toISOString();
  writeReport();
  bindEvidence();
  console.log(`Enterprise backup restore drill: ${report.status.toUpperCase()}`);
  console.log(`Report: ${reportPath}`);
});
