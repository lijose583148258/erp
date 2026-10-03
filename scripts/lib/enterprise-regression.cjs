// Built-ins only: also imported by the source gate before npm install.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { summarize, validateCatalog } = require('./enterprise-round2-runner.cjs');
const catalog = require('../config/enterprise-round2-v1.json');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const headCommit = root => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 5000, windowsHide: true }).trim();

function sourceFingerprint(root) {
  const hash = crypto.createHash('sha256');
  function visit(relative) {
    const file = path.join(root, relative);
    if (fs.statSync(file).isDirectory()) {
      for (const name of fs.readdirSync(file).sort()) visit(`${relative}/${name}`);
    } else hash.update(relative).update('\0').update(fs.readFileSync(file));
  }
  for (const name of ['backend/src', 'backend/prisma/schema.prisma', 'backend/prisma/models', 'backend/prisma/postgres-migrations',
    'scripts', 'pages', 'services', 'src', 'utils', 'i18n', 'app', 'components', '.github/workflows',
    'shared', 'sdk', 'translations', 'public', 'config',
    'App.tsx', 'constants.tsx', 'index.tsx', 'index.css', 'index.html', 'translations.ts', 'types.ts',
    'vite.config.ts', 'tsconfig.json', 'tsconfig.strict.json', 'tailwind.config.cjs', 'postcss.config.cjs', 'backend/tsconfig.json',
    'package.json', 'package-lock.json', 'backend/package.json', 'backend/package-lock.json']) visit(name);
  return hash.digest('hex');
}

function beginRegression(root, profile) {
  assert(['local', 'cloud'].includes(profile), 'Unknown regression profile');
  return { version: 'enterprise-regression-run/v1', profile, key: crypto.randomUUID(),
    commit: headCommit(root),
    sourceHash: sourceFingerprint(root), startedAt: new Date().toISOString(),
    githubRunId: process.env.GITHUB_RUN_ID || null, githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT || null };
}

function readRegressionStamp() {
  const file = process.env.REGRESSION_CONTEXT_PATH;
  if (!file) return null;
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(value.version, 'enterprise-regression-run/v1');
  return value;
}

function validateBaseline(baseline) {
  assert.equal(baseline.version, 'enterprise-regression-baseline/v1');
  assert(baseline.revisions?.length > 0, 'Empty baseline');
  // Freeze the reviewed first snapshot. Extend by appending, never rewrite away a prior obligation.
  assert.equal(sha256(JSON.stringify(baseline.revisions[0])), '97a2780073bb485597e17e144c3582f3d4cfea406a56ee161add0857712250f8', 'Reviewed baseline anchor changed');
  const known = validateCatalog(catalog);
  const ids = new Set(); let previous;
  for (const revision of baseline.revisions) {
    assert(revision.id && !ids.has(revision.id), 'Duplicate/empty baseline revision'); ids.add(revision.id);
    for (const key of ['round2Checks', 'independentChecks', 'cloudSteps']) {
      assert(Array.isArray(revision[key]) && revision[key].length > 0, `Empty baseline ${key}`);
      assert.equal(new Set(revision[key]).size, revision[key].length, `Duplicate baseline ${key}`);
      assert(revision[key].every(id => typeof id === 'string' && id.length > 0));
      assert(!previous || previous[key].every(id => revision[key].includes(id)), `Baseline shrank: ${key}`);
    }
    assert(revision.round2Checks.every(id => known.includes(id)), 'Unknown baseline check');
    assert(['barter-cash-legacy-upgrade', 'sales-partial-fulfillment'].every(id => revision.independentChecks.includes(id)), 'Core independent checks cannot be removed');
    assert(revision.independentChecks.every(id => ['barter-cash-legacy-upgrade', 'sales-partial-fulfillment', 'sales-fulfillment-plan'].includes(id)), 'Independent adapters must be implemented explicitly');
    previous = revision;
  }
  return previous;
}

function verifyFresh(report, context, provider, now) {
  assert.deepEqual(report.regression, context, 'Stale or foreign run/source identity');
  const started = Date.parse(report.startedAt), finished = Date.parse(report.finishedAt);
  assert(Number.isFinite(started) && Number.isFinite(finished), 'Missing execution timestamps');
  assert(started >= Date.parse(context.startedAt) && finished >= started && finished <= now, 'Evidence outside execution window');
  assert.equal(report.metadata?.provider || report.provider, provider, 'Wrong database environment');
  assert(!report.error && !report.executionError && !report.setupError, 'Report contains execution errors');
}

