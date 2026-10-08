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
    startedAt: '2026-01-01T00:00:01.100Z', finishedAt: '2026-01-01T00:00:02.000Z', evidence: id === 'purchase-browser-readback' ? require('./fixtures/purchase-role-proof-fixture.cjs').purchaseRoleProofFixture() : id === 'payment-event-audit-once' ? require('./fixtures/payment-event-proof-fixture.cjs').paymentEventProofFixture(profile === 'cloud' ? 'postgresql' : 'sqlite') : id === 'payment-submit-durable-replay' ? require('./fixtures/payment-submission-proof-fixture.cjs').paymentSubmissionProofFixture(profile === 'cloud' ? 'postgresql' : 'sqlite') : id === 'payment-duplicate-verification' ? { reconciliation: require('./fixtures/payment-adjustment-proof-fixture.cjs').paymentAdjustmentProofFixture() } : id === 'payment-reversal-browser' ? { version: 'payment-reversal-acceptance/v1', api: require('./fixtures/payment-reversal-api-proof-fixture.cjs').paymentReversalApiProofFixture(), browser: require('./fixtures/payment-reversal-browser-proof-fixture.cjs').paymentReversalBrowserProofFixture(profile === 'cloud' ? 'postgresql' : 'sqlite') } : { readback: true } })) };
  for (const [browserId, sourceId, status] of [
    ['stock-contention-browser', 'stock-20-contention', undefined],
    ['transfer-shipping-browser', 'transfer-shipping-contention', 'in_transit'],
  ]) {
    const { source, proof } = require('./fixtures/inventory-browser-proof-fixture.cjs').inventoryBrowserFixture(status);
    round2.checks.find(c => c.id === browserId).evidence = proof;
    round2.checks.find(c => c.id === sourceId).evidence = source;
  }
  round2.summary = summarize(round2, catalog); round2.status = round2.summary.status;
  const sales = { ...stamp, status: 'passed', stillOwedQuantity: 60, browserCreatedDraft: {}, browserReadbackFault: {}, finalPersisted: {}, finalCostLedger: [], finalReadbacks: [{}, {}] };
  const salesPlan = require('./lib/sales-fulfillment-plan-test-fixture.cjs').salesPlanFixture({ ...stamp, runId: 'current-presale-source' });
  round2.checks.find(c => c.id === 'presale-with-fulfillment-plan').evidence = {
    ...require('./lib/sales-fulfillment-plan-proof.cjs').verifyPresaleProof(salesPlan), sourceRunId: salesPlan.runId,
    sourceReportSha256: require('node:crypto').createHash('sha256').update(JSON.stringify(salesPlan)).digest('hex'),
  };
  // Synthetic verifier fixture only; real acceptance comes from HTTP + raw DB.
  const authorization = { ...stamp, version: 'authorization-dual-node/v1', status: 'passed', adminId: 1, actor: { id: 2 },
    commit: context.commit, commitAfter: context.commit, sourceHash: context.sourceHash, sourceHashAfter: context.sourceHash,
    checks: ['new-grant-visible-on-both-nodes', 'granted-role-can-really-write-on-both-nodes',
      'revoke-denies-real-write-on-both-nodes', 'revoked-write-has-zero-stock-or-ledger-effect',
      'auth-me-and-enforcement-agree', 'policy-changes-have-actor-audit', 'source-unchanged'].map(id => ({ id, status: 'passed' })),
    observations: Object.fromEntries([['newRoleReads', 200], ['authorizedTransfers', 201], ['revokedTransfers', 403]]
      .map(([key, status]) => [key, [0, 1].map(instance => ({ instance, status }))])),
    before: { balances: [{ quantity: 98 }, { quantity: 2 }], movements: [1, 2, 3, 4, 5], entries: [1, 2, 3], batches: [], costs: [] },
    roleAudits: [1, 2, 3].map(id => ({ id, userId: 1 })) };
  authorization.after = structuredClone(authorization.before);
  authorization.observations.profilesAfterRevoke = [0, 1].map(instance => ({ instance, profile: { id: 2, permissions: ['warehouse.read'] } }));
  const jobs = ['research','planner','operator'];
  const write = ['production.bom.write','production.plan.write','production.execute'];
  const production = authorization.production = {status:'passed',actors:jobs.map((job,i)=>({job,id:i+3,role:'custom_'+job,permissions:['dashboard.read','materials.read','production.read',write[i]],dataScopes:['warehouse_visible']}))};
  production.before={boms:[0,1].map(i=>({id:10+i,createdBy:3,items:[{quantityPerUnit:1,unit:'kg'}]})),orders:[0,1].map(i=>({id:20+i,bomId:10+i,createdBy:4,status:'in_progress',steps:[{id:30+i,status:'in_progress'}]})),audits:[0,1].flatMap(i=>[['CREATE_PRODUCTION_BOM',3,10+i],['CREATE_PRODUCTION_WORK_ORDER',4,20+i],['UPDATE_PRODUCTION_WORK_ORDER_STATUS',5,20+i],['UPDATE_PRODUCTION_STEP',5,30+i]].map(([action,userId,resourceId])=>({action,userId,resourceId}))),balances:[],costs:[]};
  production.after=structuredClone(production.before);production.final=structuredClone(production.before);production.final.orders[1].status='cancelled';production.final.audits.push({action:'UPDATE_PRODUCTION_WORK_ORDER_STATUS',userId:4,resourceId:21});
  production.allowed=[0,1].flatMap(instance=>[['research','bom',201,10+instance],['planner','plan',201,20+instance],['operator','start',200,20+instance],['operator','step',200,30+instance]].map(([job,operation,status,id])=>({job,operation,instance,status,json:{success:true,data:{id}}})));production.allowed.push({job:'planner',operation:'cancel',instance:1,status:200,json:{success:true,data:{id:21}}});
  production.denied=[0,1].flatMap(instance=>[['planner','bom'],['operator','bom'],['research','plan'],['operator','plan'],['research','execute'],['planner','execute'],['research','cancel'],['operator','cancel']].map(([job,operation])=>({job,operation,instance,status:403,json:{success:false,requiredPermissions:[operation==='bom'?write[0]:operation==='execute'?write[2]:write[1]]}})));
  production.denialAudits=production.denied.map((d,i)=>({id:i+1,userId:production.actors.find(a=>a.job===d.job).id,resource:'/api/production/fixture',details:'Status: 403, Duration: 1ms'}));
  production.browser=production.actors.map(a=>({job:a.job,actorId:a.id,role:a.role,instance:1,boundBomId:10,workOrderId:20,inventoryReadback:'未授权',errors:[],bomSaveVisible:a.job==='research',planSaveVisible:a.job==='planner',executeVisible:a.job==='operator',cancelVisible:a.job==='planner',bomScreenshot:'synthetic-bom.png',workOrderScreenshot:'synthetic-order.png'}));
  const legacy = { ...stamp, provider: 'sqlite', status: 'passed', before: 'c'.repeat(64), after: 'c'.repeat(64), integrity: 'ok',
    repeatedRepairUnchanged: true, originalBusinessRowsUnchanged: true, fixtureKind: 'reconstructed-legacy-schema', originalTableCount: 63,
    obligations: [{ status: 'review', requestKey: null, paymentReference: null }], attempts: [{ refundRejected: true, reversalRejected: true }] };
  const steps = Object.fromEntries(baseline.revisions.at(-1).cloudSteps.map(id => [id, { outcome: 'success', conclusion: 'success' }]));
  steps.round2_business = { outcome: 'failure', conclusion: 'success' }; steps.cash_legacy_upgrade = { outcome: 'success' };
  // Disk reports are separately serialized; do not retain aliases to the expected context.
  return JSON.parse(JSON.stringify({ baseline, context, currentCommit: context.commit, currentSourceHash: context.sourceHash,
    reports: { round2, sales, salesPlan, authorization, legacy }, steps, now: Date.parse('2026-01-01T00:00:04.000Z') }));
}

