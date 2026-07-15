const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

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

const continuousPath = resolveFile('--continuous-report', 'Continuous observation report');
const ledgerPath = resolveFile('--ledger', 'Pilot ledger');
const dailyReportsValue = valueFor('--daily-reports-dir');
const dailyReportsDir = dailyReportsValue ? path.resolve(dailyReportsValue) : '';
if (!dailyReportsDir || !fs.existsSync(dailyReportsDir) || !fs.statSync(dailyReportsDir).isDirectory()) {
  fail('Existing --daily-reports-dir is required.');
}
const evidencePath = resolveFile('--evidence', 'Enterprise evidence');
const outputValue = valueFor('--output');
const outputPath = outputValue ? path.resolve(outputValue) : '';
const bind = has('--bind');
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const aiCollectorHash = sha256(path.join(__dirname, 'capture-pilot-ai-governance-review.cjs'));
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const isoMs = (value, label) => {
  const result = Date.parse(String(value || ''));
  if (!Number.isFinite(result)) fail(`Invalid ${label} timestamp.`);
  return result;
};
const hex40 = value => /^[0-9a-f]{40}$/.test(String(value || ''));
const digest = value => /^sha256:[0-9a-f]{64}$/.test(String(value || ''));
const strictKeys = (value, allowed, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  const unexpected = Object.keys(value).filter(key => !allowed.includes(key));
  if (unexpected.length) fail(`${label} contains unsupported fields.`);
};

const continuous = readJson(continuousPath);
const ledger = readJson(ledgerPath);
const evidence = readJson(evidencePath);
if (continuous.environment !== evidence.environment || continuous.evidenceId !== evidence.evidenceId) {
  fail('Continuous observation pilot identity does not match enterprise evidence.');
}
if (continuous.status !== 'passed') fail('Continuous observation report is not passed.');
const startedMs = isoMs(continuous.startedAt, 'continuous startedAt');
const finishedMs = isoMs(continuous.finishedAt, 'continuous finishedAt');
const elapsedMs = finishedMs - startedMs;
const nowMs = Date.now();
if (finishedMs > nowMs + 300_000) fail('Continuous observation finishedAt is in the future.');
if (nowMs - finishedMs > 8 * 86_400_000) fail('Continuous observation report is older than eight days.');
const declaredDurationMs = Number(continuous.durationMs);
if (elapsedMs < 28_800_000) fail('Continuous observation elapsed time is below eight hours.');
if (!Number.isFinite(declaredDurationMs) || declaredDurationMs < 28_800_000) fail('Declared continuous duration is below eight hours.');
if (elapsedMs < declaredDurationMs * 0.98 || elapsedMs > declaredDurationMs + 900_000) {
  fail('Continuous observation timestamps do not match the declared duration.');
}
if (!hex40(continuous.commitSha)) fail('Continuous report commitSha is invalid.');
if (!digest(continuous.imageDigest)) fail('Continuous report imageDigest is invalid.');
if (!digest(continuous.collectorImageDigest)) fail('Continuous report collectorImageDigest is invalid.');
if (Number(continuous?.summary?.failures) !== 0) fail('Continuous observation contains network or HTTP 5xx failures.');
if (!Number.isFinite(Number(continuous?.summary?.p95Ms)) || Number(continuous.summary.p95Ms) >= 2_000) {
  fail('Continuous observation p95 is missing or above two seconds.');
}
const instanceRequests = Object.values(continuous?.summary?.instanceRequests || {}).map(Number);
if (instanceRequests.length < 2 || instanceRequests.some(value => !Number.isFinite(value) || value <= 0)) {
  fail('Continuous observation did not serve requests from two application instances.');
}
const componentSummary = continuous?.summary?.components || {};
for (const name of ['object-storage', 'search-primary', 'search-secondary', 'prometheus', 'tempo', 'alertmanager']) {
  const state = componentSummary[name];
  if (!state || !Number.isInteger(Number(state.probes)) || Number(state.probes) < 2
    || Number(state.failures) !== 0 || !Number.isInteger(Number(state.lastStatus))
    || Number(state.lastStatus) < 200 || Number(state.lastStatus) >= 400) {
    fail(`Continuous component health evidence is incomplete: ${name}.`);
  }
}
if (!Array.isArray(continuous.checks) || continuous.checks.length === 0 || continuous.checks.some(check => check.status !== 'passed')) {
  fail('Continuous observation has missing or failed checks.');
}

