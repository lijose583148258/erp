const assert = require('node:assert/strict');
const requiredChecks = ['mobileDialogFits', 'draftNoStockOrMoney', 'browserDoubleClickExactlyOnce', 'createReplayNoDuplicate',
  'approvalNoStockOrMoney', 'closeNoStockOrMoney', 'closeReplayNoDuplicate', 'bothInstancesClosed', 'exactlyThreePlanAudits',
  'physicalInventoryNonnegative', 'zeroInventoryCostRemainder', 'concurrentSourceCapacity'];
const requiredRejections = ['unsupported substitution option', 'wrong order line', 'missing purchase source', 'sales peer read scope', 'sales peer write scope',
  'changed idempotency facts', 'sales approval permission', 'immutable order line', 'admin self approval', 'purchase revision frozen',
  'duplicate approval', 'purchase capacity overcommit', 'early closeout', 'in-transit is not customer acceptance', 'changed close reason'];
function verifySalesPlanProof(r) {
  assert.equal(r.status, 'passed');
  for (const name of ['sales-plan-mobile-draft.png', 'sales-plan-independent-approval.png', 'sales-plan-closed-readback.png']) {
    const evidence = r.screenshots?.find(s => s.name === name); assert(evidence?.loadingHidden && evidence.unobscured, `Missing unobscured visual evidence: ${name}`);
  }
  for (const key of requiredChecks) assert.equal(r.checks?.[key], true, `Missing sales plan check ${key}`);
  for (const name of requiredRejections) { const rows = r.rejections?.filter(row => row.name === name); assert.equal(rows?.length, 1, name); assert.equal(rows[0].unchanged, true); assert([400, 403, 404, 409].includes(rows[0].status)); }
  assert.equal(r.browserCreate?.httpStatus, 201); assert.equal(r.browserCreate.injectedReadbacks, 1); assert.equal(r.browserCreate.getOnlyRecovery, true);
  const id = r.browserCreate.planId;
  assert.equal(r.browserApproval?.planId, id); assert.equal(r.browserApproval.status, 200);
  assert.equal(r.browserClose?.planId, id); assert.equal(r.browserClose.status, 200);
  const plan = r.finalState.plans.find(p => p.id === id); assert(plan); assert.equal(plan.status, 'closed');
  assert.notEqual(plan.createdBy, plan.approvedBy); assert.equal(plan.approvedBy, r.browserApproval.actor);
  const closed = JSON.parse(plan.closeoutSnapshot);
  assert.equal(closed.stockChanged, false); assert.equal(closed.moneyChanged, false);
  assert(closed.committedQuantity > 0 && closed.receivedQuantity >= closed.committedQuantity && closed.deliveredFromSource >= closed.committedQuantity);
  for (const key of ['purchaseReceiptIds', 'shipmentIds', 'shipmentReceiptIds']) assert(closed[key]?.length > 0, `Missing closeout ${key}`);
  assert.equal(r.finalReadbacks?.length, 2);
  for (const response of r.finalReadbacks) {
    assert.equal(response.scope, 'linked_purchase_only'); assert.equal(response.physicalStockReserved, false); assert.equal(response.confirmationGateEnforced, false);
    const readback = response.plans.find(p => p.id === id); assert.equal(readback?.status, 'closed'); assert.deepEqual(readback.closeoutSnapshot, closed);
    assert.equal(response.fulfillment.fullyDelivered, true);
  }
  const audits = r.finalState.audits.filter(a => a.resourceId === id);
  assert.deepEqual(audits.map(a => a.action).sort(), ['APPROVE_SALES_FULFILLMENT_PLAN', 'CLOSE_SALES_FULFILLMENT_PLAN', 'CREATE_SALES_FULFILLMENT_PLAN']);
  assert.deepEqual(r.finalState.business, r.beforeClose);
  assert.equal(r.beforePlan.balances.length, 0); assert.equal(r.beforePlan.ledger.length, 0);
  const { balances, ledger, payments, order } = r.finalState.business;
  assert(balances.length > 0 && balances.every(b => b.quantity >= 0)); assert.equal(balances.reduce((n, b) => n + b.quantity, 0), 0);
  assert(ledger.length >= 2); assert.equal(ledger.reduce((n, l) => n + l.quantityDelta, 0), 0); assert.equal(ledger.reduce((n, l) => n + l.costAmountDelta, 0), 0);
  assert.deepEqual(payments, r.beforePlan.payments); assert.equal(order.paidAmount, r.beforePlan.order.paidAmount);
  const race = r.concurrency; assert.equal(race.results.length, 2); assert.deepEqual(race.results.map(row => row.status).sort(), [200, 409]);
  assert.equal(race.audits.length, 1); assert.equal(race.readbacks.length, 2);
  for (const readback of race.readbacks) assert.equal(readback.plans.filter(p => p.status === 'approved').reduce((n, p) => n + p.plannedQuantity, 0), race.sourceQuantity);
  return { planId: id, scope: 'linked_purchase_only', rejections: requiredRejections.length };
}
module.exports = { verifySalesPlanProof, requiredChecks, requiredRejections };
