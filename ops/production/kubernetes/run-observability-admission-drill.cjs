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
const adapter = resolveFile(valueFor('--adapter'), 'Observability adapter');
const evidencePath = resolveFile(valueFor('--evidence'), 'Enterprise evidence');
const providerProfilePath = resolveFile(valueFor('--provider-profile'), 'Provider profile');
const reportValue = valueFor('--report');
if (!reportValue) fail('Missing --report.');
const reportPath = path.resolve(reportValue);
if (!args.includes('--confirm-alert-delivery')) fail('Missing --confirm-alert-delivery.');

const environment = String(process.env.OBSERVABILITY_DRILL_ENVIRONMENT || '').trim();
const changeTicket = String(process.env.OBSERVABILITY_DRILL_CHANGE_TICKET || '').trim();
const commitSha = String(process.env.OBSERVABILITY_DRILL_COMMIT_SHA || process.env.GITHUB_SHA || '').trim();
const imageDigest = String(process.env.OBSERVABILITY_DRILL_IMAGE_DIGEST || '').trim();
const appUrls = String(process.env.OBSERVABILITY_DRILL_APP_URLS || '').split(',')
  .map(value => value.trim().replace(/\/$/, '')).filter(Boolean);
const prometheusUrl = String(process.env.OBSERVABILITY_PROMETHEUS_URL || '').trim().replace(/\/$/, '');
const collectorMetricsUrl = String(process.env.OBSERVABILITY_COLLECTOR_METRICS_URL || '').trim();
const metricsTokenFile = resolveFile(String(process.env.OBSERVABILITY_METRICS_TOKEN_FILE || '').trim(), 'Metrics token');
const serviceName = String(process.env.OBSERVABILITY_SERVICE_NAME || 'ailaoda-erp-crm').trim();
const targetPattern = new RegExp(String(process.env.OBSERVABILITY_TARGET_PATTERN || 'ailaoda'), 'i');
const timeoutMs = Math.max(30_000, Number(process.env.OBSERVABILITY_DRILL_TIMEOUT_MS || 180_000));
const pollMs = Math.max(1_000, Math.min(15_000, Number(process.env.OBSERVABILITY_DRILL_POLL_MS || 3_000)));
const requiredRules = String(process.env.OBSERVABILITY_REQUIRED_ALERTS || [
  'AilaoDaApplicationReplicaUnavailable',
  'AilaoDaHighServerErrorRate',
  'AilaoDaTelemetryDroppingSpans',
  'AilaoDaCacheErrors',
  'AilaoDaObjectStorageWriteFailure',
  'AilaoDaSearchIndexErrors',
  'AilaoDaAIGatewayFailures',
].join(',')).split(',').map(value => value.trim()).filter(Boolean);
const metricsToken = fs.readFileSync(metricsTokenFile, 'utf8').trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

if (!environment || /prod/i.test(environment)) fail('Observability drill requires non-production staging or formal pilot.');
if (changeTicket.length < 5) fail('OBSERVABILITY_DRILL_CHANGE_TICKET is required.');
if (!/^[0-9a-f]{40}$/.test(commitSha)) fail('Observability drill commit SHA is invalid.');
if (!/^sha256:[0-9a-f]{64}$/.test(imageDigest)) fail('Observability drill image digest is invalid.');
if (appUrls.length < 2) fail('At least two application URLs are required.');
if (!prometheusUrl || !collectorMetricsUrl || !metricsToken) fail('Prometheus, collector metrics, and metrics token are required.');

const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8').replace(/^\uFEFF/, ''));
if (evidence.environment !== environment || evidence.evidenceId !== changeTicket
  || evidence.commitSha !== commitSha || evidence.imageDigest !== imageDigest) {
  fail('Observability drill identity does not match enterprise evidence.');
}
const providerVerifier = path.join(__dirname, 'verify-formal-pilot-provider-profile.cjs');
const providerOutput = execFileSync(process.execPath, [
  providerVerifier, providerProfilePath, '--evidence', evidencePath,
], {
  encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'inherit'],
}).trim();
let providerSummary;
try { providerSummary = JSON.parse(providerOutput); } catch { fail('Provider profile verifier returned invalid JSON.'); }
const adapterSha256 = crypto.createHash('sha256').update(fs.readFileSync(adapter)).digest('hex');
if (providerSummary.adapters?.observability?.fileName !== path.basename(adapter)
  || providerSummary.adapters?.observability?.sha256 !== adapterSha256) {
  fail('Observability adapter does not match the bound provider profile.');
}
if (evidence.haDrill?.providerProfileSha256 !== providerSummary.providerProfileSha256) {
  fail('HA trace evidence was produced under a different provider profile.');
}
const haTraceIds = [
  ...(evidence.haDrill?.postgres?.traceIds || []),
  ...(evidence.haDrill?.redis?.traceIds || []),
];
if (evidence.haDrill?.status !== 'passed' || haTraceIds.length < 4
  || haTraceIds.some(value => !/^[0-9a-f]{32}$/.test(String(value)))) {
  fail('Passed trace-linked HA evidence is required before observability admission.');
}