test('baseline replay may pass while full 37-check acceptance remains incomplete', () => {
  for (const profile of ['cloud', 'local']) {
    const result = evaluateRegression(fixture(profile));
    assert.equal(result.status, 'passed', JSON.stringify(result.checks.filter(c => c.status !== 'passed')));
    assert.equal(result.fullAcceptanceStatus, 'incomplete');
    assert.match(result.scope, profile === 'local' ? /cloud baseline still required/ : /Cloud baseline/);
  }
});

for (const [label, mutate] of [
  ['stale source run', d => { d.reports.salesPlan.regression.key = 'old-run'; }],
  ['wrong source digest', d => { d.reports.round2.checks.find(c => c.id === 'presale-with-fulfillment-plan').evidence.sourceReportSha256 = '0'.repeat(64); }],
  ['wrong source identity', d => { d.reports.round2.checks.find(c => c.id === 'presale-with-fulfillment-plan').evidence.sourceRunId = 'another-source'; }],
  ['summary without mixed-supply facts', d => { delete d.reports.salesPlan.presale; }],
  ['source process failed', d => { d.reports.salesPlan.status = 'failed'; }],
  ['reservation falsely claimed', d => { d.reports.round2.checks.find(c => c.id === 'presale-with-fulfillment-plan').evidence.reservationAccepted = true; }],
]) test(`fixed presale obligation rejects ${label}`, () => {
  const d = fixture(); mutate(d); const result = evaluateRegression(d);
  assert.equal(result.checks.find(c => c.id === 'round2:presale-with-fulfillment-plan').status, 'failed');
});

