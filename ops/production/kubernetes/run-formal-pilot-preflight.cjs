const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const valueFor = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
};
const fail = message => { throw new Error(message); };
const resolveFile = (value, label, executable = false) => {
  const absolute = path.resolve(value || '');
  if (!value || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) fail(`${label} file does not exist.`);
  if (executable && path.extname(absolute).toLowerCase() !== '.cjs'
    && process.platform !== 'win32' && (fs.statSync(absolute).mode & 0o111) === 0) {
    fail(`${label} is not executable.`);
  }
  return absolute;
};

const privateCredentialFile = file => {
  if (process.platform === 'win32') return true;
  const stat = fs.statSync(file);
  if ((stat.mode & 0o007) !== 0 || (stat.mode & 0o022) !== 0) return false;
  return (stat.mode & 0o040) === 0
    || (typeof process.getegid === 'function' && stat.gid === process.getegid());
};

const evidencePath = resolveFile(valueFor('--evidence'), 'Enterprise evidence');
const providerProfilePath = resolveFile(valueFor('--provider-profile'), 'Provider profile');
const reportValue = valueFor('--report');
if (!reportValue) fail('Missing --report.');
const reportPath = path.resolve(reportValue);
const adapters = {
  postgres: resolveFile(valueFor('--postgres-adapter'), 'PostgreSQL adapter', true),
  redis: resolveFile(valueFor('--redis-adapter'), 'Redis adapter', true),
  objectStorage: resolveFile(valueFor('--object-adapter'), 'Object storage adapter', true),
  search: resolveFile(valueFor('--search-adapter'), 'Search adapter', true),
  backup: resolveFile(valueFor('--backup-adapter'), 'Backup adapter', true),
  observability: resolveFile(valueFor('--observability-adapter'), 'Observability adapter', true),
};
const backupReceiptService = resolveFile(
  valueFor('--backup-receipt-service'),
  'Backup receipt service',
);

const environment = String(process.env.FORMAL_PILOT_PREFLIGHT_ENVIRONMENT || '').trim();
const evidenceId = String(process.env.FORMAL_PILOT_PREFLIGHT_EVIDENCE_ID || '').trim();
const commitSha = String(process.env.FORMAL_PILOT_PREFLIGHT_COMMIT_SHA || process.env.GITHUB_SHA || '').trim();
const imageDigest = String(process.env.FORMAL_PILOT_PREFLIGHT_IMAGE_DIGEST || '').trim();
const appUrls = String(process.env.FORMAL_PILOT_PREFLIGHT_APP_URLS || '').split(',')
  .map(value => value.trim().replace(/\/$/, '')).filter(Boolean);
const username = String(process.env.FORMAL_PILOT_PREFLIGHT_USERNAME || '').trim();
const passwordFile = resolveFile(String(process.env.FORMAL_PILOT_PREFLIGHT_PASSWORD_FILE || '').trim(), 'Preflight password');
const password = fs.readFileSync(passwordFile, 'utf8').trim();
const backupReceiptUrl = String(process.env.FORMAL_PILOT_PREFLIGHT_BACKUP_RECEIPT_URL || '')
  .trim().replace(/\/$/, '');
const backupReceiptPublicKeyFile = resolveFile(
  String(process.env.FORMAL_PILOT_PREFLIGHT_BACKUP_RECEIPT_PUBLIC_KEY_FILE || '').trim(),
  'Backup receipt public key',
);
const timeoutMs = Math.max(5_000, Number(process.env.FORMAL_PILOT_PREFLIGHT_TIMEOUT_MS || 30_000));