const report = {
  name: 'Enterprise Observability Admission Drill',
  version: '1.0',
  status: 'failed',
  environment,
  changeTicket,
  commitSha,
  imageDigest,
  providerProfileSha256: providerSummary.providerProfileSha256,
  adapterSha256: { observability: adapterSha256 },
  startedAt: new Date().toISOString(),
  checks: [],
};
let alertSent = false;
let alertResolved = false;
const check = (name, passed, details = {}) => {
  report.checks.push({ name, status: passed ? 'passed' : 'failed', ...details });
  if (!passed) fail(`Check failed: ${name}`);
};
const adapterJson = (operation, ...operationArgs) => {
  const output = execFileSync(adapter, [operation, ...operationArgs.map(String)], {
    encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
  try { return JSON.parse(output); } catch { fail(`Observability adapter returned invalid JSON for ${operation}.`); }
};
const adapterRun = (operation, ...operationArgs) => {
  execFileSync(adapter, [operation, ...operationArgs.map(String)], {
    encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'ignore', 'inherit'],
  });
};
const waitReceipt = async (operation, id) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const receipt = adapterJson(operation, id);
    if (receipt?.status === 'delivered') return receipt;
    if (receipt?.status === 'failed') fail(`${operation} reported failure.`);
    if (receipt?.status !== 'pending') fail(`${operation} returned unsupported status.`);
    await sleep(pollMs);
  }
  fail(`${operation} timed out.`);
};
const request = async (url, init = {}) => fetch(url, {
  ...init,
  signal: AbortSignal.timeout(Math.min(10_000, timeoutMs)),
});
const requestJson = async url => {
  const response = await request(url);
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.status !== 'success') fail(`Observability API failed: ${url}`);
  return body;
};
const metricSum = (text, name) => text.split(/\r?\n/)
  .filter(line => line.startsWith(name) && !line.startsWith('#'))
  .reduce((sum, line) => sum + Number(line.trim().split(/\s+/).at(-1) || 0), 0);
