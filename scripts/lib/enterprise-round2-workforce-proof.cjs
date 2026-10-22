// Final same-run evidence composition, not another runner or permission system.
// Domain readers retain their stock/money/UI invariants; this reader binds their
// real resources and persisted actors to the original twenty job holders.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const catalog = require('../config/enterprise-round2-v1.json');
const { verifyWorkforceProfile } = require('./enterprise-round2-workforce.cjs');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pgIds = ['database-restart-ambiguous-commit', 'recovery-full-ledger-reconciliation'];
const normalize = value => value.replace(/^\/api(?:\/v1)?(?=\/)/, '');
const identity = ({ id, job, index, role }) => ({ id, job, index, role });
const same = (actual, expected, label) => assert.deepEqual(actual, expected, label);

function verifyWorkforceParticipation(report, { requirePostgres = true } = {}) {
  const { metadata: meta, workforcePreparation: preparation } = report;
  assert(!report.executionError && !report.setupError, 'Workforce cannot accept an interrupted or failed execution');
  assert.equal(typeof requirePostgres, 'boolean');
  assert.equal(meta?.provider, requirePostgres ? 'postgresql' : 'sqlite', 'Final workforce cannot substitute the database provider');
  assert(typeof meta.runId === 'string' && meta.runId.trim());
  const prefix = `r2wf_${crypto.createHash('sha256').update(`${meta.runId}-workforce`).digest('hex').slice(0, 12)}`;
  assert.equal(preparation?.version, 'enterprise-round2-workforce-preparation/v1');
  const finalizedAfter = Date.parse(preparation.finalization?.startedAt);
  assert(Number.isFinite(finalizedAfter), 'Missing final current-profile collection window');
  const people = preparation.actors;
  assert.equal(people?.length, 20); assert.equal(new Set(people.map(p => p.id)).size, 20);
  for (const { job, count } of catalog.roles) {
    same(people.filter(p => p.job === job).map(p => p.index).sort((a, b) => a - b), Array.from({ length: count }, (_, i) => i + 1), `Missing ${job} duties`);
  }
  for (const person of people) {
    assert(Number.isSafeInteger(person.id) && person.id > 0);
    assert.equal(person.role, `${prefix}_${person.job}`, 'Actor belongs to another run or built-in role');
    verifyWorkforceProfile(person.profile, person);
    for (const instance of [0, 1]) {
      verifyWorkforceProfile(person.profilesByInstance?.[instance], person);
      const response = person.currentProfileResponsesByInstance?.[instance];
      assert.equal(response?.status, 200, 'Missing successful final /auth/me response');
      assert.equal(response.json?.success, true);
      same(person.currentProfilesByInstance?.[instance], response.json.data, 'Final profile is not the real response');
      verifyWorkforceProfile(response.json.data, person);
    }
  }
  const actor = (job, index = 1) => { const found = people.filter(p => p.job === job && p.index === index); assert.equal(found.length, 1); return found[0]; };
  const bind = (actual, job, index = 1) => {
    const person = actor(job, index); assert(actual, `Missing ${job}/${index} evidence`);
    assert.equal(actual.id ?? actual.actorId, person.id, `Foreign ${job}/${index} actor`);
    assert.equal(actual.role, person.role, `Foreign ${job}/${index} role`);
    return person;
  };
  const fixed = catalog.chains.flatMap(c => c.checks);
  same(report.checks.map(c => c.id).sort(), [...fixed].sort(), 'Original 37 obligations changed');
  const preceding = report.checks.filter(c => c.id !== 'workforce-rbac' && (requirePostgres || !pgIds.includes(c.id)));
  assert.equal(preceding.length, requirePostgres ? 36 : 34);
  for (const check of preceding) {
    assert.equal(check.status, 'passed', `Same-run prerequisite not passed: ${check.id}`);
    assert(check.evidence && Object.keys(check.evidence).length, `Missing ${check.id} raw evidence`);
    assert(Number.isFinite(Date.parse(check.startedAt)) && Number.isFinite(Date.parse(check.finishedAt)), `Missing ${check.id} execution window`);
    assert(Date.parse(check.startedAt) >= Date.parse(report.startedAt) && Date.parse(check.finishedAt) >= Date.parse(check.startedAt)
      && Date.parse(check.finishedAt) <= finalizedAfter, 'Current identity collection must follow the business chains');
  }
  if (!requirePostgres) for (const id of pgIds) assert.equal(report.checks.find(c => c.id === id).status, 'not_run', 'SQLite cannot claim PostgreSQL recovery');
  const evidence = id => report.checks.find(c => c.id === id).evidence;
  const chains = [], participating = new Set();
  const chain = (id, members, resources) => {
    assert(resources && Object.keys(resources).length);
    const actors = [...new Set(members.map(p => p.id))].sort((a, b) => a - b);
    actors.forEach(id => participating.add(id));
    chains.push({ id, actors, resources });
  };
  const created = (row, person, label) => { assert(row && Number.isSafeInteger(Number(row.id)) && Number(row.id) > 0, `Missing ${label}`); assert.equal(row.createdBy, person.id, `${label} actual creator`); };
  const actions = preparation.actions;
  assert(Array.isArray(actions) && actions.length > 0);
  for (const action of actions) {
    const person = people.find(p => p.id === action.actorId); assert(person, 'Global capture contains foreign workforce actor');
    assert.equal(action.role, person.role); assert([0, 1].includes(action.instance));
  }
  const success = (list, person, method, path, resourceId) => {
    const found = list.filter(a => a.actorId === person.id && a.role === person.role && a.method === method
      && normalize(a.path) === path && [200, 201].includes(a.status));
    assert(found.length > 0, `Missing actual ${person.job} ${method} ${path}`);
    if (resourceId !== undefined) assert(found.some(a => Number(a.json?.data?.id) === Number(resourceId)), 'Successful request not bound to persisted resource');
    return found;
  };

  // R2-01/02 share one sales order and its real fifty-unit procurement receipt.
  const sales = evidence('sales-reservation-partial-fulfillment');
  assert.equal(sales.runId, meta.runId);
  same(sales.workforce.actors.map(identity), people.map(identity), 'Sales introduced another cohort');
  require('./enterprise-round2-sales-proof.cjs').verifySharedSalesChain(sales, meta.provider);
  same(evidence('sales-browser-readback'), require('./enterprise-round2-sales-proof.cjs').verifySharedSalesBrowser(sales, meta.provider));
  const m = sales.manifest;
  chain('R2-01', [actor('sales'), actor('sales_lead'), actor('warehouse'), actor('receivables')],
    { orderId: m.orderId, planId: m.planId, shipmentIds: m.shipmentIds, paymentId: m.paymentRecordId });
  chain('R2-02', [actor('buyer'), actor('buyer', 2), actor('warehouse'), actor('qc'), actor('qa'), actor('payables'), actor('owner')],
    { purchaseOrderId: m.purchaseOrderId, receiptId: m.purchaseReceiptId, checkId: m.qualityCheckId, supplierPaymentId: m.supplierPaymentId });

  const po = evidence('po-reapproval-browser'), buyers = [actor('buyer'), actor('buyer', 2)];
  assert.equal(po.workforce?.version, 'purchase-revision-workforce/v1');
  assert.equal(po.workforce.actors.length, 2);
  po.workforce.actors.forEach((a, i) => { bind(a, 'buyer', i + 1); verifyWorkforceProfile(a.browserProfile, buyers[i]); });
  require('./enterprise-round2-procurement.cjs').verifyWorkforceRevisionWrites(Number(po.orderId), buyers, po.workforce.browserWrites, po.workforce.databaseAudits);
  assert.equal(Number(po.persisted.id), Number(po.orderId)); assert.equal(po.persisted.status, 'approved'); assert.equal(po.persisted.revision, 3);
  chain('R2-03', buyers, { purchaseOrderId: Number(po.orderId), auditIds: po.workforce.databaseAudits.map(a => a.id) });

  const research = actor('research'), planner = actor('production_planner'), operator = actor('production_operator');
  const qc = actor('qc'), qa = actor('qa'), cost = actor('cost_accountant');
  const productionActors = (e, { operators = false } = {}) => {
    bind(e.productionActors?.research, 'research'); bind(e.productionActors?.planner, 'production_planner');
    if (operators) { assert.equal(e.productionActors.operators.length, 2); e.productionActors.operators.forEach((a, i) => bind(a, 'production_operator', i + 1)); }
    else bind(e.productionActors.operator, 'production_operator');
    bind(e.productionActors.qc, 'qc'); bind(e.productionActors.qa, 'qa');
  };
  const inspection = row => { assert.equal(row.inspectorUserId, qc.id); assert.equal(row.reviewedByUserId, qa.id); };
  const bom = evidence('bom-revision-freeze'), h = bom.history;
  productionActors(bom);
  for (const row of [h.v1, h.v2, h.oldDefinition]) created(row, research, 'BOM');
  for (const row of [h.old, h.newer, h.persisted]) created(row, planner, 'Frozen work order');
  assert.equal(h.persisted.bomId, h.v1.id); assert.equal(h.newer.bomId, h.v2.id); assert.notEqual(h.v1.id, h.v2.id);
  assert.equal(h.persisted.status, 'completed'); inspection(h.persisted.qualityChecks.find(q => q.id === h.oldQc.id));
  assert(h.costs.length >= 2); h.costs.forEach(row => { assert.equal(row.createdBy, operator.id); assert.equal(row.workOrderId, h.old.id); });
  success(bom.roleActions, operator, 'PATCH', `/production/work-orders/${h.old.id}/status`, h.old.id);
  chain('R2-04', [research, planner, operator, qc, qa], { bomIds: [h.v1.id, h.v2.id], workOrderIds: [h.old.id, h.newer.id], batchId: h.persisted.batchId });

  const lot = evidence('dual-workorder-same-lot'); productionActors(lot, { operators: true }); bind(lot.productionActors.warehouse, 'warehouse', 2);
  assert.equal(lot.cases.length, 3); same(lot.violations, []);
  for (const c of lot.cases) {
    assert.equal(c.final.workOrders.length, 2);
    for (const [i, row] of c.final.workOrders.entries()) {
      created(row, planner, 'Competing work order');
      const actualOperator = actor('production_operator', i + 1);
      assert(c.final.statusAudits.some(a => a.userId === actualOperator.id && a.resourceId === row.id && a.action === 'UPDATE_PRODUCTION_WORK_ORDER_STATUS'), 'Missing actual operator status audit');
      success(lot.roleActions, actualOperator, 'PATCH', `/production/work-orders/${row.id}/status`, row.id);
    }
  }
  bind(evidence('genealogy-readback').productionActor, 'production_operator', 2);
  chain('R2-05', [research, planner, operator, actor('production_operator', 2), qc, qa, actor('warehouse', 2)],
    { workOrderIds: lot.cases.flatMap(c => c.final.workOrders.map(w => w.id)), batchIds: lot.cases.map(c => c.final.rawBatch.id) });

  const density = evidence('mass-packaging-density-conversion'); productionActors(density);
  const d = density.case; created(d.bom, research, 'Density BOM'); created(d.after.wo, planner, 'Density work order');
  assert(d.after.audits.length > 0); d.after.audits.forEach(a => assert.equal(a.userId, operator.id));
  same(evidence('conversion-cost-conservation'), require('./enterprise-round2-density-conversion.cjs').assertDensityCostConservation(density));
  chain('R2-06', [research, planner, operator, qc, qa], { bomId: d.bom.id, workOrderId: d.after.wo.id, densityRevisionId: d.approved.id });

  const disposition = evidence('loss-return-scrap-rework'); productionActors(disposition, { operators: true }); bind(disposition.productionActors.cost, 'cost_accountant');
  same(evidence('production-cost-reconciliation'), require('./enterprise-round2-production-disposition.cjs').assertProductionDispositionCostReconciliation(disposition));
  const dc = disposition.case;
  for (const row of [dc.afterScrap.disposition, dc.afterRework.reworkDisposition, disposition.browser.after.dispositions.at(-1)]) created(row, operator, 'Production disposition');
  assert.equal(disposition.browser.actorId, operator.id);
  assert.equal(disposition.costReadbacks.length, 4);
  for (const read of disposition.costReadbacks) { assert.equal(read.actorId, cost.id); assert.equal(read.status, 200); assert(read.rawRows.length > 0); }
  chain('R2-07', [operator, cost], { workOrderId: dc.workOrder.id, batchIds: [dc.outputBatch.id, dc.afterRework.reworkBatch.id] });

  const stock = evidence('stock-20-contention');
  same(stock.workforce.people.map(identity), people.map(identity)); same(stock.workforce.appUrls, meta.appUrls);
  require('./enterprise-round2-stock-workforce.cjs').verifyStockWorkforce(stock.workforce, stock);
  require('./enterprise-round2-inventory-browser.cjs').verifyInventoryBrowser(evidence('stock-contention-browser'), stock);
  chain('R2-08', [actor('warehouse'), actor('warehouse', 2), cost], { batchId: stock.state.batch.id, pressureActorIds: stock.responses.map(r => r.actorId), entryIds: stock.state.entries.map(r => r.id) });

  const transfer = evidence('transfer-shipping-contention'), shipper = actor('warehouse', 3), mover = actor('warehouse', 2), secondSales = actor('sales', 2);
  created(transfer.persisted, shipper, 'Competing shipment'); assert.equal(transfer.persisted.id, transfer.shipmentId);
  same(transfer.responses.map(r => [r.operation, r.actorId]), [['transfer', mover.id], ['shipping', shipper.id]]);
  assert.equal(transfer.responses.filter(r => [200, 201].includes(r.status)).length, 1);
  const winner = transfer.responses.find(r => [200, 201].includes(r.status));
  const posted = transfer.state.entries.filter(r => r.sourceType !== 'warehouse_manual_inbound'); assert.equal(posted.length, 1); assert.equal(posted[0].createdBy, winner.actorId);
  const customers = success(actions, secondSales, 'POST', '/customers', transfer.persisted.customerId);
  const customer = preparation.operations.denial.before.customer.find(r => r.id === transfer.persisted.customerId);
  assert(customer); assert.equal(customer.salespersonId, secondSales.id);
  assert(customers.some(r => Number(r.json.data.salespersonId) === secondSales.id));
  require('./enterprise-round2-inventory-browser.cjs').verifyInventoryBrowser(evidence('transfer-shipping-browser'), transfer);
  chain('R2-09', [mover, shipper, secondSales], { shipmentId: transfer.shipmentId, customerId: customer.id, entryId: posted[0].id });

  const payment = evidence('payment-submit-durable-replay'), ar = actor('receivables'), ap = actor('payables'), owner = actor('owner'), thirdSales = actor('sales', 3);
  same(payment.workforce.cohort.map(identity), people.map(identity));
  bind(payment.workforce.actors.sales, 'sales', 3); bind(payment.workforce.actors.requester, 'receivables'); bind(payment.workforce.actors.reviewer, 'owner');
  require('./payment-submission-proof.cjs').verifyPaymentSubmissionProof(payment, meta.provider);
  const event = evidence('payment-event-audit-once'); bind(event.workforceObserver, 'receivables');
  require('./payment-event-proof.cjs').verifyPaymentEventProof(event, meta.provider);
  const reversal = evidence('payment-reversal-browser'), rw = reversal.browser.workforce;
  const withAccount = a => ({ ...a, account: { username: a.profile.username, role: a.role, segment: a.profile.segment } });
  same(reversal.workforceProof, require('./payment-reversal-browser-proof.cjs').verifyPaymentReversalWorkforceProof(rw,
    { people: { sales: withAccount(thirdSales), requester: withAccount(ar), reviewer: withAccount(owner) }, payables: withAccount(ap), bootstrapId: rw.adjustmentActorId }));
  assert(!people.some(p => p.id === rw.adjustmentActorId), 'Legacy reversal adjustment remains an independent control');
  const barter = evidence('barter-partial-fulfillment'), negative = evidence('barter-negative-cash-adjustment');
  for (const e of [barter, negative]) {
    for (const [duty, job, index] of [['sales', 'sales', 3], ['approver', 'owner', 1], ['poster', 'receivables', 1], ['reverser', 'payables', 1]]) bind(e.barterActors?.[duty], job, index);
    require('./enterprise-round2-barter-actor-proof.cjs').assertBarterDutyEvidence(e);
  }
  same(evidence('barter-browser-readback'), require('./enterprise-round2-barter-partial.cjs').assertBarterBrowserChain(barter));
  chain('R2-10', [thirdSales, ar, ap, owner], { orderId: payment.orderId, paymentIds: payment.finalSnapshot.payments.map(p => p.id), reversalId: reversal.workforceProof.reversalId, agreementId: barter.agreementId });

  const isolation = evidence('qc-quarantine-blocks-issue');
  bind(isolation.productionActors?.author, 'research'); bind(isolation.productionActors.planner, 'production_planner');
  bind(isolation.productionActors.operator, 'production_operator'); bind(isolation.productionActors.inspector, 'qc'); bind(isolation.productionActors.reviewer, 'qa');
  const quality = require('./enterprise-round2-qc-isolation.cjs'); quality.verifyQcSelfReviews(isolation); isolation.cases.forEach(quality.assertQcIsolationCase);
  const release = evidence('qa-release-traceability-browser');
  bind(release.productionActors?.inspector, 'qc'); bind(release.productionActors.reviewer, 'qa'); bind(release.productionActors.operator, 'production_operator');
  chain('R2-11', [research, planner, operator, qc, qa], { checkIds: isolation.cases.map(c => c.qc.id), batchIds: isolation.cases.map(c => c.batchId) });

  // The administrator reads actual supplier-payment audit and backup catalog;
  // this is not a fabricated backup restore or another business-write grant.
  const ops = preparation.operations, admin = bind(ops, 'system_admin');
  same(ops.nodes.map(r => r.instance), [0, 1]);
  for (const node of ops.nodes) {
    for (const response of [node.status, node.backups, node.audit]) { assert.equal(response.status, 200); assert.equal(response.json.success, true); }
    assert(Array.isArray(node.backups.json.data));
    assert.equal(node.auditPath, `/audit?userId=${owner.id}&page=1&pageSize=100`);
    assert(node.audit.json.data.some(a => a.userId === owner.id && a.resource === 'supplier_payment' && a.resourceId === m.supplierPaymentId));
  }
  const denial = ops.denial;
  assert.equal(denial.actorId, admin.id); assert.equal(denial.instance, 1); assert.equal(denial.path, '/orders'); assert.equal(denial.method, 'POST');
  assert.equal(denial.profileStatus, 200); verifyWorkforceProfile(denial.profile, admin);
  assert.equal(denial.status, 403); assert.equal(denial.json.success, false); same(denial.json.requiredPermissions, ['orders.create']);
  same(Object.keys(denial.before).sort(), ['auditLog', 'customer', 'order', 'orderItem']);
  same(denial.after, denial.before, 'Administrator denial changed business facts');
  const original = sales.actions.filter(a => a.method === 'POST' && a.path === '/orders' && a.status === 201); assert.equal(original.length, 1);
  same(denial.positiveControl, original[0]); same(denial.sent, original[0].sent);
  created(denial.before.order.find(o => o.id === m.orderId), actor('sales'), 'Admin positive-control order');
  assert(denial.before.orderItem.some(i => i.orderId === m.orderId));
  assert.equal(denial.before.auditLog.filter(a => a.resourceId === m.orderId && a.userId === actor('sales').id && a.action === 'CREATE').length, 1);
  participating.add(admin.id);

  if (requirePostgres) {
    const pg = evidence(pgIds[0]), verifier = require('./enterprise-round2-postgres-recovery-proof.cjs');
    assert.equal(pg.workforceActors?.version, 'postgres-recovery-workforce-actors/v1', 'Recovery must use the same real cohort');
    for (const [duty, job, index] of [['warehouse', 'warehouse', 3], ['sales', 'sales', 3], ['approver', 'sales_lead', 1], ['receivables', 'receivables', 1]]) bind(pg.workforceActors.actors[duty], job, index);
    const options = { runId: meta.runId, priorChecks: report.checks };
    verifier.verifyPostgresRecoveryProof(pg, options); same(evidence(pgIds[1]), verifier.verifyPostgresLedgerRecovery(pg, options));
    chain('R2-12', [shipper, thirdSales, actor('sales_lead'), ar], { orderId: pg.manifest.orderId, paymentId: pg.manifest.paymentId, shipmentIds: pg.manifest.shipmentIds });
  }
  same(chains.map(c => c.id), catalog.chains.slice(0, requirePostgres ? 12 : 11).map(c => c.id));
  same([...participating].sort((a, b) => a - b), people.map(p => p.id).sort((a, b) => a - b), 'A configured identity did not perform a proven business duty');
  return { version: 'enterprise-round2-workforce-proof/v1', runId: meta.runId, provider: meta.provider,
    businessParticipationAccepted: requirePostgres, people: people.map(identity), chains,
    administrator: { actorId: admin.id, supplierPaymentId: m.supplierPaymentId, readNodes: 2, deniedBusinessEffects: 0 },
    priorChecks: preceding.map(c => ({ id: c.id, evidenceSha256: hash(c.evidence) })),
    currentProfilesSha256: hash(people.map(p => p.currentProfileResponsesByInstance)),
    pressureActorsAreSeparate: true, remainingChains: requirePostgres ? [] : ['R2-12'] };
}

module.exports = { verifyWorkforceParticipation };