function evaluateRegression({ baseline, context, currentCommit, currentSourceHash, reports, steps = {}, executionErrors = [], now = Date.now() }) {
  const results = [];
  const record = (id, action) => {
    try { const evidence = action(); results.push({ id, status: 'passed', evidence }); }
    catch (error) { results.push({ id, status: 'failed', error: error.message }); }
  };
  let revision;
  record('process-completion', () => { assert.equal(executionErrors.length, 0, 'Probe process failed or timed out'); return { errors: 0 }; });
  record('baseline-integrity', () => { revision = validateBaseline(baseline); return { revision: revision.id }; });
  record('current-source', () => {
    assert.equal(context?.version, 'enterprise-regression-run/v1');
    assert(['cloud', 'local'].includes(context.profile));
    assert.match(context.commit, /^[a-f0-9]{40}$/); assert.match(context.sourceHash, /^[a-f0-9]{64}$/);
    assert.equal(context.commit, currentCommit, 'Commit changed after regression started');
    assert(context.key && Number.isFinite(Date.parse(context.startedAt)));
    assert.equal(context.sourceHash, currentSourceHash, 'Source changed after regression started');
    return { commit: context.commit, sourceHash: currentSourceHash };
  });
  const provider = context?.profile === 'cloud' ? 'postgresql' : 'sqlite';
  const round2 = reports.round2;
  record('round2-report-integrity', () => {
    verifyFresh(round2, context, provider, now);
    if (context.profile === 'cloud') assert(['success', 'failure'].includes(steps.round2_business?.outcome), 'Round 2 replay was skipped/missing');
    assert.deepEqual(round2.summary, summarize(round2, catalog), 'Forged/stale summary');
    assert.equal(round2.status, round2.summary.status);
    assert.equal(round2.checks.length, validateCatalog(catalog).length, 'Missing fixed catalog entries');
    assert.equal(round2.summary.failedChecks, 0, 'New or old Round 2 check failed');
    assert(!round2.checks.some(c => ['running', 'blocked'].includes(c.status)), 'Unfinished/blocked execution');
    const unprotected = round2.checks.filter(c => c.status === 'passed' && !revision?.round2Checks.includes(c.id)).map(c => c.id);
    assert.equal(unprotected.length, 0, `Review and promote new passed IDs to the baseline: ${unprotected.join(', ')}`);
    return { status: round2.status, remaining: round2.summary.remainingChecks };
  });
  for (const id of revision?.round2Checks || []) record(`round2:${id}`, () => {
    verifyFresh(round2, context, provider, now);
    const matches = round2.checks.filter(c => c.id === id); assert.equal(matches.length, 1, 'Missing/duplicate check ID');
    const check = matches[0]; assert.equal(check.status, 'passed', 'Previously passed check regressed or was skipped');
    assert(check.evidence && Object.keys(check.evidence).length, 'Missing read-back evidence');
    if (id === 'payment-event-audit-once') require('./payment-event-proof.cjs').verifyPaymentEventProof(check.evidence, provider);
    if (id === 'payment-submit-durable-replay') require('./payment-submission-proof.cjs').verifyPaymentSubmissionProof(check.evidence, provider);
    if (id === 'payment-duplicate-verification') require('./payment-adjustment-proof.cjs').verifyPaymentAdjustmentProof(check.evidence.reconciliation);
    assert(Date.parse(check.startedAt) >= Date.parse(round2.startedAt) && Date.parse(check.finishedAt) >= Date.parse(check.startedAt)
      && Date.parse(check.finishedAt) <= Date.parse(round2.finishedAt), 'Missing/invalid check execution timestamps');
    return { evidenceSha256: sha256(JSON.stringify(check.evidence)) };
  });
  record('sales-partial-fulfillment', () => {
    const r = reports.sales; verifyFresh(r, context, provider, now); assert.equal(r.status, 'passed');
    assert.equal(r.stillOwedQuantity, 60);
    for (const key of ['browserCreatedDraft', 'browserReadbackFault', 'finalPersisted', 'finalCostLedger', 'finalReadbacks']) assert(r[key], `Missing sales proof: ${key}`);
    assert.equal(r.finalReadbacks.length, 2);
    return { evidenceSha256: sha256(JSON.stringify(r)) };
  });
  record('barter-cash-legacy-upgrade', () => {
    const r = reports.legacy; verifyFresh(r, context, 'sqlite', now); assert.equal(r.status, 'passed');
    assert(['reconstructed-legacy-schema', 'copied-legacy-database'].includes(r.fixtureKind) && r.originalTableCount >= 63, 'Full legacy schema rehearsal required');
    if (context.profile === 'cloud') assert.equal(steps.cash_legacy_upgrade?.outcome, 'success', 'Legacy guard process failed/skipped');
    assert.equal(r.repeatedRepairUnchanged, true); assert.equal(r.originalBusinessRowsUnchanged, true);
    assert.match(r.before, /^[a-f0-9]{64}$/); assert.equal(r.before, r.after); assert.equal(r.integrity, 'ok');
    assert(r.obligations.length > 0 && r.obligations.every(row => row.status === 'review' && row.requestKey === null && row.paymentReference === null));
    assert.equal(r.attempts.length, r.obligations.length);
    assert(r.attempts.every(row => row.refundRejected && row.reversalRejected));
    return { evidenceSha256: sha256(JSON.stringify(r)), fixtureKind: r.fixtureKind };
  });
  if (revision?.independentChecks.includes('sales-fulfillment-plan')) record('sales-fulfillment-plan', () => {
    const r = reports.salesPlan; verifyFresh(r, context, provider, now);
    const proof = require('./sales-fulfillment-plan-proof.cjs').verifySalesPlanProof(r);
    return { ...proof, evidenceSha256: sha256(JSON.stringify(r)) };
  });
  if (context?.profile === 'cloud') for (const id of revision?.cloudSteps || []) record(`cloud:${id}`, () => {
    assert.equal(steps[id]?.outcome, 'success', 'Prior cloud audit failed, skipped or missing (conclusion is not sufficient)');
    return { outcome: steps[id].outcome };
  });
  return { name: 'Cumulative regression (not complete enterprise acceptance)', version: 'enterprise-regression/v1',
    status: results.every(r => r.status === 'passed') ? 'passed' : 'failed', regression: context,
    scope: context?.profile === 'cloud' ? 'Cloud baseline plus SQLite legacy guard' : 'Local subset only; cloud baseline still required',
    fullAcceptanceStatus: round2?.status || 'missing', baselineRevision: revision?.id,
    summary: { expected: results.length, passed: results.filter(r => r.status === 'passed').length, failed: results.filter(r => r.status === 'failed').length },
    checks: results, finishedAt: new Date(now).toISOString() };
}
module.exports = { beginRegression, headCommit, sourceFingerprint, readRegressionStamp, validateBaseline, evaluateRegression };
