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
    assert(revision.independentChecks.every(id => ['barter-cash-legacy-upgrade', 'sales-partial-fulfillment', 'sales-fulfillment-plan', 'authorization-dual-node', 'production-responsibilities'].includes(id)), 'Independent adapters must be implemented explicitly');
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

function verifyProductionResponsibilities(p) {
  assert.equal(p.status, 'passed'); assert.deepEqual(p.actors.map(a => a.job), ['research', 'planner', 'operator']);
  assert.equal(new Set(p.actors.map(a => a.id)).size, 3); assert.equal(new Set(p.actors.map(a => a.role)).size, 3);
  const permissions = { research: 'production.bom.write', planner: 'production.plan.write', operator: 'production.execute' };
  const actors = Object.fromEntries(p.actors.map(a => [a.job, a]));
  for (const a of p.actors) {
    assert.deepEqual([...a.permissions].sort(), ['dashboard.read', 'materials.read', 'production.read', permissions[a.job]].sort());
    assert.deepEqual(a.dataScopes, ['warehouse_visible']); assert(!['admin', 'manager', 'warehouse'].includes(a.role));
  }
  const allowed = [0, 1].flatMap(instance => [['research', 'bom', 201], ['planner', 'plan', 201], ['operator', 'start', 200], ['operator', 'step', 200]]
    .map(([job, operation, status]) => ({ job, operation, instance, status })));
  allowed.push({ job: 'planner', operation: 'cancel', instance: 1, status: 200 });
  assert.deepEqual(p.allowed.map(({ job, operation, instance, status }) => ({ job, operation, instance, status })), allowed);
  assert(p.allowed.every(r => r.json.success === true && r.json.data?.id));
  const denied = [0, 1].flatMap(instance => [['planner', 'bom'], ['operator', 'bom'], ['research', 'plan'], ['operator', 'plan'],
    ['research', 'execute'], ['planner', 'execute'], ['research', 'cancel'], ['operator', 'cancel']].map(([job, operation]) => ({ job, operation, instance, status: 403 })));
  assert.deepEqual(p.denied.map(({ job, operation, instance, status }) => ({ job, operation, instance, status })), denied);
  for (const r of p.denied) {
    const permission = r.operation === 'cancel' ? permissions.planner : r.operation === 'execute' ? permissions.operator : r.operation === 'bom' ? permissions.research : permissions.planner;
    assert.equal(r.json.success, false); assert.deepEqual(r.json.requiredPermissions, [permission]);
  }
  assert.deepEqual(p.after, p.before, 'Denied writes changed business rows');
  assert.equal(p.before.boms.length, 2); assert.equal(p.before.orders.length, 2); assert.equal(p.before.audits.length, 8);
  assert.deepEqual(p.before.balances, []); assert.deepEqual(p.before.costs, []);
  for (const [index, order] of p.before.orders.entries()) {
    const bom = p.before.boms[index]; assert.equal(order.bomId, bom.id);
    assert.equal(bom.createdBy, actors.research.id); assert.equal(order.createdBy, actors.planner.id);
    assert.equal(bom.items.length, 1); assert.equal(bom.items[0].quantityPerUnit, 1); assert.equal(bom.items[0].unit, 'kg');
    assert.equal(order.status, 'in_progress'); assert.equal(order.steps.length, 1); assert.equal(order.steps[0].status, 'in_progress');
    for (const [action, actorId, resourceId] of [['CREATE_PRODUCTION_BOM', actors.research.id, bom.id], ['CREATE_PRODUCTION_WORK_ORDER', actors.planner.id, order.id],
      ['UPDATE_PRODUCTION_WORK_ORDER_STATUS', actors.operator.id, order.id], ['UPDATE_PRODUCTION_STEP', actors.operator.id, order.steps[0].id]]) {
      assert.equal(p.before.audits.filter(a => a.action === action && a.userId === actorId && a.resourceId === resourceId).length, 1);
    }
  }
  assert.equal(p.denialAudits.length, 16); assert.equal(new Set(p.denialAudits.map(a => a.id)).size, 16);
  assert(p.denialAudits.every(a => p.actors.some(actor => actor.id === a.userId) && a.resource.startsWith('/api/production/') && a.details.startsWith('Status: 403,')));
  assert.deepEqual(p.browser.map(b => b.job), ['research', 'planner', 'operator']);
  for (const b of p.browser) {
    assert.equal(b.actorId, actors[b.job].id); assert.equal(b.role, actors[b.job].role); assert.equal(b.instance, 1);
    assert.equal(b.boundBomId, p.before.boms[0].id); assert.equal(b.workOrderId, p.before.orders[0].id); assert.deepEqual(b.errors, []);
    assert.equal(b.inventoryReadback, '未授权');
    for (const [key, job] of [['bomSaveVisible', 'research'], ['planSaveVisible', 'planner'], ['executeVisible', 'operator'], ['cancelVisible', 'planner']]) assert.equal(b[key], b.job === job);
    assert(b.bomScreenshot && b.workOrderScreenshot);
  }
  assert.deepEqual(p.final.boms, p.before.boms); assert.deepEqual(p.final.orders[0], p.before.orders[0]);
  assert.equal(p.final.orders[1].id, p.before.orders[1].id); assert.equal(p.final.orders[1].status, 'cancelled');
  assert.deepEqual({ ...p.final.orders[1], status: null, updatedAt: null }, { ...p.before.orders[1], status: null, updatedAt: null }, 'Cancellation rewrote unrelated work order facts');
  assert.deepEqual(p.final.balances, []); assert.deepEqual(p.final.costs, []); assert.equal(p.final.audits.length, 9);
  assert.deepEqual(p.final.audits.slice(0, 8), p.before.audits);
  const cancelAudit = p.final.audits[8];
  assert.equal(cancelAudit.action, 'UPDATE_PRODUCTION_WORK_ORDER_STATUS'); assert.equal(cancelAudit.userId, actors.planner.id); assert.equal(cancelAudit.resourceId, p.before.orders[1].id);
  for (const r of p.allowed) assert.equal(r.json.data.id, r.operation === 'bom' ? p.before.boms[r.instance].id : r.operation === 'step' ? p.before.orders[r.instance].steps[0].id : p.before.orders[r.instance].id);
  return { actors: 3, authorizedWrites: 9, deniedWrites: 16, deniedBusinessEffects: 0, browserRoles: 3, fullWorkforceAccepted: false };
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
    if (id === 'purchase-browser-readback') require('./enterprise-round2-procurement.cjs').verifyPurchaseRoleProof(check.evidence);
    if (id === 'stock-contention-browser' || id === 'transfer-shipping-browser') {
      const sourceId = id === 'stock-contention-browser' ? 'stock-20-contention' : 'transfer-shipping-contention';
      const source = round2.checks.find(c => c.id === sourceId);
      assert.equal(source?.status, 'passed', 'Browser proof requires its successful same-run stock race');
      require('./enterprise-round2-inventory-browser.cjs').verifyInventoryBrowser(check.evidence, source.evidence);
    }
    if (id === 'payment-duplicate-verification') require('./payment-adjustment-proof.cjs').verifyPaymentAdjustmentProof(check.evidence.reconciliation);
    if (id === 'payment-reversal-browser') {
      assert.equal(check.evidence.version, 'payment-reversal-acceptance/v1');
      require('./payment-reversal-api-proof.cjs').verifyPaymentReversalApiProof(check.evidence.api);
      require('./payment-reversal-browser-proof.cjs').verifyPaymentReversalBrowserProof(check.evidence.browser, provider);
    }
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
  if (revision?.independentChecks.includes('authorization-dual-node')) record('authorization-dual-node', () => {
    const r = reports.authorization; verifyFresh(r, context, provider, now);
    assert.equal(r.version, 'authorization-dual-node/v1'); assert.equal(r.status, 'passed');
    assert.equal(r.commit, context.commit); assert.equal(r.commitAfter, context.commit);
    assert.equal(r.sourceHash, context.sourceHash); assert.equal(r.sourceHashAfter, context.sourceHash);
    assert.deepEqual(r.checks.map(c => c.id), ['new-grant-visible-on-both-nodes', 'granted-role-can-really-write-on-both-nodes',
      'revoke-denies-real-write-on-both-nodes', 'revoked-write-has-zero-stock-or-ledger-effect',
      'auth-me-and-enforcement-agree', 'policy-changes-have-actor-audit', 'source-unchanged']);
    assert(r.checks.every(c => c.status === 'passed'));
    for (const [key, status] of [['newRoleReads', 200], ['authorizedTransfers', 201], ['revokedTransfers', 403]]) {
      const rows = r.observations[key]; assert.deepEqual(rows.map(row => row.instance), [0, 1]);
      assert(rows.every(row => row.status === status), `Wrong real HTTP outcome: ${key}`);
    }
    assert.deepEqual(r.observations.profilesAfterRevoke.map(row => row.instance), [0, 1]);
    assert(r.observations.profilesAfterRevoke.every(row => row.profile.id === r.actor.id
      && !row.profile.permissions.includes('warehouse.write')));
    assert.deepEqual(r.before.balances.map(row => row.quantity).sort((a, b) => a - b), [2, 98]);
    assert.equal(r.before.movements.length, 5); assert.equal(r.before.entries.length, 3);
    for (const key of ['balances', 'movements', 'entries', 'batches', 'costs']) assert(Array.isArray(r.before[key]));
    assert.deepEqual(r.after, r.before, 'Denied requests changed physical stock, cost or ledger facts');
    assert.equal(r.roleAudits.length, 3); assert(r.roleAudits.every(row => row.userId === r.adminId));
    return { evidenceSha256: sha256(JSON.stringify(r)) };
  });
  if (revision?.independentChecks.includes('production-responsibilities')) record('production-responsibilities', () => {
    const r = reports.authorization; verifyFresh(r, context, provider, now); assert.equal(r.status, 'passed');
    return { ...verifyProductionResponsibilities(r.production), evidenceSha256: sha256(JSON.stringify(r.production)) };
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
module.exports = { beginRegression, headCommit, sourceFingerprint, readRegressionStamp, validateBaseline, evaluateRegression, verifyProductionResponsibilities };