if (ledger.schemaVersion !== 1) fail('Pilot ledger schemaVersion must be 1.');
if (ledger.environment !== evidence.environment) fail('Pilot ledger environment does not match enterprise evidence.');
if (!Array.isArray(ledger.entries) || ledger.entries.length < 7) fail('Pilot ledger requires at least seven daily entries.');
const entries = [...ledger.entries].sort((a, b) => isoMs(a.checkedAt, 'ledger checkedAt') - isoMs(b.checkedAt, 'ledger checkedAt'));
const dates = new Set();
let totalGovernedAiRequests = 0;
for (const entry of entries) {
  const checkedMs = isoMs(entry.checkedAt, 'ledger checkedAt');
  if (checkedMs > nowMs + 300_000) fail('Pilot ledger contains a future daily report.');
  const date = new Date(checkedMs).toISOString().slice(0, 10);
  if (entry.date !== date) fail(`Ledger entry date does not match checkedAt: ${entry.date || 'missing'}.`);
  if (dates.has(date)) fail(`Pilot ledger contains duplicate UTC date: ${date}.`);
  dates.add(date);
  if (entry.status !== 'passed') fail(`Pilot ledger entry is not passed: ${date}.`);
  if (entry.alertReviewCompleted !== true) fail(`Alert review is incomplete: ${date}.`);
  if (Number(entry.unreconciledBusinessWrites) !== 0) fail(`Unreconciled business writes exist: ${date}.`);
  if (entry.serviceIncidentsResolved !== true) fail(`Service incident review is incomplete: ${date}.`);
  const governedAiRequests = Number(entry.governedAiRequests);
  if (entry.aiGovernanceReviewCompleted !== true || !Number.isInteger(governedAiRequests) || governedAiRequests < 0) {
    fail(`AI governance review is incomplete: ${date}.`);
  }
  if (!hex40(entry.commitSha) || !digest(entry.imageDigest)) fail(`Release identity is invalid: ${date}.`);
  const reportFile = String(entry.reportFile || '');
  if (!reportFile || path.basename(reportFile) !== reportFile) fail(`Daily report filename is invalid: ${date}.`);
  const dailyPath = path.resolve(dailyReportsDir, reportFile);
  if (!dailyPath.startsWith(dailyReportsDir + path.sep) || !fs.existsSync(dailyPath) || !fs.statSync(dailyPath).isFile()) {
    fail(`Daily report file is missing: ${date}.`);
  }
  const dailyHash = sha256(dailyPath);
  if (entry.dailyReportSha256 !== dailyHash) fail(`Daily report hash does not match: ${date}.`);
  const daily = readJson(dailyPath);
  if (daily.schemaVersion !== 1 || daily.status !== 'passed' || daily.date !== date || daily.checkedAt !== entry.checkedAt) {
    fail(`Daily report identity is invalid: ${date}.`);
  }
  if (daily.commitSha !== entry.commitSha || daily.imageDigest !== entry.imageDigest) fail(`Daily release identity does not match ledger: ${date}.`);
  if (daily.alertReviewCompleted !== true || Number(daily.unreconciledBusinessWrites) !== 0 || daily.serviceIncidentsResolved !== true) {
    fail(`Daily report review or reconciliation failed: ${date}.`);
  }
  if (daily.aiGovernanceReviewCompleted !== true || Number(daily.governedAiRequests) !== governedAiRequests) {
    fail(`Daily AI governance identity is invalid: ${date}.`);
  }
  const supportSpecs = {
    alertReview: {
      allowed: ['schemaVersion', 'status', 'reviewedAt', 'reviewer', 'deliveryVerified', 'unresolvedCriticalAlerts'],
      timestamp: 'reviewedAt',
      valid: value => value.deliveryVerified === true && Number(value.unresolvedCriticalAlerts) === 0,
    },
    reconciliation: {
      allowed: ['schemaVersion', 'status', 'checkedAt', 'reviewer', 'unreconciledBusinessWrites'],
      timestamp: 'checkedAt',
      valid: value => Number(value.unreconciledBusinessWrites) === 0,
    },
    incidentReview: {
      allowed: ['schemaVersion', 'status', 'checkedAt', 'reviewer', 'unresolvedIncidents'],
      timestamp: 'checkedAt',
      valid: value => Number(value.unresolvedIncidents) === 0,
    },
    aiGovernance: {
      allowed: [
        'schemaVersion',
        'status',
        'checkedAt',
        'reviewer',
        'source',
        'collectorImageDigest',
        'collectorSha256',
        'instances',
        'externalAiEnabled',
        'paidModelCalls',
        'metricsBeforeSha256',
        'metricsAfterSha256',
        'governedAiRequests',
        'budgetBreaches',
        'privacyIncidents',
        'crossTenantLeaks',
        'unresolvedAiIncidents',
        'fallbackVerified',
      ],
      timestamp: 'checkedAt',
      valid: value => value.source === 'runtime-probe'
        && value.collectorImageDigest === continuous.collectorImageDigest
        && value.collectorSha256 === aiCollectorHash
        && Array.isArray(value.instances) && new Set(value.instances).size >= 2
        && value.externalAiEnabled === false
        && Number(value.paidModelCalls) === 0
        && /^[0-9a-f]{64}$/.test(String(value.metricsBeforeSha256 || ''))
        && /^[0-9a-f]{64}$/.test(String(value.metricsAfterSha256 || ''))
        && Number(value.governedAiRequests) === governedAiRequests
        && governedAiRequests >= 2
        && Number(value.budgetBreaches) === 0
        && Number(value.privacyIncidents) === 0
        && Number(value.crossTenantLeaks) === 0
        && Number(value.unresolvedAiIncidents) === 0
        && value.fallbackVerified === true,
    },
  };
  for (const [name, spec] of Object.entries(supportSpecs)) {
    const reference = daily.support?.[name];
    const supportFile = String(reference?.file || '');
    if (!supportFile || path.basename(supportFile) !== supportFile || !/^[0-9a-f]{64}$/.test(String(reference?.sha256 || ''))) {
      fail(`Daily support reference is invalid: ${date} ${name}.`);
    }
    const supportPath = path.resolve(dailyReportsDir, supportFile);
    if (!supportPath.startsWith(dailyReportsDir + path.sep) || !fs.existsSync(supportPath) || !fs.statSync(supportPath).isFile()) {
      fail(`Daily support file is missing: ${date} ${name}.`);
    }
    if (sha256(supportPath) !== reference.sha256) fail(`Daily support hash does not match: ${date} ${name}.`);
    const support = readJson(supportPath);
    strictKeys(support, spec.allowed, `Daily support ${date} ${name}`);
    if (support.schemaVersion !== 1 || support.status !== 'passed' || String(support.reviewer || '').trim().length < 2 || !spec.valid(support)) {
      fail(`Daily support review failed: ${date} ${name}.`);
    }
    if (new Date(isoMs(support[spec.timestamp], `daily support ${name}`)).toISOString().slice(0, 10) !== date) {
      fail(`Daily support date does not match: ${date} ${name}.`);
    }
  }
  totalGovernedAiRequests += governedAiRequests;
  if (entry.continuousReportSha256 && daily.continuousReportSha256 !== entry.continuousReportSha256) {
    fail(`Daily continuous-report reference does not match ledger: ${date}.`);
  }
}
if (totalGovernedAiRequests < 1) fail('Seven-day pilot contains no governed AI usage.');
const firstCheckedMs = isoMs(entries[0].checkedAt, 'first ledger checkedAt');
const lastCheckedMs = isoMs(entries.at(-1).checkedAt, 'last ledger checkedAt');
const spanMs = lastCheckedMs - firstCheckedMs;
if (spanMs < 6 * 86_400_000) fail('Pilot ledger does not span at least seven UTC dates.');
if (nowMs - lastCheckedMs > 36 * 3_600_000) fail('Latest pilot daily report is older than 36 hours.');
const orderedDates = [...dates].sort();
for (let index = 1; index < orderedDates.length; index += 1) {
  const previous = Date.parse(orderedDates[index - 1] + 'T00:00:00Z');
  const current = Date.parse(orderedDates[index] + 'T00:00:00Z');
  if (current - previous !== 86_400_000) fail('Pilot ledger UTC dates are not consecutive.');
}
const continuousHash = sha256(continuousPath);
const ledgerHash = sha256(ledgerPath);
if (!entries.some(entry => entry.continuousReportSha256 === continuousHash)) {
  fail('Pilot ledger does not reference the continuous observation report.');
}
if (continuous.commitSha !== evidence.commitSha || continuous.imageDigest !== evidence.imageDigest) {
  fail('Continuous observation release identity does not match enterprise evidence.');
}