const readAppMetrics = async baseUrl => {
  const response = await request(`${baseUrl}/metrics`, {
    headers: { authorization: `Bearer ${metricsToken}` },
  });
  if (!response.ok) fail(`Metrics endpoint failed for ${baseUrl}.`);
  const text = await response.text();
  return {
    configured: metricSum(text, 'ailaoda_telemetry_configured'),
    dropped: metricSum(text, 'ailaoda_telemetry_spans_dropped_total'),
    queue: metricSum(text, 'ailaoda_telemetry_queue_size'),
  };
};
const readCollectorAccepted = async () => {
  const response = await request(collectorMetricsUrl);
  if (!response.ok) fail('Collector metrics endpoint failed.');
  return metricSum(await response.text(), 'otelcol_receiver_accepted_spans');
};
const traceIdFor = response => {
  const match = String(response.headers.get('traceparent') || '')
    .match(/^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/);
  return match && response.headers.get('x-request-id') === match[1] ? match[1] : '';
};
const writeAndBind = () => {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  const reportSha256 = crypto.createHash('sha256').update(fs.readFileSync(reportPath)).digest('hex');
  evidence.observability = {
    ...evidence.observability,
    bothApplicationTargetsUp: report.status === 'passed',
    alertsDelivered: report.alertDelivered === true,
    failoverTracesPresent: report.failoverTracesPresent === true,
    droppedSpanRegression: report.noDroppedSpanRegression === true ? false : true,
    serviceMonitorTargets: report.serviceMonitorTargets || 0,
    alertRulesLoaded: report.alertRulesLoaded === true,
    alertDeliveryDrill: report.alertDelivered === true && report.alertResolved === true,
    reportSha256,
    providerProfileSha256: report.providerProfileSha256,
    adapterSha256: report.adapterSha256,
  };
  evidence.observabilityDrill = {
    status: report.status,
    environment,
    changeTicket,
    commitSha,
    imageDigest,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    traceCount: report.traceCount || 0,
    receiptId: report.receiptId || null,
    reportSha256,
    providerProfileSha256: report.providerProfileSha256,
    adapterSha256: report.adapterSha256,
  };
  const temporary = `${evidencePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, evidencePath);
};

(async () => {
  const targets = await requestJson(`${prometheusUrl}/api/v1/targets`);
  const healthyTargets = (targets.data?.activeTargets || []).filter(target => {
    const identity = [target.labels?.service, target.labels?.job, target.scrapeUrl].filter(Boolean).join(' ');
    return target.health === 'up' && targetPattern.test(identity);
  });
  const targetIds = new Set(healthyTargets.map(target => target.scrapeUrl || target.discoveredLabels?.__address__).filter(Boolean));
  report.serviceMonitorTargets = targetIds.size;
  check('two-prometheus-application-targets', targetIds.size >= 2, { targets: targetIds.size });

  const rules = await requestJson(`${prometheusUrl}/api/v1/rules`);
  const ruleNames = new Set((rules.data?.groups || []).flatMap(group => (group.rules || []).map(rule => rule.name)));
  const missingRules = requiredRules.filter(name => !ruleNames.has(name));
  report.alertRulesLoaded = missingRules.length === 0;
  check('required-alert-rules-loaded', report.alertRulesLoaded, { required: requiredRules.length, missing: missingRules });

  const beforeMetrics = await Promise.all(appUrls.map(readAppMetrics));
  const collectorBefore = await readCollectorAccepted();
  const probeTraceIds = [];
  for (const baseUrl of appUrls) {
    const response = await request(`${baseUrl}/health`);
    const traceId = traceIdFor(response);
    check('application-trace-probe', response.status === 200 && Boolean(traceId), { baseUrl });
    probeTraceIds.push(traceId);
  }
  await sleep(1_000);
  const afterMetrics = await Promise.all(appUrls.map(readAppMetrics));
  const collectorAfter = await readCollectorAccepted();
  report.noDroppedSpanRegression = afterMetrics.every((item, index) => item.dropped === beforeMetrics[index].dropped);
  check('telemetry-export-envelope', beforeMetrics.every(item => item.configured >= 1)
    && afterMetrics.every(item => item.queue < 5_000)
    && report.noDroppedSpanRegression
    && collectorAfter > collectorBefore, {
    collectorDelta: collectorAfter - collectorBefore,
    maxQueue: Math.max(...afterMetrics.map(item => item.queue)),
  });

  for (const traceId of haTraceIds) {
    const trace = adapterJson('trace', traceId);
    check('ha-trace-backend-readback', trace?.found === true && trace?.service === serviceName
      && Number(trace?.spanCount) > 0 && Number.isFinite(Date.parse(String(trace?.observedAt || ''))), { traceId });
  }
  report.traceCount = haTraceIds.length;
  report.failoverTracesPresent = true;

  const drillId = `${changeTicket.replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 48)}-${crypto.randomBytes(6).toString('hex')}`;
  report.drillId = drillId;
  const sent = adapterJson('send-alert', drillId);
  alertSent = true;
  check('synthetic-alert-submitted', Number.isFinite(Date.parse(String(sent?.sentAt || ''))));
  const receipt = await waitReceipt('alert-receipt', drillId);
  check('alert-delivery-receipt', Boolean(receipt?.receiptId) && Boolean(receipt?.receiver)
    && Number.isFinite(Date.parse(String(receipt?.deliveredAt || ''))));
  report.alertDelivered = true;
  report.receiptId = String(receipt.receiptId);

  adapterRun('resolve-alert', drillId);
  const resolution = await waitReceipt('resolution-receipt', drillId);
  check('alert-resolution-receipt', Number.isFinite(Date.parse(String(resolution?.resolvedAt || ''))));
  alertResolved = true;
  report.alertResolved = true;
  report.status = 'passed';
})().catch(error => {
  report.error = String(error?.message || error);
  process.exitCode = 1;
}).finally(() => {
  if (alertSent && !alertResolved) {
    try { adapterRun('resolve-alert', report.drillId); } catch (error) {
      report.alertCleanupError = String(error?.message || error);
    }
  }
  report.finishedAt = new Date().toISOString();
  writeAndBind();
  console.log(`Enterprise observability drill: ${report.status.toUpperCase()}`);
  console.log(`Report: ${reportPath}`);
});
