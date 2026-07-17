const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const valueFor = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
};
const has = name => args.includes(name);
const fail = message => {
  throw new Error(message);
};

const evidenceArgument = valueFor('--evidence');
const providerProfileArgument = valueFor('--provider-profile');
const postgresAdapterArgument = valueFor('--postgres-adapter');
const redisAdapterArgument = valueFor('--redis-adapter');
const evidencePath = evidenceArgument ? path.resolve(evidenceArgument) : '';
const providerProfilePath = providerProfileArgument ? path.resolve(providerProfileArgument) : '';
const postgresAdapter = postgresAdapterArgument ? path.resolve(postgresAdapterArgument) : '';
const redisAdapter = redisAdapterArgument ? path.resolve(redisAdapterArgument) : '';
const environment = String(process.env.HA_DRILL_ENVIRONMENT || '').trim();
const changeTicket = String(process.env.HA_DRILL_CHANGE_TICKET || '').trim();
const appUrls = String(process.env.HA_DRILL_APP_URLS || '')
  .split(',')
  .map(value => value.trim().replace(/\/$/, ''))
  .filter(Boolean);
const username = String(process.env.HA_DRILL_USERNAME || '').trim();
const passwordFile = String(process.env.HA_DRILL_PASSWORD_FILE || '').trim();
const timeoutMs = Math.max(30_000, Number(process.env.HA_DRILL_TIMEOUT_MS || 180_000));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

if (!has('--confirm-disruptive')) fail('Missing --confirm-disruptive.');
if (!environment || /prod/i.test(environment)) fail('HA drill environment must be a non-production staging or pilot environment.');
if (changeTicket.length < 5) fail('HA_DRILL_CHANGE_TICKET is required.');
if (appUrls.length < 2) fail('HA_DRILL_APP_URLS must contain at least two application instances.');
if (!username || !passwordFile) fail('HA_DRILL_USERNAME and HA_DRILL_PASSWORD_FILE are required.');
if (!fs.existsSync(passwordFile)) fail('HA audit password file does not exist.');
if (!evidenceArgument || !evidencePath || !fs.existsSync(evidencePath) || !fs.statSync(evidencePath).isFile()) {
  fail('Existing evidence JSON file is required.');
}
if (!providerProfilePath || !fs.existsSync(providerProfilePath) || !fs.statSync(providerProfilePath).isFile()) {
  fail('Existing --provider-profile file is required.');
}
for (const adapter of [postgresAdapter, redisAdapter]) {
  if (!adapter || !fs.existsSync(adapter) || !fs.statSync(adapter).isFile()) fail(`Adapter file does not exist: ${adapter}`);
}

const password = fs.readFileSync(passwordFile, 'utf8').trim();
if (!password) fail('HA audit password file is empty.');

