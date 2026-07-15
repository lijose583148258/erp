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
const resolveInput = (flag, label) => {
  const value = valueFor(flag);
  if (!value) fail(`Missing ${flag}.`);
  const absolute = path.resolve(value);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) fail(`${label} file does not exist.`);
  return absolute;
};
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const writeAtomic = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
};
const requireStrictKeys = (value, allowed, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  const unexpected = Object.keys(value).filter(key => !allowed.includes(key));
  if (unexpected.length) fail(`${label} contains unsupported fields: ${unexpected.join(', ')}.`);
};
const parseTime = (value, label) => {
  const timestamp = Date.parse(String(value || ''));
  if (!Number.isFinite(timestamp)) fail(`${label} timestamp is invalid.`);
  if (timestamp > Date.now() + 300_000) fail(`${label} timestamp is in the future.`);
  return timestamp;
};

const environment = String(valueFor('--environment') || '').trim();
const commitSha = String(valueFor('--commit-sha') || '').trim();
const imageDigest = String(valueFor('--image-digest') || '').trim();
const date = String(valueFor('--date') || new Date().toISOString().slice(0, 10)).trim();
const checkedAt = String(valueFor('--checked-at') || new Date().toISOString()).trim();
const continuousPath = resolveInput('--continuous-report', 'Continuous report');
const alertPath = resolveInput('--alert-review', 'Alert review');
const reconciliationPath = resolveInput('--reconciliation', 'Reconciliation');
const incidentPath = resolveInput('--incident-review', 'Incident review');
const aiGovernancePath = resolveInput('--ai-governance-review', 'AI governance review');
const dailyOutputValue = valueFor('--daily-output');
const ledgerValue = valueFor('--ledger');
if (!dailyOutputValue || !ledgerValue) fail('--daily-output and --ledger are required.');
const dailyOutput = path.resolve(dailyOutputValue);
const ledgerPath = path.resolve(ledgerValue);
const dailyDir = path.dirname(dailyOutput);
if (path.basename(dailyOutput) !== `${date}.json`) fail('Daily output filename must be <UTC-date>.json.');
const checkedAtMs = parseTime(checkedAt, 'checkedAt');
if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(checkedAtMs).toISOString().slice(0, 10) !== date) {
  fail('Daily date must match checkedAt in UTC.');
}
if (!environment || /^replace-/i.test(environment)) fail('A real pilot environment is required.');
if (!/^[0-9a-f]{40}$/.test(commitSha)) fail('Commit SHA is invalid.');
if (!/^sha256:[0-9a-f]{64}$/.test(imageDigest)) fail('Image digest is invalid.');
if (fs.existsSync(dailyOutput) && !has('--replace-date')) fail(`Daily report already exists for ${date}.`);

const continuous = readJson(continuousPath);
if (continuous.status !== 'passed' || continuous.commitSha !== commitSha || continuous.imageDigest !== imageDigest) {
  fail('Continuous report is not passed or does not match the release identity.');
}
const continuousHash = sha256(continuousPath);

let ledger = { schemaVersion: 1, environment, entries: [] };
if (fs.existsSync(ledgerPath)) ledger = readJson(ledgerPath);
if (ledger.schemaVersion !== 1 || ledger.environment !== environment || !Array.isArray(ledger.entries)) {
  fail('Existing pilot ledger is invalid or belongs to another environment.');
}
const existingIndex = ledger.entries.findIndex(entry => entry.date === date);
if (existingIndex >= 0 && !has('--replace-date')) fail(`Pilot ledger already contains ${date}.`);

const alertReview = readJson(alertPath);
requireStrictKeys(alertReview, ['schemaVersion', 'status', 'reviewedAt', 'reviewer', 'deliveryVerified', 'unresolvedCriticalAlerts'], 'Alert review');
if (alertReview.schemaVersion !== 1 || alertReview.status !== 'passed' || alertReview.deliveryVerified !== true
  || Number(alertReview.unresolvedCriticalAlerts) !== 0 || String(alertReview.reviewer || '').trim().length < 2) {
  fail('Alert review is incomplete.');
}
if (new Date(parseTime(alertReview.reviewedAt, 'Alert review')).toISOString().slice(0, 10) !== date) fail('Alert review date does not match daily report.');