for (const [label, mutate] of [
  ['missing real role', p => p.actors.pop()],
  ['broad grant', p => p.actors[0].permissions.push('production.execute')],
  ['missing allowed node', p => p.allowed.splice(4, 4)],
  ['denial silently allowed', p => { p.denied[0].status = 201; }],
  ['wrong guard denial', p => { p.denied[0].json.requiredPermissions = ['materials.read']; }],
  ['business side effect', p => { p.after.orders[0].status = 'cancelled'; }],
  ['wrong BOM creator', p => { p.before.boms[0].createdBy = 4; p.after = structuredClone(p.before); }],
  ['missing business audit', p => p.before.audits.pop()],
  ['missing rejection audit', p => p.denialAudits.pop()],
  ['UI plan escalation', p => { p.browser[2].planSaveVisible = true; }],
  ['UI error', p => p.browser[0].errors.push('403 unrelated-module read')],
  ['BOM rewritten on cancellation', p => { p.final.boms[0].items[0].quantityPerUnit = 2; }],
  ['allowed response belongs to another order', p => { p.allowed[1].json.data.id = 999; }],
  ['wrong cancellation audit actor', p => { p.final.audits[8].userId = 5; }],
  ['cancellation changes frozen BOM link', p => { p.final.orders[1].bomId = 999; }],
  ['unauthorized stock shown as zero', p => { p.browser[0].inventoryReadback = 0; }],
]) test(`production responsibility verifier rejects synthetic corruption: ${label}`, () => {
  const data = fixture(); mutate(data.reports.authorization.production);
  const result = evaluateRegression(data); assert.equal(result.checks.find(c => c.id === 'production-responsibilities').status, 'failed');
});

for (const scenario of ['valid-noisy-output', 'missing-result', 'wrong-mode', 'unexpected-grant']) test(`fallback audit requires actual worker evidence: ${scenario}`, () => {
  const source = fs.readFileSync(path.join(__dirname, 'casbin-fallback-policy-audit-v1.cjs'), 'utf8');
  const outputs = ['strict', 'fallback'].map(mode => {
    const result = { mode, allowed: mode === 'fallback', errorMessage: mode === 'strict' ? 'Missing dynamic tables' : null };
    if (scenario === 'wrong-mode') result.mode = 'other';
    if (scenario === 'unexpected-grant') result.allowed = !result.allowed;
    return { status: 0, signal: null, stderr: '', stdout: '{"unrelated":"Prisma logger JSON"}\n'
      + (scenario === 'missing-result' ? '' : `RBAC_FALLBACK_PROBE_RESULT ${JSON.stringify(result)}\n`) };
  });
  let report;
  const processStub = { env: {}, platform: 'linux', cwd: () => path.resolve(__dirname, '..'), exitCode: 0 };
  require('node:vm').runInNewContext(source, { process: processStub, console: { log() {} },
    require: name => name === 'fs' ? { mkdirSync() {}, writeFileSync(file, json) { report = JSON.parse(json); } }
      : name === 'child_process' ? { spawnSync: () => outputs.shift() } : require(name) });
  assert.equal(report.status, scenario === 'valid-noisy-output' ? 'passed' : 'failed');
  assert.equal(processStub.exitCode, scenario === 'valid-noisy-output' ? 0 : 1);
});

for (const id of ['stock-contention-browser', 'transfer-shipping-browser']) test(`${id} must replay real facts, not a passed flag`, () => {
  const data = fixture();
  data.reports.round2.checks.find(c => c.id === id).evidence.readbacks[0].customerCatalogRequests = 1;
  const result = evaluateRegression(data);
  assert.equal(result.status, 'failed');
  assert.equal(result.checks.find(c => c.id === `round2:${id}`).status, 'failed');
  assert.equal(result.checks.find(c => c.id === 'sales-partial-fulfillment').status, 'passed');
});

