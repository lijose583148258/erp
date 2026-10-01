const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const baseline = require('./config/enterprise-regression-baseline-v1.json');
const catalog = require('./config/enterprise-round2-v1.json');
const { evaluateRegression, validateBaseline } = require('./lib/enterprise-regression.cjs');
const { summarize, validateCatalog } = require('./lib/enterprise-round2-runner.cjs');
const futureId = validateCatalog(catalog).find(id => !baseline.revisions.at(-1).round2Checks.includes(id));

function fixture(profile = 'cloud') {
  const context = { version: 'enterprise-regression-run/v1', profile, key: 'unique-current-run', commit: 'a'.repeat(40), sourceHash: 'b'.repeat(64), startedAt: '2026-01-01T00:00:00.000Z' };
  const stamp = { regression: context, startedAt: '2026-01-01T00:00:01.000Z', finishedAt: '2026-01-01T00:00:03.000Z', provider: profile === 'cloud' ? 'postgresql' : 'sqlite' };
  const protectedIds = baseline.revisions.at(-1).round2Checks;
  const round2 = { ...stamp, checks: validateCatalog(catalog).map(id => ({ id, status: protectedIds.includes(id) ? 'passed' : 'not_run',
    startedAt: '2026-01-01T00:00:01.100Z', finishedAt: '2026-01-01T00:00:02.000Z', evidence: { readback: true } })) };
  round2.summary = summarize(round2, catalog); round2.status = round2.summary.status;
  const sales = { ...stamp, status: 'passed', stillOwedQuantity: 60, browserCreatedDraft: {}, browserReadbackFault: {}, finalPersisted: {}, finalCostLedger: [], finalReadbacks: [{}, {}] };
  const salesPlan = require('./lib/sales-fulfillment-plan-test-fixture.cjs').salesPlanFixture(stamp);
  const legacy = { ...stamp, provider: 'sqlite', status: 'passed', before: 'c'.repeat(64), after: 'c'.repeat(64), integrity: 'ok',
    repeatedRepairUnchanged: true, originalBusinessRowsUnchanged: true, fixtureKind: 'reconstructed-legacy-schema', originalTableCount: 63,
    obligations: [{ status: 'review', requestKey: null, paymentReference: null }], attempts: [{ refundRejected: true, reversalRejected: true }] };
  const steps = Object.fromEntries(baseline.revisions.at(-1).cloudSteps.map(id => [id, { outcome: 'success', conclusion: 'success' }]));
  steps.round2_business = { outcome: 'failure', conclusion: 'success' }; steps.cash_legacy_upgrade = { outcome: 'success' };
  // Disk reports are separately serialized; do not retain aliases to the expected context.
  return JSON.parse(JSON.stringify({ baseline, context, currentCommit: context.commit, currentSourceHash: context.sourceHash,
    reports: { round2, sales, salesPlan, legacy }, steps, now: Date.parse('2026-01-01T00:00:04.000Z') }));
}

test('baseline replay may pass while full 37-check acceptance remains incomplete', () => {
  for (const profile of ['cloud', 'local']) {
    const result = evaluateRegression(fixture(profile));
    assert.equal(result.status, 'passed', JSON.stringify(result.checks.filter(c => c.status !== 'passed')));
    assert.equal(result.fullAcceptanceStatus, 'incomplete');
    assert.match(result.scope, profile === 'local' ? /cloud baseline still required/ : /Cloud baseline/);
  }
});

for (const status of ['failed', 'not_run', 'blocked', 'unsupported', 'running', 'timed_out']) test(`prior passed ID becomes ${status}: reject even if total pass count is replaced`, () => {
  const data = fixture();
  data.reports.round2.checks.find(c => c.id === 'po-stale-edit-conflict').status = status;
  data.reports.round2.checks.find(c => c.id === futureId).status = 'passed';
  data.reports.round2.summary = summarize(data.reports.round2, catalog); data.reports.round2.status = data.reports.round2.summary.status;
  const result = evaluateRegression(data); assert.equal(result.status, 'failed');
  assert.equal(result.checks.find(c => c.id === 'round2:po-stale-edit-conflict').status, 'failed');
  assert.equal(result.checks.find(c => c.id === 'barter-cash-legacy-upgrade').status, 'passed', 'Later checks must still execute');
});

