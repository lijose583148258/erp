const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const catalog = require('./config/enterprise-round2-v1.json');
const filename = path.join(__dirname, 'lib/enterprise-round2-workforce-proof.cjs');
const requireLocal = createRequire(filename);
const clone = value => JSON.parse(JSON.stringify(value));

// Composition unit fixture only. Existing domain readers have their own real
// fixtures/negative suites. Their arithmetic/browser internals are seams here;
// this test never claims that synthetic HTTP or a synthetic PG crash occurred.
function fixture(provider = 'sqlite') {
  const loaded = { exports: {} }, calls = [];
  const seam = name => {
    if (name === './enterprise-round2-sales-proof.cjs') return { verifySharedSalesChain() { calls.push('sales'); }, verifySharedSalesBrowser: () => ({ fixture: true }) };
    if (name === './enterprise-round2-procurement.cjs') return { verifyWorkforceRevisionWrites(...args) {
      calls.push('po'); return requireLocal(name).verifyWorkforceRevisionWrites(...args);
    } };
    if (name === './enterprise-round2-density-conversion.cjs') return { assertDensityCostConservation: () => ({ fixture: true }) };
    if (name === './enterprise-round2-production-disposition.cjs') return { assertProductionDispositionCostReconciliation: () => ({ fixture: true }) };
    if (name === './enterprise-round2-stock-workforce.cjs') return { verifyStockWorkforce() { calls.push('stock'); } };
    if (name === './enterprise-round2-inventory-browser.cjs') return { verifyInventoryBrowser() { calls.push('stock-browser'); } };
    if (name === './payment-submission-proof.cjs') return { verifyPaymentSubmissionProof() { calls.push('payment'); } };
    if (name === './payment-event-proof.cjs') return { verifyPaymentEventProof() { calls.push('event'); } };
    if (name === './payment-reversal-browser-proof.cjs') return { verifyPaymentReversalWorkforceProof: () => ({ reversalId: 'synthetic-reversal' }) };
    if (name === './enterprise-round2-barter-actor-proof.cjs') return { assertBarterDutyEvidence() { calls.push('barter'); } };
    if (name === './enterprise-round2-barter-partial.cjs') return { assertBarterBrowserChain: () => ({ fixture: true }) };
    if (name === './enterprise-round2-qc-isolation.cjs') return { verifyQcSelfReviews() { calls.push('qc'); }, assertQcIsolationCase() {} };
    if (name === './enterprise-round2-postgres-recovery-proof.cjs') return {
      verifyPostgresRecoveryProof(e, options) { assert.equal(options.runId, 'unit-workforce'); assert.equal(options.priorChecks.length, 37); calls.push('postgres'); },
      verifyPostgresLedgerRecovery: () => ({ fixture: true }),
    };
    return requireLocal(name);
  };
  new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(seam, loaded, loaded.exports);
  const policyModule = { exports: {} }, policyPath = path.join(__dirname, 'lib/enterprise-round2-workforce.cjs');
  new Function('require', 'module', 'exports', fs.readFileSync(policyPath, 'utf8') + '\nmodule.exports.policies = policies;')(
    createRequire(policyPath), policyModule, policyModule.exports);
  const runId = 'unit-workforce', prefix = `r2wf_${crypto.createHash('sha256').update(`${runId}-workforce`).digest('hex').slice(0, 12)}`;
  let id = 100;
  const people = catalog.roles.flatMap(({ job, count }) => Array.from({ length: count }, (_, i) => {
    const actor = { id: ++id, job, index: i + 1, role: `${prefix}_${job}` };
    actor.profile = { id: actor.id, username: `${actor.role}_${actor.index}`, role: actor.role, segment: 'mixed', isActive: true,
      mustChangePassword: false, ...clone(policyModule.exports.policies[job]) };
    actor.profilesByInstance = { 0: clone(actor.profile), 1: clone(actor.profile) };
    actor.currentProfilesByInstance = clone(actor.profilesByInstance);
    actor.currentProfileResponsesByInstance = Object.fromEntries([0, 1].map(i => [i, { ok: true, status: 200, json: { success: true, data: actor.currentProfilesByInstance[i] } }]));
    return actor;
  }));
  const actor = (job, index = 1) => people.find(p => p.job === job && p.index === index);
  const compact = a => ({ id: a.id, job: a.job, index: a.index, role: a.role });
  const order = (id, person, more = {}) => ({ id, createdBy: person.id, ...more });
  const response = data => ({ status: 200, json: { success: true, data } });
  const action = (a, method, path, id) => ({ actorId: a.id, role: a.role, instance: 0, method, path, status: 201, json: { success: true, data: { id } } });
  const report = { startedAt: '2026-01-01T00:00:00.000Z', metadata: { runId, provider, appUrls: ['http://127.0.0.1:5006', 'http://127.0.0.1:5008'] },
    workforcePreparation: { version: 'enterprise-round2-workforce-preparation/v1', actors: people, actions: [], finalization: { startedAt: '2026-01-01T00:00:03.000Z' } },
    checks: catalog.chains.flatMap(c => c.checks).map(id => ({ id,
      status: id === 'workforce-rbac' || (provider === 'sqlite' && ['database-restart-ambiguous-commit', 'recovery-full-ledger-reconciliation'].includes(id)) ? 'not_run' : 'passed',
      startedAt: '2026-01-01T00:00:01.000Z', finishedAt: '2026-01-01T00:00:02.000Z', evidence: { fixture: true } })) };
  const set = (id, value) => { report.checks.find(c => c.id === id).evidence = value; return value; };
  const get = id => report.checks.find(c => c.id === id).evidence;
  const sale = action(actor('sales'), 'POST', '/orders', 201); sale.sent = { customerId: 301, items: [{ materialId: 1, quantity: 150 }] };
  const sales = set('sales-reservation-partial-fulfillment', { runId, workforce: { actors: people.map(compact) }, actions: [sale],
    manifest: { orderId: 201, planId: 1, shipmentIds: [1, 2], paymentRecordId: 1, purchaseOrderId: 1, purchaseReceiptId: 1, qualityCheckId: 1, supplierPaymentId: 1 } });
  const audit = (id, buyer, action, details) => ({ id, userId: actor('buyer', buyer).id, resource: 'purchase_order', resourceId: 1, action, details: JSON.stringify(details) });
  const poWrites = [[1, 'PATCH', '', 200], [2, 'PATCH', '', 409], [2, 'PATCH', '', 200], [2, 'POST', '/confirm-sources', 200], [1, 'PATCH', '/status', 200]]
    .map(([buyer, method, suffix, status]) => ({ actorId: actor('buyer', buyer).id, role: actor('buyer', buyer).role, instance: buyer - 1, method, path: `/api/procurement/orders/1${suffix}`, status }));
  const poAudits = [audit(1, 1, 'CREATE', {}), audit(2, 2, 'STATUS_CHANGE', {}),
    audit(3, 1, 'REVISE', { schema: 'purchase-revision/v1', after: { id: '1', revision: 1, quantity: 120, price: 11 } }),
    audit(4, 2, 'REVISE', { schema: 'purchase-revision/v1', after: { id: '1', revision: 2, quantity: 80, price: 9 } }),
    audit(5, 2, 'CONFIRM_SOURCES', { schema: 'purchase-source-confirmation/v1', after: { id: '1', revision: 3 }, source: { revision: 3 } }),
    audit(6, 1, 'STATUS_CHANGE', { schema: 'purchase-status/v2', revision: 3, from: 'pending', to: 'approved', isSourceApproval: true, sourceAuditId: 5 })];
  set('po-reapproval-browser', { orderId: 1, persisted: { id: 1, status: 'approved', revision: 3 }, workforce: { version: 'purchase-revision-workforce/v1',
    actors: [1, 2].map(i => ({ ...compact(actor('buyer', i)), browserProfile: actor('buyer', i).profile })), browserWrites: poWrites, databaseAudits: poAudits } });
  const duties = { research: compact(actor('research')), planner: compact(actor('production_planner')), operator: compact(actor('production_operator')),
    qc: compact(actor('qc')), qa: compact(actor('qa')) };
  const inspected = { id: 1, inspectorUserId: actor('qc').id, reviewedByUserId: actor('qa').id };
  set('bom-revision-freeze', { productionActors: clone(duties), roleActions: [action(actor('production_operator'), 'PATCH', '/production/work-orders/10/status', 10)], history: {
    v1: order(1, actor('research')), v2: order(2, actor('research')), oldDefinition: order(1, actor('research')),
    old: order(10, actor('production_planner')), newer: order(11, actor('production_planner'), { bomId: 2 }),
    persisted: order(10, actor('production_planner'), { bomId: 1, status: 'completed', batchId: 1, qualityChecks: [inspected] }), oldQc: { id: 1 },
    costs: [1, 2].map(id => ({ id, createdBy: actor('production_operator').id, workOrderId: 10 })) } });
  const multi = { ...clone(duties), operators: [compact(actor('production_operator')), compact(actor('production_operator', 2))], warehouse: compact(actor('warehouse', 2)) };
  const lots = Array.from({ length: 3 }, (_, n) => ({ final: { rawBatch: { id: n + 1 }, workOrders: [0, 1].map(i => order(20 + n * 2 + i, actor('production_planner'))),
    statusAudits: [0, 1].map(i => ({ userId: actor('production_operator', i + 1).id, resourceId: 20 + n * 2 + i, action: 'UPDATE_PRODUCTION_WORK_ORDER_STATUS' })) } }));
  set('dual-workorder-same-lot', { productionActors: multi, cases: lots, violations: [], roleActions: lots.flatMap(c => c.final.workOrders.map((w, i) => action(actor('production_operator', i + 1), 'PATCH', `/production/work-orders/${w.id}/status`, w.id))) });
  set('genealogy-readback', { productionActor: compact(actor('production_operator', 2)) });
  set('mass-packaging-density-conversion', { productionActors: clone(duties), case: { bom: order(3, actor('research')), approved: { id: 1 },
    after: { wo: order(30, actor('production_planner')), audits: [{ userId: actor('production_operator').id }] } } });
  set('loss-return-scrap-rework', { productionActors: { ...multi, cost: compact(actor('cost_accountant')) }, case: { workOrder: { id: 31 }, outputBatch: { id: 31 },
    afterScrap: { disposition: order(1, actor('production_operator')) }, afterRework: { reworkDisposition: order(2, actor('production_operator')), reworkBatch: { id: 32 } } },
    browser: { actorId: actor('production_operator').id, after: { dispositions: [order(3, actor('production_operator'))] } },
    costReadbacks: Array.from({ length: 4 }, () => ({ actorId: actor('cost_accountant').id, status: 200, rawRows: [{ id: 1 }] })) });
  set('stock-20-contention', { workforce: { people: people.map(compact), appUrls: report.metadata.appUrls }, state: { batch: { id: 1 }, entries: [{ id: 1 }] }, responses: [{ actorId: 1 }] });
  set('transfer-shipping-contention', { shipmentId: 40, persisted: order(40, actor('warehouse', 3), { customerId: 302 }),
    responses: [{ operation: 'transfer', actorId: actor('warehouse', 2).id, status: 409 }, { operation: 'shipping', actorId: actor('warehouse', 3).id, status: 200 }],
    state: { entries: [{ id: 40, sourceType: 'shipping_issue', createdBy: actor('warehouse', 3).id }] } });
  const ca = action(actor('sales', 2), 'POST', '/customers', 302); ca.json.data.salespersonId = actor('sales', 2).id; report.workforcePreparation.actions.push(ca);
  set('payment-submit-durable-replay', { workforce: { cohort: people.map(compact), actors: { sales: compact(actor('sales', 3)), requester: compact(actor('receivables')), reviewer: compact(actor('owner')) } }, orderId: 50, finalSnapshot: { payments: [{ id: 50 }] } });
  set('payment-event-audit-once', { workforceObserver: compact(actor('receivables')) });
  set('payment-reversal-browser', { browser: { workforce: { adjustmentActorId: 1 } }, workforceProof: { reversalId: 'synthetic-reversal' } });
  const barter = { barterActors: { sales: compact(actor('sales', 3)), approver: compact(actor('owner')), poster: compact(actor('receivables')), reverser: compact(actor('payables')) }, agreementId: 60 };
  set('barter-partial-fulfillment', clone(barter)); set('barter-negative-cash-adjustment', clone(barter));
  const quality = { author: compact(actor('research')), planner: compact(actor('production_planner')), operator: compact(actor('production_operator')), inspector: compact(actor('qc')), reviewer: compact(actor('qa')) };
  set('qc-quarantine-blocks-issue', { productionActors: quality, cases: [{ qc: { id: 1 }, batchId: 1 }] });
  set('qa-release-traceability-browser', { productionActors: quality });
  const before = { customer: [{ id: 301, status: 'active' }, { id: 302, salespersonId: actor('sales', 2).id }],
    order: [order(201, actor('sales'))], orderItem: [{ orderId: 201 }], auditLog: [{ resourceId: 201, userId: actor('sales').id, action: 'CREATE' }] };
  report.workforcePreparation.operations = { actorId: actor('system_admin').id, role: actor('system_admin').role,
    nodes: [0, 1].map(instance => ({ instance, status: response({}), backups: response([]), auditPath: `/audit?userId=${actor('owner').id}&page=1&pageSize=100`,
      audit: response([{ userId: actor('owner').id, resource: 'supplier_payment', resourceId: sales.manifest.supplierPaymentId }]) })),
    denial: { actorId: actor('system_admin').id, instance: 1, path: '/orders', method: 'POST', profileStatus: 200, profile: actor('system_admin').profile,
      status: 403, json: { success: false, requiredPermissions: ['orders.create'] }, before, after: clone(before), positiveControl: clone(sale), sent: clone(sale.sent) } };
  if (provider === 'postgresql') set('database-restart-ambiguous-commit', { workforceActors: { version: 'postgres-recovery-workforce-actors/v1',
    actors: { warehouse: compact(actor('warehouse', 3)), sales: compact(actor('sales', 3)), approver: compact(actor('sales_lead')), receivables: compact(actor('receivables')) } },
    manifest: { orderId: 70, paymentId: 70, shipmentIds: [70, 71] } });
  return { report, get, actor, calls, verify: options => loaded.exports.verifyWorkforceParticipation(report, options) };
}

