const assert = require('node:assert/strict');

// These are explicitly declared isolated business fixtures, never production
// defaults or automatic facts injected into a generic HTTP request function.
function explicitPurchaseSources({ quoteRef, specificationRef, specificationRevision, taxTreatment,
  supplierTaxAmount, supplierChargesAmount, characteristics }) {
  assert.equal(typeof quoteRef, 'string'); assert(quoteRef.length >= 3);
  assert.equal(typeof specificationRef, 'string'); assert(specificationRef.length >= 3);
  assert.equal(typeof specificationRevision, 'string'); assert(specificationRevision.length > 0);
  assert(['none_or_third_party', 'included_in_price', 'additional_supplier_tax'].includes(taxTreatment));
  assert(Number.isFinite(supplierTaxAmount) && supplierTaxAmount >= 0);
  assert(Number.isFinite(supplierChargesAmount) && supplierChargesAmount >= 0);
  assert(Array.isArray(characteristics) && characteristics.length > 0 && characteristics.some(c => c.required));
  for (const item of characteristics) assert(item.code && item.name && item.testMethod && ['numeric', 'text'].includes(item.valueType));
  return { supplierPayableTerms: { taxTreatment, supplierTaxAmount, supplierChargesAmount, evidenceRef: quoteRef },
    incomingQualityPlan: { specificationRef, specificationRevision, characteristics: JSON.parse(JSON.stringify(characteristics)) } };
}

async function createApprovedPurchaseFixture({ request, dataOf, signal }, { payload, sources, buyer, approver, instance = 0 }) {
  assert(buyer?.id && approver?.id && buyer.id !== approver.id, 'A purchase source author cannot approve their own fixture');
  assert(sources?.supplierPayableTerms && sources?.incomingQualityPlan, 'Explicit quote and specification fixtures are required');
  assert(!payload.status || payload.status === 'pending', 'An isolated fixture must follow draft creation and independent approval');
  const creationRequest = { ...payload, ...sources, status: 'pending' };
  const creationResponse = await request('/procurement/orders', { actor: buyer, instance, method: 'POST', signal, data: creationRequest });
  const created = dataOf(creationResponse);
  assert.equal(created.status, 'pending');
  const approvalRequest = { status: 'approved', expectedRevision: created.revision };
  const approvalResponse = await request(`/procurement/orders/${created.id}/status`, { actor: approver, instance: 1 - instance,
    method: 'PATCH', signal, data: approvalRequest });
  const approved = dataOf(approvalResponse);
  assert.equal(approved.status, 'approved'); assert.equal(approved.revision, created.revision);
  return { created, approved, creationRequest, creationResponse, approvalRequest, approvalResponse,
    buyerId: buyer.id, approverId: approver.id };
}

async function releasePurchaseFixture({ request, dataOf, signal }, { receiptId, qcActor, qaActor, key, input, reason }) {
  assert(qcActor?.id && qaActor?.id && qcActor.id !== qaActor.id, 'QC and QA fixture actors must be different people');
  assert(typeof key === 'string' && key.length >= 8);
  assert(input?.sampleNo && Array.isArray(input.measurements) && input.measurements.length > 0);
  assert(typeof reason === 'string' && reason.trim().length >= 3);
  const inspectionResponse = await request(`/procurement/receipts/${receiptId}/quality-checks`, { actor: qcActor, method: 'POST', signal,
    headers: { 'Idempotency-Key': key }, data: input });
  const inspection = dataOf(inspectionResponse).submission.inspection;
  assert.equal(inspection.result, 'pass', 'Seeded measurements must actually pass server evaluation before QA release');
  const reviewRequest = { expectedRevision: inspection.revision, decision: 'released', reason };
  const reviewResponse = await request(`/procurement/quality-checks/${inspection.id}/review`, { actor: qaActor, instance: 1,
    method: 'POST', signal, data: reviewRequest });
  const review = dataOf(reviewResponse);
  const readback = dataOf(await request(`/procurement/receipts/${receiptId}/quality`, { actor: qaActor, instance: 0, signal }));
  assert.equal(review.review.decision, 'released'); assert.equal(readback.receipt.qualityStatus, 'released');
  assert.equal(readback.qualityChecks[0].id, inspection.id);
  return { receiptId, qcActorId: qcActor.id, qaActorId: qaActor.id, key, input, inspectionResponse, reviewRequest, reviewResponse, readback };
}

async function fillPurchaseSourceFields(page, sources) {
  const terms = sources.supplierPayableTerms, plan = sources.incomingQualityPlan;
  assert.equal(plan.characteristics.length, 1, 'This narrow browser fixture explicitly declares one required characteristic');
  await page.getByTestId('purchase-source-tax-treatment').selectOption(terms.taxTreatment);
  for (const [id, value] of [['evidence', terms.evidenceRef], ['supplier-tax', terms.supplierTaxAmount], ['supplier-charges', terms.supplierChargesAmount],
    ['specification', plan.specificationRef], ['specification-revision', plan.specificationRevision]]) {
    await page.getByTestId(`purchase-source-${id}`).fill(String(value));
  }
  if (await page.getByTestId('purchase-source-code-0').count() === 0) await page.getByTestId('purchase-source-add-characteristic').click();
  const characteristic = plan.characteristics[0];
  await page.getByTestId('purchase-source-type-0').selectOption(characteristic.valueType);
  for (const [id, value] of [['code', characteristic.code], ['name', characteristic.name], ['unit', characteristic.unit],
    ['method', characteristic.testMethod], ...(characteristic.valueType === 'numeric'
      ? [['lower', characteristic.lowerLimit], ['upper', characteristic.upperLimit]] : [['target', characteristic.targetText]])]) {
    await page.getByTestId(`purchase-source-${id}-0`).fill(value == null ? '' : String(value));
  }
}

module.exports = { explicitPurchaseSources, createApprovedPurchaseFixture, releasePurchaseFixture, fillPurchaseSourceFields };
