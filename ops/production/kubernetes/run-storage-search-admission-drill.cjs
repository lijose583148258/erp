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
const resolveFile = (value, label) => {
  const absolute = path.resolve(value || '');
  if (!value || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) fail(`${label} file does not exist.`);
  return absolute;
};
const objectAdapter = resolveFile(valueFor('--object-adapter'), 'Object storage adapter');
const searchAdapter = resolveFile(valueFor('--search-adapter'), 'Search adapter');
const evidencePath = resolveFile(valueFor('--evidence'), 'Enterprise evidence');
const providerProfilePath = resolveFile(valueFor('--provider-profile'), 'Provider profile');
const reportsValue = valueFor('--reports-dir');
if (!reportsValue) fail('Missing --reports-dir.');
const reportsDir = path.resolve(reportsValue);
if (!args.includes('--confirm-disruptive')) fail('Missing --confirm-disruptive.');

const environment = String(process.env.STORAGE_SEARCH_DRILL_ENVIRONMENT || '').trim();
const evidenceId = String(process.env.STORAGE_SEARCH_DRILL_EVIDENCE_ID || '').trim();
const commitSha = String(process.env.STORAGE_SEARCH_DRILL_COMMIT_SHA || process.env.GITHUB_SHA || '').trim();
const imageDigest = String(process.env.STORAGE_SEARCH_DRILL_IMAGE_DIGEST || '').trim();
const appUrls = String(process.env.STORAGE_SEARCH_DRILL_APP_URLS || '').split(',')
  .map(value => value.trim().replace(/\/$/, '')).filter(Boolean);
const username = String(process.env.STORAGE_SEARCH_DRILL_USERNAME || '').trim();
const passwordFile = resolveFile(String(process.env.STORAGE_SEARCH_DRILL_PASSWORD_FILE || '').trim(), 'Audit password');
const password = fs.readFileSync(passwordFile, 'utf8').trim();
const timeoutMs = Math.max(30_000, Number(process.env.STORAGE_SEARCH_DRILL_TIMEOUT_MS || 300_000));
const pollMs = Math.max(1_000, Math.min(15_000, Number(process.env.STORAGE_SEARCH_DRILL_POLL_MS || 3_000)));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

if (!environment || /prod/i.test(environment)) fail('Storage/search drill requires non-production staging or formal pilot.');
if (evidenceId.length < 5) fail('STORAGE_SEARCH_DRILL_EVIDENCE_ID is required.');
if (!/^[0-9a-f]{40}$/.test(commitSha)) fail('Storage/search drill commit SHA is invalid.');
if (!/^sha256:[0-9a-f]{64}$/.test(imageDigest)) fail('Storage/search drill image digest is invalid.');
if (appUrls.length < 2 || new Set(appUrls).size < 2) fail('Two distinct application URLs are required.');
if (appUrls.some(value => !/^https:\/\//i.test(value) && !/^http:\/\/127\.0\.0\.1(?::\d+)?$/i.test(value))) {
  fail('Application URLs must use HTTPS; loopback HTTP is allowed only for contract tests.');
}
if (!username || !password) fail('Audit username and password file are required.');

const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8').replace(/^\uFEFF/, ''));
if (evidence.environment !== environment || evidence.evidenceId !== evidenceId
  || evidence.commitSha !== commitSha || evidence.imageDigest !== imageDigest) {
  fail('Storage/search drill identity does not match enterprise evidence.');
}
const providerVerifier = path.join(__dirname, 'verify-formal-pilot-provider-profile.cjs');
const providerOutput = execFileSync(process.execPath, [
  providerVerifier, providerProfilePath, '--evidence', evidencePath,
], {
  encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'inherit'],
}).trim();
let providerSummary;
try { providerSummary = JSON.parse(providerOutput); } catch { fail('Provider profile verifier returned invalid JSON.'); }
const adapterSha256 = {};
for (const [name, adapter] of Object.entries({ objectStorage: objectAdapter, search: searchAdapter })) {
  const expected = providerSummary.adapters?.[name];
  const actualSha256 = crypto.createHash('sha256').update(fs.readFileSync(adapter)).digest('hex');
  if (!expected || expected.fileName !== path.basename(adapter) || expected.sha256 !== actualSha256) {
    fail(`Storage/search adapter ${name} does not match the bound provider profile.`);
  }
  adapterSha256[name] = actualSha256;
}