test('composition-only fixture distinguishes eleven local chains from full PG obligations without changing fixed37', () => {
  const local = fixture(), proof = local.verify({ requirePostgres: false });
  assert.equal(proof.people.length, 20); assert.equal(proof.chains.length, 11); assert.equal(proof.businessParticipationAccepted, false);
  assert.deepEqual(proof.remainingChains, ['R2-12']); assert.equal(proof.priorChecks.length, 34);
  const pg = fixture('postgresql'), full = pg.verify();
  assert.equal(full.chains.length, 12); assert.equal(full.priorChecks.length, 36); assert(pg.calls.includes('postgres'));
  assert.equal(pg.report.checks.find(c => c.id === 'workforce-rbac').status, 'not_run', 'The pure reader must not mutate producer status');
});

for (const [name, mutate] of [
  ['recorded execution failure', h => { h.report.executionError = 'Interrupted execution'; }],
  ['recorded setup failure', h => { h.report.setupError = 'Failed setup'; }],
  ['another run', h => { h.report.metadata.runId += '-foreign'; }],
  ['missing person', h => { h.report.workforcePreparation.actors.pop(); }],
  ['missing current read window', h => { delete h.report.workforcePreparation.finalization; }],
  ['premature current profiles', h => { h.report.workforcePreparation.finalization.startedAt = h.report.startedAt; }],
  ['duplicate identity', h => { h.report.workforcePreparation.actors[1].id = h.report.workforcePreparation.actors[0].id; }],
  ['missing initial node', h => { delete h.actor('sales').profilesByInstance[1]; }],
  ['missing final node', h => { delete h.actor('sales').currentProfileResponsesByInstance[1]; }],
  ['final HTTP denied', h => { h.actor('qa').currentProfileResponsesByInstance[1].status = 403; }],
  ['inactive final user', h => { h.actor('qa').currentProfilesByInstance[1].isActive = false; }],
  ['extra real grant', h => { h.actor('qa').currentProfilesByInstance[1].permissions.push('production.execute'); }],
  ['all scope', h => { h.actor('cost_accountant').currentProfilesByInstance[0].dataScopes.push('all'); }],
  ['profile substitution', h => { h.actor('sales').currentProfilesByInstance[0] = clone(h.actor('sales', 2).profile); }],
  ['missing check', h => { h.report.checks.pop(); }],
  ['old chain not run', h => { h.report.checks.find(c => c.id === 'bom-revision-freeze').status = 'not_run'; }],
  ['missing raw evidence', h => { h.report.checks.find(c => c.id === 'presale-with-fulfillment-plan').evidence = {}; }],
  ['foreign time window', h => { h.report.checks[1].startedAt = '2025-01-01T00:00:00Z'; }],
  ['SQLite claiming PG', h => { h.report.checks.find(c => c.id === 'database-restart-ambiguous-commit').status = 'passed'; }],
  ['global borrowed actor', h => { h.report.workforcePreparation.actions[0].actorId = 1; }],
  ['sales second cohort', h => { h.get('sales-reservation-partial-fulfillment').workforce.actors[0].id = 1; }],
  ['buyer substituted', h => { h.get('po-reapproval-browser').workforce.actors[1].id = h.actor('buyer').id; }],
  ['purchasing audit substituted', h => { h.get('po-reapproval-browser').workforce.databaseAudits.at(-1).userId = h.actor('buyer', 2).id; }],
  ['BOM created by admin', h => { h.get('bom-revision-freeze').history.oldDefinition.createdBy = 1; }],
  ['old work order switched BOM', h => { h.get('bom-revision-freeze').history.persisted.bomId = 2; }],
  ['QC self-review persisted', h => { h.get('bom-revision-freeze').history.persisted.qualityChecks[0].reviewedByUserId = h.actor('qc').id; }],
  ['operator changed in cost', h => { h.get('bom-revision-freeze').history.costs[0].createdBy = 1; }],
  ['second operator no persisted audit', h => { h.get('dual-workorder-same-lot').cases[0].final.statusAudits.pop(); }],
  ['genealogy borrowed identity', h => { h.get('genealogy-readback').productionActor.id = 1; }],
  ['density foreign actor', h => { h.get('mass-packaging-density-conversion').case.after.audits[0].userId = 1; }],
  ['scrap submitted by admin', h => { h.get('loss-return-scrap-rework').case.afterScrap.disposition.createdBy = 1; }],
  ['cost reads missing', h => { h.get('loss-return-scrap-rework').costReadbacks.pop(); }],
  ['stock another cohort', h => { h.get('stock-20-contention').workforce.people[0].id = 1; }],
  ['transfer two winners', h => { h.get('transfer-shipping-contention').responses[0].status = 201; }],
  ['shipment winner not voucher author', h => { h.get('transfer-shipping-contention').state.entries[0].createdBy = h.actor('warehouse', 2).id; }],
  ['sales two fake customer ownership', h => { h.report.workforcePreparation.operations.denial.before.customer[1].salespersonId = 1; }],
  ['payment another sales user', h => { h.get('payment-submit-durable-replay').workforce.actors.sales.id = h.actor('sales').id; }],
  ['event no AR observer', h => { delete h.get('payment-event-audit-once').workforceObserver; }],
  ['barter AP replaced by AR', h => { h.get('barter-partial-fulfillment').barterActors.reverser.id = h.actor('receivables').id; }],
  ['QC QA alias', h => { h.get('qc-quarantine-blocks-issue').productionActors.reviewer.id = h.actor('qc').id; }],
  ['admin missing actual audit', h => { h.report.workforcePreparation.operations.nodes[1].audit.json.data = []; }],
  ['admin business effect', h => { h.report.workforcePreparation.operations.denial.after.customer[0].status = 'inactive'; }],
  ['admin invalid positive body', h => { h.report.workforcePreparation.operations.denial.sent.customerId = 999; }],
]) test(`workforce composition fails closed: ${name}`, () => {
  const h = fixture(); mutate(h); assert.throws(() => h.verify({ requirePostgres: false }));
});

test('PG final gate cannot borrow SQLite or independent recovery actors', () => {
  assert.throws(() => fixture().verify(), /provider/);
  const h = fixture('postgresql'); h.get('database-restart-ambiguous-commit').workforceActors.actors.sales.id = 1;
  assert.throws(() => h.verify(), /Foreign sales/);
});

test('derived summary hashes change when source evidence changes; historical report is never rewritten', () => {
  const h = fixture(), before = clone(h.report), first = h.verify({ requirePostgres: false }); assert.deepEqual(h.report, before);
  h.get('presale-with-fulfillment-plan').newFact = true;
  const second = h.verify({ requirePostgres: false }); assert.notDeepEqual(first.priorChecks, second.priorChecks);
});