const actualHours = elapsedMs / 3_600_000;
if (bind) {
  evidence.observation = {
    ...evidence.observation,
    continuousHours: Number(actualHours.toFixed(3)),
    stagedPilotDays: dates.size,
    zeroUnreconciledBusinessWrites: true,
    alertReviewCompleted: true,
    aiGovernanceReviewCompleted: true,
    governedAiRequests: totalGovernedAiRequests,
    collectorImageDigest: continuous.collectorImageDigest,
    machineVerified: true,
    continuousReportSha256: continuousHash,
    pilotLedgerSha256: ledgerHash,
  };
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}
const boundEvidence = bind ? readJson(evidencePath) : evidence;
if (boundEvidence?.observation?.machineVerified !== true) fail('Observation evidence is not machine bound.');
if (boundEvidence.observation.continuousReportSha256 !== continuousHash) fail('Continuous report hash does not match evidence.');
if (boundEvidence.observation.pilotLedgerSha256 !== ledgerHash) fail('Pilot ledger hash does not match evidence.');
if (Number(boundEvidence.observation.continuousHours) < 8 || Number(boundEvidence.observation.continuousHours) > actualHours + 0.01) {
  fail('Bound continuous hours are invalid.');
}
if (Number(boundEvidence.observation.stagedPilotDays) < 7 || Number(boundEvidence.observation.stagedPilotDays) > dates.size) {
  fail('Bound staged pilot days are invalid.');
}
if (boundEvidence.observation.zeroUnreconciledBusinessWrites !== true || boundEvidence.observation.alertReviewCompleted !== true) {
  fail('Bound reconciliation or alert review evidence is incomplete.');
}
if (boundEvidence.observation.aiGovernanceReviewCompleted !== true
  || Number(boundEvidence.observation.governedAiRequests) !== totalGovernedAiRequests
  || boundEvidence.observation.collectorImageDigest !== continuous.collectorImageDigest) {
  fail('Bound AI governance evidence is incomplete.');
}

const verdict = {
  status: 'passed',
  checkedAt: new Date().toISOString(),
  environment: evidence.environment,
  continuousHours: Number(actualHours.toFixed(3)),
  stagedPilotDays: dates.size,
  governedAiRequests: totalGovernedAiRequests,
  collectorImageDigest: continuous.collectorImageDigest,
  continuousReportSha256: continuousHash,
  pilotLedgerSha256: ledgerHash,
  commitSha: continuous.commitSha,
  imageDigest: continuous.imageDigest,
};
if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(verdict, null, 2)}\n`, 'utf8');
}
console.log('Pilot observation evidence: PASSED');
if (outputPath) console.log(`Verdict: ${outputPath}`);