if (!environment || /prod/i.test(environment)) fail('Preflight requires non-production staging or formal pilot.');
if (evidenceId.length < 5) fail('Formal pilot evidence ID is required.');
if (!/^[0-9a-f]{40}$/.test(commitSha)) fail('Formal pilot commit SHA is invalid.');
if (!/^sha256:[0-9a-f]{64}$/.test(imageDigest)) fail('Formal pilot image digest is invalid.');
if (appUrls.length < 2 || new Set(appUrls).size < 2) fail('Two distinct application URLs are required.');
if (appUrls.some(value => !/^https:\/\//i.test(value) && !/^http:\/\/127\.0\.0\.1(?::\d+)?$/i.test(value))) {
  fail('Application URLs must use HTTPS; loopback HTTP is allowed only for contract tests.');
}
if (!username || !password) fail('Preflight username and password file are required.');
if (!/^https:\/\//i.test(backupReceiptUrl)
  && !/^http:\/\/127\.0\.0\.1(?::\d+)?$/i.test(backupReceiptUrl)) {
  fail('Backup receipt preflight URL must use HTTPS; loopback HTTP is contract-only.');
}
if (!privateCredentialFile(passwordFile)) {
  fail('Preflight password file must be owner-only or current-group read-only.');
}

const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8').replace(/^\uFEFF/, ''));
if (evidence.environment !== environment || evidence.evidenceId !== evidenceId
  || evidence.commitSha !== commitSha || evidence.imageDigest !== imageDigest) {
  fail('Preflight identity does not match enterprise evidence.');
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
if (providerSummary.status !== 'passed' || providerSummary.environment !== environment
  || !/^[0-9a-f]{64}$/.test(String(providerSummary.providerProfileSha256 || ''))) {
  fail('Bound provider profile did not pass preflight verification.');
}
const receiptServiceSha256 = crypto.createHash('sha256').update(fs.readFileSync(backupReceiptService)).digest('hex');
const receiptPublicKeySha256 = crypto.createHash('sha256').update(fs.readFileSync(backupReceiptPublicKeyFile)).digest('hex');
let receiptPublicKey;
try { receiptPublicKey = crypto.createPublicKey(fs.readFileSync(backupReceiptPublicKeyFile)); }
catch { fail('Backup receipt public key is invalid.'); }
if (receiptPublicKey.asymmetricKeyType !== 'ed25519') fail('Backup receipt public key must be Ed25519.');
const expectedReceipt = providerSummary.backupReceiptVerifier;
if (!expectedReceipt
  || expectedReceipt.serviceFileName !== path.basename(backupReceiptService)
  || expectedReceipt.serviceSha256 !== receiptServiceSha256
  || expectedReceipt.publicKeySha256 !== receiptPublicKeySha256) {
  fail('Backup receipt service or public key does not match the bound provider profile.');
}
const adapterSha256 = {};
for (const [name, adapterPath] of Object.entries(adapters)) {
  const expected = providerSummary.adapters?.[name];
  const actualFileName = path.basename(adapterPath);
  const actualSha256 = crypto.createHash('sha256').update(fs.readFileSync(adapterPath)).digest('hex');
  if (!expected || expected.fileName !== actualFileName || expected.sha256 !== actualSha256) {
    fail(`Adapter ${name} does not match the bound provider profile.`);
  }
  adapterSha256[name] = actualSha256;
}

const report = {
  name: 'Formal Pilot Read-Only Environment Preflight',
  version: '1.0',
  status: 'failed',
  mode: 'read-only',
  environment,
  evidenceId,
  commitSha,
  imageDigest,
  providerProfileSha256: providerSummary.providerProfileSha256,
  adapterSha256,
  backupReceiptVerifier: {
    mode: expectedReceipt.mode,
    issuer: expectedReceipt.issuer,
    serviceFileName: expectedReceipt.serviceFileName,
    serviceSha256: receiptServiceSha256,
    publicKeySha256: receiptPublicKeySha256,
  },
  startedAt: new Date().toISOString(),
  checks: [],
};
const check = (name, passed, details = {}) => {
  report.checks.push({ name, status: passed ? 'passed' : 'failed', ...details });
  if (!passed) fail(`Check failed: ${name}`);
};
const hashId = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const adapterInvocation = (adapter, operation, operationArgs) => path.extname(adapter).toLowerCase() === '.cjs'
  ? { command: process.execPath, args: [adapter, operation, ...operationArgs.map(String)] }
  : { command: adapter, args: [operation, ...operationArgs.map(String)] };
const adapterJson = (adapter, operation, ...operationArgs) => {
  const invocation = adapterInvocation(adapter, operation, operationArgs);
  const output = execFileSync(invocation.command, invocation.args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
  try { return JSON.parse(output); } catch { fail(`Adapter returned invalid JSON for ${operation}.`); }
};
const topology = (name, minimum, sentinelMinimum = 0) => {
  const value = adapterJson(adapters[name], 'topology');
  const domains = [...new Set((value?.failureDomains || []).map(String).filter(Boolean))];
  check(`${name}-provider-topology`, domains.length >= minimum
    && Number.isFinite(Date.parse(String(value?.observedAt || '')))
    && (!sentinelMinimum || Number(value?.sentinelCount) >= sentinelMinimum), {
    failureDomainCount: domains.length,
    sentinelCount: sentinelMinimum ? Number(value?.sentinelCount || 0) : undefined,
    observedAt: value?.observedAt,
  });
  const endpoint = adapterJson(adapters[name], 'discover');
  check(`${name}-preferred-endpoint`, Boolean(String(endpoint?.id || '').trim())
    && domains.includes(String(endpoint?.failureDomain || '')), {
    endpointIdSha256: hashId(endpoint?.id),
    failureDomain: endpoint?.failureDomain,
  });
  return { domains, endpoint };
};
const request = async (baseUrl, pathname, options = {}, token = '') => fetch(`${baseUrl}${pathname}`, {
  ...options,
  headers: { ...(options.headers || {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
  signal: AbortSignal.timeout(timeoutMs),
});
const requestJson = async (baseUrl, pathname, options = {}, token = '') => {
  const response = await request(baseUrl, pathname, options, token);
  const body = await response.json().catch(() => null);
  return { response, body };
};
const writeReport = () => {
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const temporary = `${reportPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, reportPath);
};

(async () => {
  check('provider-profile-bound', providerSummary.evidenceBound === true, {
    providerProfileSha256: providerSummary.providerProfileSha256,
  });
  check('all-adapters-profile-bound', Object.keys(adapterSha256).length === 6, {
    adapterSha256,
  });
  const receiptHealth = await requestJson(backupReceiptUrl, '/health');
  check('backup-receipt-verifier-bound-and-healthy', receiptHealth.response.status === 200
    && receiptHealth.body?.status === 'available'
    && receiptHealth.body?.verifier === 'ed25519'
    && receiptHealth.body?.issuer === expectedReceipt.issuer
    && receiptHealth.body?.publicKeySha256 === receiptPublicKeySha256, {
    issuer: expectedReceipt.issuer,
    serviceSha256: receiptServiceSha256,
    publicKeySha256: receiptPublicKeySha256,
  });
  check('all-adapters-executable', Object.keys(adapters).length === 6, { adapterCount: 6 });
  const postgres = topology('postgres', 2);
  const redis = topology('redis', 3, 3);
  const objectStorage = topology('objectStorage', 2);
  const search = topology('search', 2);
  report.topology = {
    postgresFailureDomains: postgres.domains.length,
    redisFailureDomains: redis.domains.length,
    redisSentinelCount: Number(adapterJson(adapters.redis, 'topology').sentinelCount),
    objectStorageFailureDomains: objectStorage.domains.length,
    searchFailureDomains: search.domains.length,
  };

  const health = [];
  for (const baseUrl of appUrls) {
    const status = await requestJson(baseUrl, '/health');
    const ready = await requestJson(baseUrl, '/api/v1/ready');
    const instanceId = String(status.body?.telemetry?.serviceInstanceId || '');
    check('application-health-and-readiness', status.response.status === 200
      && ready.response.status === 200 && status.body?.database === 'ok'
      && ready.body?.database === 'ok' && Boolean(instanceId), {
      baseUrl, instanceIdSha256: hashId(instanceId),
    });
    health.push(instanceId);
  }
  check('two-distinct-application-instances', new Set(health).size >= 2, { instanceCount: new Set(health).size });

  const login = await requestJson(appUrls[0], '/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const token = login.body?.data?.token;
  check('least-privilege-audit-login', login.response.status === 200 && Boolean(token));
  const shared = await requestJson(appUrls[1], '/api/v1/auth/me', {}, token);
  check('cross-instance-session-readback', shared.response.status === 200 && Boolean(shared.body?.data?.id));

  const orderResult = await requestJson(appUrls[0], '/api/v1/orders?page=1&pageSize=25&search=SO', {}, token);
  const rows = Array.isArray(orderResult.body?.data)
    ? orderResult.body.data : orderResult.body?.data?.items || [];
  const markerId = String(rows[0]?.id || '');
  check('application-search-marker', orderResult.response.status === 200 && Boolean(markerId));
  const providerQuery = adapterJson(adapters.search, 'verify-live-query', markerId);
  check('provider-search-marker-readback', providerQuery?.found === true
    && String(providerQuery?.endpointId || '') === String(search.endpoint.id)
    && String(providerQuery?.failureDomain || '') === String(search.endpoint.failureDomain), {
    endpointIdSha256: hashId(providerQuery?.endpointId),
    failureDomain: providerQuery?.failureDomain,
  });

  report.status = 'passed';
})().catch(error => {
  report.error = String(error?.message || error);
  process.exitCode = 1;
}).finally(() => {
  writeReport();
  console.log(`Formal pilot preflight: ${report.status.toUpperCase()}`);
  console.log(`Report: ${reportPath}`);
});
