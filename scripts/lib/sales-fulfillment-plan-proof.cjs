const assert = require('node:assert/strict');
const requiredChecks = ['mobileDialogFits', 'draftNoStockOrMoney', 'browserDoubleClickExactlyOnce', 'createReplayNoDuplicate',
  'approvalNoStockOrMoney', 'closeNoStockOrMoney', 'closeReplayNoDuplicate', 'bothInstancesClosed', 'exactlyThreePlanAudits',
  'physicalInventoryNonnegative', 'zeroInventoryCostRemainder', 'concurrentSourceCapacity', 'presaleExistingThenPurchased150'];
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
  verifyPresaleProof(r);
  return { planId: id, scope: 'linked_purchase_only', rejections: requiredRejections.length };
}
function verifyPresaleProof(r) {
  const p = r.presale; assert(p, 'Missing mixed existing-stock/purchase presale chain');
  const sum = (rows, key) => rows.reduce((n, row) => n + row[key], 0);
  for (const snapshot of [p.original, p.partial, p.beforeShortage, p.afterShortage, p.final]) {
    assert.equal(snapshot.order.id, p.orderId); assert.equal(snapshot.order.finalAmount, 1500); assert.equal(snapshot.order.paidAmount, 0);
    assert.equal(snapshot.order.items.length, 1); assert.equal(snapshot.order.items[0].id, p.orderItemId);
    assert.equal(snapshot.order.items[0].materialId, p.materialId); assert.equal(snapshot.order.items[0].quantity, 150);
    assert.equal(snapshot.order.items[0].unit, 'kg'); assert.equal(snapshot.payments.length, 0);
    assert(snapshot.balances.length > 0 && snapshot.balances.every(b => b.materialId === p.materialId && b.quantity >= 0));
  }
  assert.equal(sum(p.original.balances, 'quantity'), 100); assert.equal(sum(p.original.ledger, 'costAmountDelta'), 1000);
  assert.equal(sum(p.partial.balances, 'quantity'), 0); assert.equal(p.partial.order.shipments.length, 1);
  assert.equal(sum(p.partial.order.shipments[0].receipts, 'acceptedQuantity'), 100);
  assert.equal(p.shortageResponse.status, 409); assert.deepEqual(p.beforeShortage, p.afterShortage);
  assert.equal(p.beforeShortage.order.shipments.length, 2); assert.equal(p.beforeShortage.order.shipments[1].status, 'pending');
  assert.equal(p.partialReadbacks.length, 2); assert.equal(p.finalReadbacks.length, 2);
  for (const [responses, remaining] of [[p.partialReadbacks, 50], [p.finalReadbacks, 0]]) for (const order of responses) {
    assert.equal(Number(order.id), p.orderId); assert.equal(Number(order.finalAmount), 1500); assert.equal(Number(order.paidAmount), 0);
    assert.equal(order.fulfillment.lines.length, 1); assert.equal(order.fulfillment.lines[0].orderItemId, p.orderItemId);
    assert.equal(order.fulfillment.lines[0].outstandingQuantity, remaining); assert.equal(order.fulfillment.fullyDelivered, remaining === 0);
  }
  const shipments = p.final.order.shipments; assert.deepEqual(shipments.map(s => s.quantity), [100, 50]);
  assert.deepEqual(shipments.map(s => s.id), p.beforeShortage.order.shipments.map(s => s.id), 'Replenishment must reuse original pending shipment');
  assert.deepEqual(shipments.map(s => s.batchNo), [p.existingBatch, p.replenishmentBatch]);
  for (const shipment of shipments) {
    assert.equal(shipment.status, 'delivered'); assert.equal(shipment.orderItemId, p.orderItemId); assert.equal(shipment.materialId, p.materialId);
    assert.equal(sum(shipment.receipts, 'acceptedQuantity'), shipment.quantity); assert.equal(sum(shipment.receipts, 'rejectedQuantity'), 0);
    const issues = p.final.entries.filter(e => e.sourceType === 'shipping_issue' && e.sourceRef === shipment.shipmentNo);
    assert.equal(issues.length, 1); assert.equal(issues[0].movements.length, 1); assert.equal(issues[0].movements[0].quantityDelta, -shipment.quantity);
    assert.equal(issues[0].movements[0].batchNo, shipment.batchNo);
  }
  assert.equal(sum(p.final.balances, 'quantity'), 0); assert.equal(p.final.batches.length, 2);
  for (const batch of p.final.batches) {
    assert.equal(batch.materialId, p.materialId); assert.equal(batch.stockQuantity, 0);
    const ledger = p.final.ledger.filter(l => l.batchId === batch.id); assert(ledger.length >= 2);
    assert.equal(sum(ledger, 'quantityDelta'), 0); assert.equal(sum(ledger, 'costAmountDelta'), 0);
    const quantity = batch.batchNo === p.existingBatch ? 100 : 50;
    assert.equal(sum(ledger.filter(l => l.quantityDelta < 0), 'quantityDelta'), -quantity);
    assert.equal(sum(ledger.filter(l => l.quantityDelta < 0), 'costAmountDelta'), -quantity * 10);
  }
  assert.equal(p.purchase.salesOrderId, p.orderId); assert.equal(p.purchase.materialId, p.materialId); assert.equal(p.purchase.quantity, 50);
  assert.equal(p.purchase.receipts.length, 1); assert.equal(p.purchase.receipts[0].batchNo, p.replenishmentBatch); assert.equal(p.purchase.receipts[0].acceptedQuantity, 50);
  assert.equal(p.plan.orderId, p.orderId); assert.equal(p.plan.orderItemId, p.orderItemId); assert.equal(p.plan.sourceDocumentId, p.purchase.id);
  assert.equal(p.plan.status, 'closed'); assert.equal(p.plan.plannedQuantity, 50); assert.notEqual(p.plan.createdBy, p.plan.approvedBy);
  const closeout = JSON.parse(p.plan.closeoutSnapshot);
  for (const key of ['committedQuantity', 'receivedQuantity', 'deliveredFromSource']) assert.equal(closeout[key], 50);
  assert.deepEqual(closeout.purchaseReceiptIds, p.purchase.receipts.map(row => row.id)); assert.deepEqual(closeout.shipmentIds, [shipments[1].id]);
  assert.deepEqual(p.planAudits.map(a => a.action).sort(), ['APPROVE_SALES_FULFILLMENT_PLAN', 'CLOSE_SALES_FULFILLMENT_PLAN', 'CREATE_SALES_FULFILLMENT_PLAN']);
  assert(p.planAudits.every(a => a.resourceId === p.plan.id)); assert.equal(p.planReadbacks.length, 2);
  for (const response of p.planReadbacks) { const plan = response.plans.find(row => row.id === p.plan.id); assert.equal(plan?.status, 'closed'); assert.deepEqual(plan.closeoutSnapshot, closeout); }
  assert.match(p.partialBrowserText, /待交 50 kg/); assert.match(p.finalBrowserText, /已交付/); assert(!p.finalBrowserText.includes('待交'));
  for (const name of ['sales-presale-partial-100-of-150.png', 'sales-presale-complete-150-of-150.png']) {
    const shot = r.screenshots?.find(s => s.name === name); assert(shot?.loadingHidden && shot.unobscured, `Missing presale visual proof: ${name}`);
  }
  return { orderId: p.orderId, ordered: 150, existingStockDelivered: 100, purchasedDelivered: 50, fullWorkforceAccepted: false, reservationAccepted: false };
}
module.exports = { verifySalesPlanProof, verifyPresaleProof, requiredChecks, requiredRejections };