const identity = { environment, evidenceId, commitSha, imageDigest };
const baseReport = (name, scope, adapterName) => ({
  name, version: '1.0', status: 'failed', scope, providerAdapterVerified: true,
  ...identity,
  providerProfileSha256: providerSummary.providerProfileSha256,
  adapterSha256: { [adapterName]: adapterSha256[adapterName] },
  startedAt: new Date().toISOString(),
  checks: [],
});
const objectReport = baseReport('Formal Object Storage Cross-Domain Failover Drill', 'formal-cross-domain', 'objectStorage');
const searchFailoverReport = baseReport('Formal Search Cross-Domain Failover Drill', 'formal-cross-domain', 'search');
const searchRestoreReport = baseReport('Formal Search Isolated Provider Restore Drill', 'formal-isolated-provider-restore', 'search');
let objectInjectionId = '';
let searchInjectionId = '';
let restoreId = '';
let objectRecovered = false;
let searchRecovered = false;
let restoreCleaned = false;

const check = (report, name, passed, details = {}) => {
  report.checks.push({ name, status: passed ? 'passed' : 'failed', ...details });
  if (!passed) fail(`Check failed: ${name}`);
};
const adapterInvocation = (adapter, operation, operationArgs) => path.extname(adapter).toLowerCase() === '.cjs'
  ? { command: process.execPath, args: [adapter, operation, ...operationArgs.map(String)] }
  : { command: adapter, args: [operation, ...operationArgs.map(String)] };
const adapterJson = (adapter, operation, ...operationArgs) => {
  const invocation = adapterInvocation(adapter, operation, operationArgs);
  const output = execFileSync(invocation.command, invocation.args, {
    encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
  try { return JSON.parse(output); } catch { fail(`Adapter returned invalid JSON for ${operation}.`); }
};
const adapterRun = (adapter, operation, ...operationArgs) => {
  const invocation = adapterInvocation(adapter, operation, operationArgs);
  execFileSync(invocation.command, invocation.args, {
    encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'ignore', 'inherit'],
  });
};
const validTopology = topology => Array.isArray(topology?.failureDomains)
  && new Set(topology.failureDomains.map(String).filter(Boolean)).size >= 2
  && Number.isFinite(Date.parse(String(topology?.observedAt || '')));
const validEndpoint = endpoint => Boolean(String(endpoint?.id || '').trim())
  && Boolean(String(endpoint?.failureDomain || '').trim());
const waitJson = async (adapter, operation, id, success, failure = 'failed') => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = adapterJson(adapter, operation, id);
    if (status?.status === success || status?.[success] === true) return status;
    if (status?.status === failure) fail(`${operation} reported failure.`);
    if (status?.status && status.status !== 'pending') fail(`${operation} returned unsupported status.`);
    await sleep(pollMs);
  }
  fail(`${operation} timed out.`);
};
const waitEndpointChange = async (adapter, before) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = adapterJson(adapter, 'discover');
    if (validEndpoint(current) && current.id !== before.id && current.failureDomain !== before.failureDomain) return current;
    await sleep(pollMs);
  }
  fail('Provider endpoint did not fail over to another failure domain.');
};
const api = async (baseUrl, pathname, options = {}, token = '') => {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { ...(options.headers || {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(Math.min(timeoutMs, 15_000)),
  });
  return response;
};
const json = async response => {
  const body = await response.json().catch(() => null);
  return { response, body };
};
const writeReport = (fileName, report) => {
  fs.mkdirSync(reportsDir, { recursive: true });
  const target = path.join(reportsDir, fileName);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, target);
};
const finishReports = () => {
  const finishedAt = new Date().toISOString();
  for (const report of [objectReport, searchFailoverReport, searchRestoreReport]) report.finishedAt = finishedAt;
  writeReport('object-storage-failover-audit-v1.json', objectReport);
  writeReport('meilisearch-failover-audit-v1.json', searchFailoverReport);
  writeReport('meilisearch-dump-restore-audit-v1.json', searchRestoreReport);
};
const makeId = prefix => {
  const normalizedPrefix = String(prefix).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
  const nonce = crypto.randomBytes(6).toString('hex');
  const maximumEvidenceLength = 63 - normalizedPrefix.length - nonce.length - 2;
  if (!normalizedPrefix || maximumEvidenceLength < 1) fail('Storage/search resource ID prefix is too long.');
  const normalizedEvidence = evidenceId.toLowerCase().replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, maximumEvidenceLength).replace(/-+$/g, '');
  if (!normalizedEvidence) fail('Storage/search evidence ID cannot form a Kubernetes resource name.');
  return `${normalizedPrefix}-${normalizedEvidence}-${nonce}`;
};