for (const [label, mutate] of [
  ['missing evidence ID', d => { d.reports.round2.checks.shift(); }],
  ['duplicate evidence ID', d => { d.reports.round2.checks.push(d.reports.round2.checks.find(c => c.status === 'passed')); }],
  ['unknown evidence ID', d => { d.reports.round2.checks.push({ id: 'invented', status: 'passed' }); }],
  ['empty check proof', d => { d.reports.round2.checks.find(c => c.status === 'passed').evidence = {}; }],
  ['missing execution timestamps', d => { delete d.reports.round2.checks.find(c => c.status === 'passed').finishedAt; }],
  ['stale run', d => { d.reports.sales.regression.key = 'old-run'; }],
  ['different SHA', d => { d.currentCommit = 'd'.repeat(40); }],
  ['source changed', d => { d.currentSourceHash = 'e'.repeat(64); }],
  ['old execution window', d => { d.reports.sales.startedAt = '2025-12-31T23:59:59Z'; }],
  ['wrong provider', d => { d.reports.round2.provider = 'sqlite'; }],
  ['missing independent report', d => { d.reports.sales = null; }],
  ['empty legacy report', d => { d.reports.legacy = {}; }],
  ['missing supply plan replay', d => { d.reports.salesPlan = null; }],
  ['stale supply plan evidence', d => { d.reports.salesPlan.regression.key = 'old'; }],
  ['empty supply plan browser proof', d => { d.reports.salesPlan.browserCreate = {}; }],
  ['minimal fixture replacing legacy database', d => { d.reports.legacy.originalTableCount = 1; d.reports.legacy.fixtureKind = 'minimal-legacy-boundary'; }],
  ['legacy business mutation', d => { d.reports.legacy.after = 'd'.repeat(64); }],
  ['legacy refund incorrectly opened', d => { d.reports.legacy.obligations[0].status = 'open'; }],
  ['forged green summary', d => { d.reports.round2.summary.passedChecks = 37; }],
  ['timeout with leftover success report', d => { d.executionErrors = [{ signal: 'SIGTERM' }]; }],
  ['green conclusion hiding failure', d => { d.steps.human_workflows.outcome = 'failure'; }],
  ['skipped first-round search check', d => { d.steps.search_readiness.outcome = 'skipped'; }],
  ['round2 not requested and skipped', d => { d.steps.round2_business.outcome = 'skipped'; }],
  ['legacy process skipped', d => { d.steps.cash_legacy_upgrade.outcome = 'skipped'; }],
  ['rewritten initial baseline', d => { d.baseline.revisions[0].round2Checks[0] = futureId; }],
  ['new pass not promoted', d => { d.reports.round2.checks.find(c => c.id === futureId).status = 'passed'; d.reports.round2.summary = summarize(d.reports.round2, catalog); }],
]) test(`cumulative gate rejects ${label}`, () => {
  const data = fixture(); mutate(data); assert.equal(evaluateRegression(data).status, 'failed');
});

test('baseline revisions can only grow; accepted new IDs become mandatory', () => {
  const data = fixture(); const next = structuredClone(data.baseline.revisions.at(-1)); next.id = 'next-package';
  next.round2Checks.push(futureId); data.baseline.revisions.push(next);
  assert.equal(evaluateRegression(data).status, 'failed');
  data.reports.round2.checks.find(c => c.id === futureId).status = 'passed';
  data.reports.round2.summary = summarize(data.reports.round2, catalog);
  assert.equal(evaluateRegression(data).status, 'passed');
  next.round2Checks.shift(); assert.throws(() => validateBaseline(data.baseline), /shrank/);
});

test('cloud always replays prior checks, isolates legacy failures and aggregates regression outcome', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/enterprise-cloud-sandbox.yml'), 'utf8');
  const section = workflow.split('        id: round2_business')[1].split('\n      - name:')[0];
  assert.match(section, /always\(\)/); assert.doesNotMatch(section, /inputs\.round2/);
  assert.match(workflow, /id: cash_legacy_upgrade\s+continue-on-error: true/);
  assert.match(workflow, /id: cumulative_regression\s+if: always\(\)\s+continue-on-error: true/);
  assert.match(workflow, /node scripts\/enterprise-cumulative-regression-v1.cjs begin cloud/);
  const summary = fs.readFileSync(path.join(__dirname, 'enterprise-cloud-business-audit-summary-v1.cjs'), 'utf8');
  assert.match(summary, /\['cumulative_regression',/);
  assert.equal(baseline.revisions[0].round2Checks.length, 12);
  assert.equal(baseline.revisions[0].cloudSteps.length, 22);
});