test('existing accepted payment ID cannot pass after erasing its newly protected applied-finance evidence', () => {
  const data = fixture(); const e = data.reports.round2.checks.find(c => c.id === 'payment-duplicate-verification').evidence;
  e.reconciliation.stages[4].order.paidAmount = 400; e.passed = true;
  const r = evaluateRegression(data); assert.equal(r.status, 'failed');
  assert.equal(r.checks.find(c => c.id === 'round2:payment-duplicate-verification').status, 'failed');
  assert.equal(r.checks.find(c => c.id === 'sales-partial-fulfillment').status, 'passed', 'Later independent checks must not be truncated');
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
  ['missing cross-node authorization replay', d => { d.reports.authorization = null; }],
  ['stale authorization source', d => { d.reports.authorization.sourceHashAfter = 'd'.repeat(64); }],
  ['secondary node grant denied', d => { d.reports.authorization.observations.newRoleReads[1].status = 403; }],
  ['secondary node revoked write succeeds', d => { d.reports.authorization.observations.revokedTransfers[1].status = 201; }],
  ['denied write altered stock', d => { d.reports.authorization.after.balances[0].quantity = 97; }],
  ['denied write altered cost', d => { d.reports.authorization.after.costs.push({ costAmountDelta: -10 }); }],
  ['UI profile still grants revoked permission', d => { d.reports.authorization.observations.profilesAfterRevoke[1].profile.permissions.push('warehouse.write'); }],
  ['skipped cross-node authorization cloud process', d => { d.steps.authorization_dual_node.outcome = 'skipped'; }],
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

test('payment event acceptance remains a cumulative obligation on both providers', () => {
  assert(baseline.revisions.at(-1).round2Checks.includes('payment-event-audit-once'));
  for (const profile of ['local', 'cloud']) {
    const data = fixture(profile);
    data.reports.round2.checks.find(c => c.id === 'payment-event-audit-once').status = 'not_run';
    data.reports.round2.summary = summarize(data.reports.round2, catalog);
    assert.equal(evaluateRegression(data).status, 'failed');
  }
});

test('a passed flag cannot hide duplicate downstream payment effects', () => {
  const data = fixture();
  data.reports.round2.checks.find(c => c.id === 'payment-event-audit-once').evidence.receiver.accepted[0].effects = 2;
  const result = evaluateRegression(data);
  assert.equal(result.status, 'failed');
  assert.equal(result.checks.find(c => c.id === 'round2:payment-event-audit-once').status, 'failed');
});
test('a passed flag cannot hide an extra registration after an unknown browser acknowledgement', () => {
  const data = fixture();
  data.reports.round2.checks.find(c => c.id === 'payment-submit-durable-replay').evidence.browser.recoveredResponse.json.paymentSubmission.requestKey = 'new-request-key';
  const result = evaluateRegression(data);
  assert.equal(result.status, 'failed'); assert.equal(result.checks.find(c => c.id === 'round2:payment-submit-durable-replay').status, 'failed');
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

const { verifyPurchaseRoleProof } = require('./lib/enterprise-round2-procurement.cjs');
const { purchaseRoleProofFixture } = require('./fixtures/purchase-role-proof-fixture.cjs');
test('synthetic PO verifier fixture is valid but not business execution', () => {
  assert.deepEqual(verifyPurchaseRoleProof(purchaseRoleProofFixture()), { actors: 3, deniedWrites: 26, browserWrites: 4, receivedQuantity: 5, remainingQuantity: 7, receivedCost: 50 });
});
for (const [label, corrupt] of [
  ['shared identity', e => { e.actors[1].id = e.actors[0].id; }],
  ['buyer overgrant', e => { e.actors[0].permissions.push('procurement.receive'); }],
  ['warehouse all scope', e => { e.actors[2].dataScopes = ['all']; }],
  ['missing denial', e => { e.denied.pop(); }],
  ['wrong denial permission', e => { e.denied[0].response.requiredPermissions = ['procurement.write']; }],
  ['denied side effect', e => { e.afterDenied.orders[0].quantity = 999; }],
  ['missing rejection audit', e => { e.denialAudits.pop(); }],
  ['approval actor swapped', e => { e.final.audits[2].userId = 10; }],
  ['receipt receiver swapped', e => { e.final.receipts[0].receivedBy = 10; }],
  ['stock overreceipt', e => { e.final.balances[0].quantity = 12; }],
  ['batch trace swapped', e => { e.final.costs[0].batchId = 999; }],
  ['cost drift', e => { e.final.costs[0].costAmountDelta = 120; }],
  ['stale second node', e => { e.readbacks[1].receiptSummary.remainingQuantity = 12; }],
  ['unauthorized browser action', e => { e.browser[0].receiveEnabled = true; }],
  ['missing browser', e => { e.browser.pop(); }],
  ['browser API failure', e => { e.browser[1].errors = ['403 /api/orders']; }],
  ['stale purchase permission notice', e => { e.browser[1].purchaseNotice = '审批和收货需要采购写入权限'; }],
  ['stale receipt permission notice', e => { e.browser[0].receiptNotice = '保存收货需要采购写入权限'; }],
  ['editable loading form', e => { e.receiptLoadingGuard.inputsDisabled = 0; }],
  ['missing loading proof', e => { delete e.receiptLoadingGuard; }],
  ['default quantity submitted instead of input', e => { e.writes[3].request.quantity = 12; }],
  ['default batch submitted instead of input', e => { e.writes[3].request.batchNo = 'default'; }],
]) test(`PO proof rejects ${label}`, () => { const e = purchaseRoleProofFixture(); corrupt(e); assert.throws(() => verifyPurchaseRoleProof(e)); });