const adapterJson = (adapter, operation) => {
  const output = execFileSync(adapter, [operation], {
    encoding: 'utf8',
    timeout: timeoutMs,
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
  try {
    return JSON.parse(output);
  } catch {
    fail(`Adapter ${path.basename(adapter)} returned invalid JSON for ${operation}.`);
  }
};
const adapterRun = (adapter, operation) => {
  execFileSync(adapter, [operation], {
    encoding: 'utf8',
    timeout: timeoutMs,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
};

const requestJson = async (url, init = {}) => {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(Math.min(10_000, timeoutMs)),
  });
  const body = await response.json().catch(() => null);
  return { response, body };
};
const traceIdFor = response => {
  const traceparent = String(response?.headers?.get('traceparent') || '').trim();
  const requestId = String(response?.headers?.get('x-request-id') || '').trim();
  const match = traceparent.match(/^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/);
  return match && requestId === match[1] ? match[1] : '';
};

const login = async () => {
  const { response, body } = await requestJson(`${appUrls[0]}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const token = body?.data?.token;
  if (!response.ok || !token) fail(`HA audit login failed: ${response.status}`);
  return token;
};

const appsReady = async () => {
  const results = await Promise.all(appUrls.map(async baseUrl => {
    try {
      const { response, body } = await requestJson(`${baseUrl}/api/v1/ready`);
      return response.ok && body?.status === 'ready' && body?.database === 'ok' && body?.redis?.ready === true;
    } catch {
      return false;
    }
  }));
  return results.every(Boolean);
};

const tokenAccepted = async token => {
  const results = await Promise.all(appUrls.map(async baseUrl => {
    try {
      const { response } = await requestJson(`${baseUrl}/api/v1/auth/me`, {
        headers: { authorization: `Bearer ${token}` },
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }));
  return results.every(Boolean);
};

const waitFor = async probe => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch {}
    await sleep(1000);
  }
  return null;
};

const createAndReadSyntheticCustomer = async (token, phase) => {
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const marker = `HA-AUDIT-${phase}-${runId}`;
  const { response: createResponse, body: createBody } = await requestJson(`${appUrls[0]}/api/v1/customers`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      nameZh: marker,
      nameEn: marker,
      nameVi: marker,
      licenseNumber: `HA-${runId}`,
      creditLimit: 1,
      riskLevel: 'low',
      segment: 'direct',
      contactName: 'HA audit',
      contactPhone: '0000000000',
      contactEmail: `${runId}@example.invalid`,
      address: 'Synthetic HA audit record',
      status: 'active',
    }),
  });
  const customerId = createBody?.data?.id;
  if (createResponse.status !== 201 || !customerId) fail(`Synthetic write failed during ${phase}: ${createResponse.status}`);

  const { response: readResponse, body: readBody } = await requestJson(
    `${appUrls[1]}/api/v1/customers/${encodeURIComponent(customerId)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!readResponse.ok || String(readBody?.data?.id) !== String(customerId)) {
    fail(`Cross-instance readback failed during ${phase}: ${readResponse.status}`);
  }
  const traceIds = [traceIdFor(createResponse), traceIdFor(readResponse)];
  if (traceIds.some(traceId => !traceId)) fail(`Trace propagation failed during ${phase}.`);
  return traceIds;
};

const collectSessionTraceIds = async token => {
  const traces = await Promise.all(appUrls.map(async baseUrl => {
    const { response } = await requestJson(`${baseUrl}/api/v1/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const traceId = traceIdFor(response);
    if (response.status !== 200 || !traceId) fail(`Shared-session trace probe failed for ${baseUrl}.`);
    return traceId;
  }));
  return traces;
};

const validateTopology = (kind, topology, minimumDomains) => {
  const domains = Array.from(new Set(Array.isArray(topology?.failureDomains) ? topology.failureDomains.filter(Boolean) : []));
  if (domains.length < minimumDomains) fail(`${kind} topology has fewer than ${minimumDomains} failure domains.`);
  return domains;
};

const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
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
const adapterSha256 = {};
for (const [name, adapter] of Object.entries({ postgres: postgresAdapter, redis: redisAdapter })) {
  const expected = providerSummary.adapters?.[name];
  const actualSha256 = crypto.createHash('sha256').update(fs.readFileSync(adapter)).digest('hex');
  if (!expected || expected.fileName !== path.basename(adapter) || expected.sha256 !== actualSha256) {
    fail(`HA adapter ${name} does not match the bound provider profile.`);
  }
  adapterSha256[name] = actualSha256;
}
const drill = {
  status: 'failed',
  environment,
  changeTicket,
  providerProfileSha256: providerSummary.providerProfileSha256,
  adapterSha256,
  startedAt: new Date().toISOString(),
  postgres: {},
  redis: {},
};
let postgresDisrupted = false;
let redisDisrupted = false;

const persist = () => {
  evidence.evidenceId = changeTicket;
  evidence.environment = environment;
  evidence.observedAt = new Date().toISOString();
  evidence.postgres = { ...evidence.postgres, ...drill.postgres };
  evidence.redis = { ...evidence.redis, ...drill.redis };
  evidence.haDrill = drill;
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
};

(async () => {
  const token = await login();
  if (!await appsReady()) fail('Baseline application readiness failed.');
  if (!await tokenAccepted(token)) fail('Baseline shared session failed.');
  drill.baselineTraceIds = await createAndReadSyntheticCustomer(token, 'baseline');

  const pgTopology = adapterJson(postgresAdapter, 'topology');
  const pgDomains = validateTopology('PostgreSQL', pgTopology, 2);
  const pgBefore = adapterJson(postgresAdapter, 'discover');
  if (!pgBefore?.id || !pgBefore?.failureDomain || !pgDomains.includes(pgBefore.failureDomain)) {
    fail('PostgreSQL discover output is incomplete or outside the declared topology.');
  }
  const pgStarted = Date.now();
  adapterRun(postgresAdapter, 'fail-primary');
  postgresDisrupted = true;
  const pgAfter = await waitFor(async () => {
    const current = adapterJson(postgresAdapter, 'discover');
    return current?.id && current.id !== pgBefore.id && await appsReady() ? current : null;
  });
  if (!pgAfter) fail('PostgreSQL automatic election did not recover applications before timeout.');
  if (!pgAfter.failureDomain || !pgDomains.includes(pgAfter.failureDomain) || pgAfter.failureDomain === pgBefore.failureDomain) {
    fail('PostgreSQL writer did not move to a different declared failure domain.');
  }
  const pgRtoSeconds = Math.max(0.001, (Date.now() - pgStarted) / 1000);
  const pgTraceIds = await createAndReadSyntheticCustomer(token, 'postgres-failover');
  adapterRun(postgresAdapter, 'recover');
  postgresDisrupted = false;
  const pgRejoin = await waitFor(() => adapterJson(postgresAdapter, 'old-primary-status')?.rejoinedAsReplica === true);
  if (!pgRejoin) fail('PostgreSQL old primary did not rejoin as replica.');
  drill.postgres = {
    automaticElection: true,
    failureDomains: pgDomains,
    writerBefore: pgBefore.id,
    writerAfter: pgAfter.id,
    rtoSeconds: pgRtoSeconds,
    postFailoverWriteReadback: true,
    oldPrimaryRejoinedAsReplica: true,
    traceIds: pgTraceIds,
  };

  const redisTopology = adapterJson(redisAdapter, 'topology');
  const redisDomains = validateTopology('Redis', redisTopology, 3);
  if (Number(redisTopology.sentinelCount) < 3) fail('Redis topology has fewer than three Sentinels.');
  const redisBefore = adapterJson(redisAdapter, 'discover');
  if (!redisBefore?.id || !redisBefore?.failureDomain || !redisDomains.includes(redisBefore.failureDomain)) {
    fail('Redis discover output is incomplete or outside the declared topology.');
  }
  const redisStarted = Date.now();
  adapterRun(redisAdapter, 'fail-primary');
  redisDisrupted = true;
  const redisAfter = await waitFor(async () => {
    const current = adapterJson(redisAdapter, 'discover');
    return current?.id && current.id !== redisBefore.id && await appsReady() && await tokenAccepted(token) ? current : null;
  });
  if (!redisAfter) fail('Redis automatic election did not recover shared sessions before timeout.');
  if (!redisAfter.failureDomain || !redisDomains.includes(redisAfter.failureDomain) || redisAfter.failureDomain === redisBefore.failureDomain) {
    fail('Redis master did not move to a different declared failure domain.');
  }
  const redisRtoSeconds = Math.max(0.001, (Date.now() - redisStarted) / 1000);
  const postFailoverToken = await login();
  if (!await tokenAccepted(postFailoverToken)) fail('Redis post-failover session write/readback failed.');
  const redisTraceIds = await collectSessionTraceIds(postFailoverToken);
  adapterRun(redisAdapter, 'recover');
  redisDisrupted = false;
  const redisRejoin = await waitFor(() => adapterJson(redisAdapter, 'old-primary-status')?.rejoinedAsReplica === true);
  if (!redisRejoin) fail('Redis old primary did not rejoin as replica.');
  drill.redis = {
    automaticElection: true,
    sentinelCount: Number(redisTopology.sentinelCount),
    failureDomains: redisDomains,
    masterBefore: redisBefore.id,
    masterAfter: redisAfter.id,
    rtoSeconds: redisRtoSeconds,
    applicationWriteReadback: true,
    oldMasterRejoinedAsReplica: true,
    traceIds: redisTraceIds,
  };

  drill.status = 'passed';
})().catch(error => {
  drill.error = String(error?.message || error);
  process.exitCode = 1;
}).finally(() => {
  if (redisDisrupted) {
    try { adapterRun(redisAdapter, 'recover'); } catch (error) { drill.redisRecoveryError = String(error?.message || error); }
  }
  if (postgresDisrupted) {
    try { adapterRun(postgresAdapter, 'recover'); } catch (error) { drill.postgresRecoveryError = String(error?.message || error); }
  }
  drill.finishedAt = new Date().toISOString();
  persist();
  console.log(`Automatic HA drill: ${drill.status.toUpperCase()}`);
  console.log(`Evidence: ${evidencePath}`);
});
