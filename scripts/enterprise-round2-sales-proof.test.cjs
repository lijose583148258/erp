const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifySharedSalesChain, verifySharedSalesBrowser, verifySharedSalesImages } = require('./lib/enterprise-round2-sales-proof.cjs');
const { sharedSalesProofFixture, refreshSharedSalesDigest } = require('./fixtures/shared-sales-proof-fixture.cjs');

test('shared150 proof is typed, dual-node and explicitly not whole workforce acceptance', () => {
  for (const provider of ['sqlite', 'postgresql']) {
    const e = sharedSalesProofFixture(provider), chain = verifySharedSalesChain(e, provider), browser = verifySharedSalesBrowser(e, provider);
    assert.equal(chain.acceptedQuantity, 150); assert.equal(chain.amount, '1500.00'); assert.equal(chain.fullWorkforceAccepted, false);
    for (const key of ['runId', 'chainDigest', 'manifestDigest']) assert.equal(browser[key], chain[key]);
    assert.equal(browser.sourceChainDigest, chain.chainDigest); assert.deepEqual(browser.manifest, chain.manifest);
    // Offline cloud proof must NOT depend on the producer's Linux filesystem.
    assert.equal(chain.status, 'passed');
  }
});

const mutations = {
  'actor substitution': e => { e.actions[0].actorId = e.workforce.actors[0].id; },
  'original order changed': e => { e.final.order.id++; },
  'original line quantity lowered': e => { e.final.order.items[0].quantity = 100; },
  'unverified AR': e => { e.final.order.paymentRecords[0].status = 'pending'; },
  'missing immutable AR event': e => { e.final.audits = e.final.audits.filter(a => a.action !== 'PAYMENT_VERIFIED'); },
  'duplicate immutable AR event': e => { e.final.audits.push({ ...e.final.audits.find(a => a.action === 'PAYMENT_VERIFIED'), id: 9999 }); },
  'AR event links a different order': e => { const a = e.final.audits.find(a => a.action === 'PAYMENT_VERIFIED'); a.details = JSON.stringify({ ...JSON.parse(a.details), orderId: 9999 }); },
  'missing genuine incomplete PO': e => { delete e.purchaseDraft; },
  'fabricated source in incomplete PO': e => { e.purchaseDraft.supplierPayableBasisJson = '{}'; },
  'missing late-source approval refusal': e => { e.denials = e.denials.filter(d => !d.name.startsWith('late quote/')); },
  'order amount lowered': e => { e.final.order.finalAmount = 1000; },
  'payment cents concealed by rounding': e => { e.final.order.paidAmount = 1500.001; },
  'quantity precision concealed by rounding': e => { e.final.shipments[0].quantity = 100.0000001; },
  'different receipt ID': e => { e.final.purchase.receipts[0].id++; },
  'different linked source': e => { e.final.purchase.salesOrderId++; },
  'second shipment replaced': e => { e.final.shipments[1].id++; },
  'warehouse given full order permission': e => { e.workforce.actors.find(a => a.job === 'warehouse').profile.permissions.push('orders.read'); },
  'warehouse profile node drift': e => { e.workforce.actors.find(a => a.job === 'warehouse').profilesByInstance[1].id++; },
  'QC self release': e => { e.final.checks[0].reviewedByUserId = e.final.checks[0].inspectorUserId; },
  'QC evidence absent': e => { e.inspection = null; },
  'QA from other receipt': e => { e.qa.json.data.review.purchaseReceiptId++; },
  'AP verifier same as recorder': e => { e.final.supplierPayments[0].verifiedByUserId = e.final.supplierPayments[0].submittedByUserId; },
  'hold liability turned into zero': e => { e.apBeforeQA.payableAmountNative = '0.00'; },
  'QA hold payment unfrozen': e => { e.apBeforeQA.paymentEligibility.eligible = true; },
  'cost remainder': e => { e.final.costs[0].costAmountDelta++; },
  'cost job missing second node': e => { e.costReadbacks.pop(); },
  'rejection changed business facts': e => { e.denials[0].after.order.finalAmount = 1499; },
  'unrelated409 substitutes held-batch refusal': e => { const d = e.denials.find(d => d.name === 'QA hold blocks dispatch of the real received batch'); Object.assign(e.actions[d.actionIndex], { method: 'GET', path: '/unrelated-endpoint', json: { success: false, errorCode: 'UNRELATED_CONFLICT' } }); },
  'held-batch refusal is a different conflict': e => { const d = e.denials.find(d => d.name === 'QA hold blocks dispatch of the real received batch'); e.actions[d.actionIndex].json = { success: false, errorCode: 'UNRELATED_CONFLICT' }; },
  'rejection uses equal empty snapshots': e => { e.denials[0].before = {}; e.denials[0].after = {}; },
  'rejection uses foreign-order snapshots': e => { e.denials[0].before.order.id++; e.denials[0].after.order.id++; },
  'reservation reduced original demand': e => { e.stages.firstReserved.expected.outstandingQuantity = 50; },
  'dispatch counted as acceptance': e => { e.stages.firstDispatched.details[0].fulfillment.lines[0].acceptedQuantity = 100; },
  'partial remaining50 hidden': e => { e.stages.partialAccepted.browser.texts.obligation = '已签收: 150 kg 待交: 0 kg'; },
  'workspace clean readback not proved': e => { delete e.stages.partialAccepted.browser.noPartialLoadWarning; },
  'screenshot covered': e => { e.browser.screenshots[0].unobscured = false; },
  'quality screenshot covered': e => { e.qualityBrowser.screenshots[0].unobscured = false; },
  'missing glyph boxes': e => { e.browser.readbacks[0].font.glyphs[0].signature = 'missing1'; },
  'browser from different run': e => { e.browser.runId = 'other-run'; },
  'quality profile not reread': e => { e.qualityBrowser.browserProfiles = []; },
  'unauthorized optional sales lookup': e => { const a = e.browser.actors.find(a => a.job === 'sales'); e.browser.actions.push({ job: 'sales', actorId: a.id, role: a.role, instance: 1, method: 'GET', path: '/api/contracts?status=active', status: 403, json: { success: false } }); },
  'browser response replaced': e => { e.inspection.http.actorId++; },
  'stable close key changed': e => { e.actions.filter(a => a.job === 'lead' && a.path.endsWith('/close'))[1].sent.idempotencyKey += '-different'; },
  'missing persisted close replay comparison': e => { delete e.planCloseReplaySnapshot; },
  'replays change persisted cost': e => { e.afterReplaysSnapshot.costs[0].costAmountDelta++; },
  'missing persisted replay comparison': e => { delete e.afterReplaysSnapshot; },
  'shipment replay missing a node': e => { e.shipmentReplays.pop(); },
  'receipt replay repeats the same node': e => { e.receiptReplays[1].instance = 0; },
  'shipment replay confirmation replaced': e => { e.shipmentReplays[0].response.json.submission.auditId++; },
  'receipt replay confirmation replaced': e => { e.receiptReplays[0].response.json.data.submission.auditId++; },
  'shipment replay uses different key': e => { e.actions.find(a => a.path === '/shipping').key += '-new'; },
  'supplier verification replay missing': e => { delete e.supplierVerificationReplay; },
  'supplier verification replay is not replay': e => { e.supplierVerificationReplay.json.data.replayed = false; },
  'audit identity forged': e => { e.final.audits.find(a => a.action === 'REVIEW_INCOMING_QC').userId++; },
  'no production-cost original API': e => { e.actions = e.actions.filter(a => a.job !== 'cost'); },
};
for (const [label, mutate] of Object.entries(mutations)) test(`reject ${label} even with a freshly recomputed digest`, () => {
  const e = sharedSalesProofFixture(); mutate(e); refreshSharedSalesDigest(e);
  assert.throws(() => verifySharedSalesChain(e), undefined, label); assert.throws(() => verifySharedSalesBrowser(e), undefined, label);
});
test('digest cannot be asserted without recomputation', () => { const e = sharedSalesProofFixture(); e.chainDigest = 'f'.repeat(64); assert.throws(() => verifySharedSalesChain(e), /digest mismatch/); });
test('provider mismatch cannot promote local evidence to cloud', () => assert.throws(() => verifySharedSalesChain(sharedSalesProofFixture(), 'postgresql'), /Provider mismatch/));
test('image artifact verification requires a real supplied resolution, no silent missing-file pass', () => { const e = sharedSalesProofFixture(); assert.throws(() => verifySharedSalesImages(e, () => 'Z:/missing-shared-proof.png')); });