(async () => {
  const login = await json(await api(appUrls[0], '/api/v1/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  }));
  const token = login.body?.data?.token;
  if (!login.response.ok || !token) fail('Audit login failed.');

  const objectTopology = adapterJson(objectAdapter, 'topology');
  check(objectReport, 'provider-topology-observed', validTopology(objectTopology));
  objectReport.failureDomains = [...new Set(objectTopology.failureDomains.map(String))];
  objectReport.topologyObservedAt = objectTopology.observedAt;
  const objectPrimary = adapterJson(objectAdapter, 'discover');
  check(objectReport, 'provider-primary-discovered', validEndpoint(objectPrimary)
    && objectReport.failureDomains.includes(String(objectPrimary.failureDomain)));

  const marker = crypto.randomBytes(128);
  const markerSha = crypto.createHash('sha256').update(marker).digest('hex');
  const runId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const customer = await json(await api(appUrls[0], '/api/v1/customers', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: `FORMAL-STORAGE-${runId}`, nameZh: `FORMAL-STORAGE-${runId}`,
      licenseNumber: `FORMAL-${runId}`, status: 'active', poolState: 'public', segment: 'direct',
    }),
  }, token));
  if (!customer.response.ok || !customer.body?.data?.id) fail('Synthetic audit customer creation failed.');
  const contract = await json(await api(appUrls[0], '/api/v1/contracts', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      customerId: customer.body.data.id, title: `Formal storage drill ${runId}`,
      totalAmount: 0, currency: 'CNY', fileUrl: `data:image/png;base64,${marker.toString('base64')}`,
    }),
  }, token));
  const fileUrl = String(contract.body?.data?.fileUrl || '');
  check(objectReport, 'dual-write-contract-created', contract.response.status === 201 && /^\/uploads\/contracts\//.test(fileUrl));
  const baselineResponse = await api(appUrls[0], fileUrl, {}, token);
  const baseline = Buffer.from(await baselineResponse.arrayBuffer());
  check(objectReport, 'protected-primary-download', baselineResponse.ok && baseline.equals(marker));

  objectInjectionId = makeId('object');
  objectReport.failureInjectionId = objectInjectionId;
  adapterRun(objectAdapter, 'fail-primary', objectInjectionId);
  const objectStarted = Date.now();
  const objectSecondary = await waitEndpointChange(objectAdapter, objectPrimary);
  check(objectReport, 'primary-stopped', true, {
    isolatedEndpointId: objectPrimary.id, survivingFailureDomain: objectSecondary.failureDomain,
  });
  const failoverResponse = await api(appUrls[1], fileUrl, {}, token);
  const failoverBytes = Buffer.from(await failoverResponse.arrayBuffer());
  objectReport.failoverMs = Date.now() - objectStarted;
  objectReport.sha256 = crypto.createHash('sha256').update(failoverBytes).digest('hex');
  check(objectReport, 'protected-secondary-failover-download', failoverResponse.ok, { durationMs: objectReport.failoverMs });
  check(objectReport, 'sha256-byte-integrity', failoverBytes.equals(baseline)
    && objectReport.sha256 === markerSha, { sha256: objectReport.sha256 });
  adapterRun(objectAdapter, 'recover', objectInjectionId);
  const objectRecovery = await waitJson(objectAdapter, 'recovery-status', objectInjectionId, 'recovered');
  objectRecovered = true;
  check(objectReport, 'primary-restored', objectRecovery?.recovered === true);
  objectReport.status = 'passed';

  const searchTopology = adapterJson(searchAdapter, 'topology');
  check(searchFailoverReport, 'provider-topology-observed', validTopology(searchTopology));
  searchFailoverReport.failureDomains = [...new Set(searchTopology.failureDomains.map(String))];
  searchFailoverReport.topologyObservedAt = searchTopology.observedAt;
  const searchPrimary = adapterJson(searchAdapter, 'discover');
  check(searchFailoverReport, 'provider-primary-discovered', validEndpoint(searchPrimary)
    && searchFailoverReport.failureDomains.includes(String(searchPrimary.failureDomain)));
  const baselineSearch = await json(await api(appUrls[0], '/api/v1/orders?page=1&pageSize=25&search=SO', {}, token));
  const baselineRows = Array.isArray(baselineSearch.body?.data)
    ? baselineSearch.body.data : baselineSearch.body?.data?.items || [];
  const markerId = String(baselineRows[0]?.id || '');
  check(searchFailoverReport, 'known-order-primary-hit', baselineSearch.response.ok && Boolean(markerId));
  const providerBaseline = adapterJson(searchAdapter, 'verify-live-query', markerId);
  check(searchFailoverReport, 'primary-provider-query', providerBaseline?.found === true
    && String(providerBaseline?.endpointId || '') === String(searchPrimary.id));

  searchInjectionId = makeId('search');
  searchFailoverReport.failureInjectionId = searchInjectionId;
  adapterRun(searchAdapter, 'fail-primary', searchInjectionId);
  const searchStarted = Date.now();
  const searchSecondary = await waitEndpointChange(searchAdapter, searchPrimary);
  check(searchFailoverReport, 'primary-stopped', true, {
    isolatedEndpointId: searchPrimary.id, survivingFailureDomain: searchSecondary.failureDomain,
  });
  const failoverSearch = await json(await api(appUrls[1], '/api/v1/orders?page=1&pageSize=25&search=SO', {}, token));
  const failoverRows = Array.isArray(failoverSearch.body?.data)
    ? failoverSearch.body.data : failoverSearch.body?.data?.items || [];
  searchFailoverReport.failoverMs = Date.now() - searchStarted;
  check(searchFailoverReport, 'known-order-secondary-hit', failoverSearch.response.ok
    && String(failoverRows[0]?.id || '') === markerId, { durationMs: searchFailoverReport.failoverMs });
  const providerFailover = adapterJson(searchAdapter, 'verify-live-query', markerId);
  check(searchFailoverReport, 'surviving-provider-query', providerFailover?.found === true
    && String(providerFailover?.endpointId || '') === String(searchSecondary.id)
    && String(providerFailover?.failureDomain || '') === String(searchSecondary.failureDomain));
  adapterRun(searchAdapter, 'recover', searchInjectionId);
  const searchRecovery = await waitJson(searchAdapter, 'recovery-status', searchInjectionId, 'recovered');
  searchRecovered = true;
  check(searchFailoverReport, 'primary-restored', searchRecovery?.recovered === true);
  searchFailoverReport.status = 'passed';

  const activeMarker = adapterJson(searchAdapter, 'verify-live-query', markerId);
  check(searchRestoreReport, 'primary-index-evidence', activeMarker?.found === true);
  const backup = adapterJson(searchAdapter, 'start-backup', markerId);
  const backupId = String(backup?.backupId || '');
  check(searchRestoreReport, 'provider-backup-started', Boolean(backupId)
    && Number.isFinite(Date.parse(String(backup?.startedAt || ''))));
  const backupStatus = await waitJson(searchAdapter, 'backup-status', backupId, 'completed');
  check(searchRestoreReport, 'provider-backup-completed', backupStatus?.status === 'completed'
    && String(backupStatus?.backupId || backupId) === backupId);
  restoreId = makeId('search-restore');
  const restore = adapterJson(searchAdapter, 'restore-isolated', backupId, restoreId);
  check(searchRestoreReport, 'isolated-restore-started', String(restore?.restoreId || '') === restoreId
    && Number.isFinite(Date.parse(String(restore?.startedAt || ''))));
  const restoreStatus = await waitJson(searchAdapter, 'restore-status', restoreId, 'completed');
  check(searchRestoreReport, 'isolated-restore-ready', restoreStatus?.status === 'completed');
  const restored = adapterJson(searchAdapter, 'verify-restored-query', restoreId, markerId);
  check(searchRestoreReport, 'restored-document-counts', restored?.documentCountMatched === true);
  check(searchRestoreReport, 'restored-query-equivalence', restored?.found === true);
  adapterRun(searchAdapter, 'cleanup', restoreId);
  const cleanup = await waitJson(searchAdapter, 'cleanup-status', restoreId, 'removed');
  restoreCleaned = true;
  check(searchRestoreReport, 'isolated-restore-cleanup', cleanup?.removed === true);
  searchRestoreReport.dumpUid = backupId;
  searchRestoreReport.restoreResourceId = restoreId;
  searchRestoreReport.cleanupVerified = true;
  searchRestoreReport.status = 'passed';
})().catch(error => {
  const message = String(error?.message || error);
  for (const report of [objectReport, searchFailoverReport, searchRestoreReport]) {
    if (report.status !== 'passed' && !report.error) report.error = message;
  }
  process.exitCode = 1;
}).finally(async () => {
  if (objectInjectionId && !objectRecovered) {
    try { adapterRun(objectAdapter, 'recover', objectInjectionId); } catch (error) {
      objectReport.recoveryError = String(error?.message || error);
    }
  }
  if (searchInjectionId && !searchRecovered) {
    try { adapterRun(searchAdapter, 'recover', searchInjectionId); } catch (error) {
      searchFailoverReport.recoveryError = String(error?.message || error);
    }
  }
  if (restoreId && !restoreCleaned) {
    try { adapterRun(searchAdapter, 'cleanup', restoreId); } catch (error) {
      searchRestoreReport.cleanupError = String(error?.message || error);
    }
  }
  finishReports();
  if (!process.exitCode) {
    const verifier = path.join(__dirname, 'verify-storage-search-evidence.cjs');
    execFileSync(process.execPath, [
      verifier, '--reports-dir', reportsDir, '--evidence', evidencePath, '--bind',
    ], { stdio: 'inherit', timeout: timeoutMs });
  }
  console.log(`Formal storage/search drill: ${process.exitCode ? 'FAILED' : 'PASSED'}`);
  console.log(`Reports: ${reportsDir}`);
});