const reconciliation = readJson(reconciliationPath);
requireStrictKeys(reconciliation, ['schemaVersion', 'status', 'checkedAt', 'reviewer', 'unreconciledBusinessWrites'], 'Reconciliation');
if (reconciliation.schemaVersion !== 1 || reconciliation.status !== 'passed'
  || Number(reconciliation.unreconciledBusinessWrites) !== 0 || String(reconciliation.reviewer || '').trim().length < 2) {
  fail('Business reconciliation is incomplete.');
}
if (new Date(parseTime(reconciliation.checkedAt, 'Reconciliation')).toISOString().slice(0, 10) !== date) fail('Reconciliation date does not match daily report.');

const incidentReview = readJson(incidentPath);
requireStrictKeys(incidentReview, ['schemaVersion', 'status', 'checkedAt', 'reviewer', 'unresolvedIncidents'], 'Incident review');
if (incidentReview.schemaVersion !== 1 || incidentReview.status !== 'passed'
  || Number(incidentReview.unresolvedIncidents) !== 0 || String(incidentReview.reviewer || '').trim().length < 2) {
  fail('Incident review is incomplete.');
}
if (new Date(parseTime(incidentReview.checkedAt, 'Incident review')).toISOString().slice(0, 10) !== date) fail('Incident review date does not match daily report.');

const aiGovernance = readJson(aiGovernancePath);
requireStrictKeys(aiGovernance, [
  'schemaVersion',
  'status',
  'checkedAt',
  'reviewer',
  'governedAiRequests',
  'budgetBreaches',
  'privacyIncidents',
  'crossTenantLeaks',
  'unresolvedAiIncidents',
  'fallbackVerified',
], 'AI governance review');
const governedAiRequests = Number(aiGovernance.governedAiRequests);
if (aiGovernance.schemaVersion !== 1 || aiGovernance.status !== 'passed'
  || !Number.isInteger(governedAiRequests) || governedAiRequests < 0
  || Number(aiGovernance.budgetBreaches) !== 0
  || Number(aiGovernance.privacyIncidents) !== 0
  || Number(aiGovernance.crossTenantLeaks) !== 0
  || Number(aiGovernance.unresolvedAiIncidents) !== 0
  || aiGovernance.fallbackVerified !== true
  || String(aiGovernance.reviewer || '').trim().length < 2) {
  fail('AI governance review is incomplete or contains a policy breach.');
}
if (new Date(parseTime(aiGovernance.checkedAt, 'AI governance review')).toISOString().slice(0, 10) !== date) {
  fail('AI governance review date does not match daily report.');
}

fs.mkdirSync(dailyDir, { recursive: true });
const supportValues = {
  alertReview: alertReview,
  reconciliation,
  incidentReview,
  aiGovernance,
};
const support = {};
for (const [name, value] of Object.entries(supportValues)) {
  const file = `${date}.${name}.json`;
  const absolute = path.join(dailyDir, file);
  writeAtomic(absolute, value);
  support[name] = { file, sha256: sha256(absolute) };
}
const daily = {
  schemaVersion: 1,
  date,
  checkedAt,
  status: 'passed',
  environment,
  commitSha,
  imageDigest,
  continuousReportSha256: continuousHash,
  alertReviewCompleted: true,
  unreconciledBusinessWrites: 0,
  serviceIncidentsResolved: true,
  aiGovernanceReviewCompleted: true,
  governedAiRequests,
  support,
};
writeAtomic(dailyOutput, daily);
const dailyHash = sha256(dailyOutput);

const entry = {
  date,
  checkedAt,
  status: 'passed',
  commitSha,
  imageDigest,
  reportFile: path.basename(dailyOutput),
  dailyReportSha256: dailyHash,
  continuousReportSha256: continuousHash,
  alertReviewCompleted: true,
  unreconciledBusinessWrites: 0,
  serviceIncidentsResolved: true,
  aiGovernanceReviewCompleted: true,
  governedAiRequests,
};
if (existingIndex >= 0) ledger.entries.splice(existingIndex, 1, entry);
else ledger.entries.push(entry);
ledger.entries.sort((left, right) => String(left.checkedAt).localeCompare(String(right.checkedAt)));
writeAtomic(ledgerPath, ledger);

console.log('Pilot daily review: PASSED');
console.log(`Daily report: ${dailyOutput}`);
console.log(`Pilot ledger: ${ledgerPath}`);
