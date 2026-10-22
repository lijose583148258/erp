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

function openingDisposition(e, status) {
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (value.batchNo === e.manifest.existingBatch && Object.hasOwn(value, 'qualityStatus')) value.qualityStatus = status;
    Object.values(value).forEach(visit);
  };
  visit(e); refreshSharedSalesDigest(e); return e;
}

test('initial stock accepts both existing explicit issue dispositions without exempting incoming QA', () => {
  for (const status of ['not_required', 'released']) {
    const e = openingDisposition(sharedSalesProofFixture(), status);
    assert.doesNotThrow(() => verifySharedSalesChain(e, 'sqlite'));
    assert.equal(e.stages.beforeQC.batches.find(b => b.id === e.manifest.replenishmentBatchId).qualityStatus, 'hold');
  }
});

for (const status of ['hold', 'quarantine', 'pending', null]) test(`initial reservation control rejects ${status} stock even with a nominal HTTP success`, () => {
  assert.throws(() => verifySharedSalesChain(openingDisposition(sharedSalesProofFixture(), status), 'sqlite'));
});

const mutations = {
  'sales reservation denial reuses a stale CAS': e => { const d = e.denials.find(d => d.name === 'sales cannot reserve physical stock'); d.before = structuredClone(e.stages.firstReserved.snapshot); d.after = structuredClone(d.before); },
  'sales reservation denial has no actual payload': e => { const d = e.denials.find(d => d.name === 'sales cannot reserve physical stock'); delete e.actions[d.actionIndex].sent; },
  'sales reservation denial missing authorized positive control': e => { delete e.firstReservation; },
  'sales reservation positive control has no immediate SQL snapshot': e => { delete e.firstReservation.snapshot; },
  'sales reservation positive control is a later rehold': e => { const rows = e.browser.actions.filter(a => a.path === `/api/shipping/${e.manifest.shipmentIds[0]}/reserve`); e.firstReservation.response = { http: structuredClone(rows[1]), json: structuredClone(rows[1].json) }; },
  'sales reservation positive control is an HTTP replay': e => { e.firstReservation.response.json.data.replayed = true; e.firstReservation.response.http.json.data.replayed = true; const a = e.browser.actions.find(a => a.path === e.firstReservation.response.http.path && a.sent.expectedAuditId === null); a.json.data.replayed = true; },
  'sales reservation positive control changes request facts': e => { const d = e.denials.find(d => d.name === 'sales cannot reserve physical stock'); e.actions[d.actionIndex].sent.reason = 'different request'; },
  'sales reservation before snapshot conceals an earlier business audit': e => { const d = e.denials.find(d => d.name === 'sales cannot reserve physical stock'); const a = e.final.audits.find(a => a.action === 'RESERVE_STOCK'); for (const s of [e.stages.afterDraft, d.before, d.after]) s.audits.push(structuredClone(a)); },
  'sales reservation positive control drops prior business audits': e => { e.firstReservation.snapshot.audits.shift(); e.stages.firstReserved.snapshot = structuredClone(e.firstReservation.snapshot); },
  'sales reservation positive control duplicates its business audit': e => { const a = e.firstReservation.snapshot.audits.find(a => a.action === 'RESERVE_STOCK'); e.firstReservation.snapshot.audits.push({ ...a, id: 99999 }); e.stages.firstReserved.snapshot = structuredClone(e.firstReservation.snapshot); },
  'sales reservation positive control changes unrelated order facts': e => { e.firstReservation.snapshot.order.status = 'cancelled'; e.stages.firstReserved.snapshot = structuredClone(e.firstReservation.snapshot); },
  'sales reservation positive control persisted a different held quantity': e => { e.firstReservation.snapshot.shipments[0].reservationQuantity = 99; e.stages.firstReserved.snapshot = structuredClone(e.firstReservation.snapshot); },
  'sales reservation positive control changed another shipment': e => { e.firstReservation.snapshot.shipments[1].status = 'exception'; e.stages.firstReserved.snapshot = structuredClone(e.firstReservation.snapshot); },
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

function qualityStartupHarness({ drift = false, noResponse = false } = {}) {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const file = path.join(__dirname, 'lib/enterprise-round2-sales-quality-browser.cjs'), module = { exports: {} };
  const profile = { id: 79, role: 'run_owned_qc', permissions: ['procurement.quality.inspect'], dataScopes: ['procurement_visible'] };
  const actor = { id: profile.id, role: profile.role, profile, account: { role: profile.role }, token: 'private-session' };
  const calls = [], listeners = new Map(), sentinel = new Error('real receipt selector reached; no UI acceptance asserted');
  let startupPending = false, legacyResponse, freshRequest;
  const response = { status: () => 200, json: async () => ({ data: { ...profile, ...(drift ? { id: 999 } : {}) } }) };
  const request = { url: () => 'http://node-a.test/api/auth/me', method: () => 'GET', response: async () => {
    if (!noResponse) return response;
    listeners.get('requestfailed')?.({ ...request, failure: () => ({ errorText: 'net::ERR_ABORTED private-session' }) });
    for (let i = 0; i < 45; i++) listeners.get('pageerror')?.(new Error(`startup ${i} private-session`));
    return null;
  } };
  const page = {
    setDefaultTimeout: value => calls.push(['timeout', value]),
    on: (event, fn) => listeners.set(event, fn), off: event => listeners.delete(event),
    goto: async () => { calls.push(['goto']); startupPending = true; },
    waitForResponse: () => new Promise((resolve, reject) => { legacyResponse = { resolve, reject }; }),
    waitForRequest: predicate => {
      assert.equal(predicate({ ...request, url: () => 'http://foreign.test/api/auth/me' }), false);
      assert.equal(predicate({ ...request, method: () => 'POST' }), false);
      assert.equal(predicate(request), true);
      calls.push(['fresh-request']); return new Promise(resolve => { freshRequest = resolve; });
    },
    reload: async () => {
      calls.push(['reload']);
      if (startupPending) { legacyResponse?.reject(new Error('reload canceled startup auth')); return; }
      freshRequest(request);
    },
    locator: selector => ({ waitFor: async options => {
      assert.equal(selector, '#loading'); assert.equal(options.state, 'hidden');
      calls.push([startupPending ? 'initial-startup-settled' : 'fresh-startup-settled']); startupPending = false;
    } }),
    getByTestId: selector => ({ click: async () => { calls.push(['select', selector]); throw sentinel; } }),
    evaluate: async () => ({ path: '/', hash: '#procurement', loading: false, login: false, alerts: [] }),
    screenshot: async () => { calls.push(['diagnostic-screenshot']); }, isClosed: () => false,
  };
  const browser = { newPage: async () => page, close: async () => calls.push(['close']) };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, require: name => {
    if (name === 'playwright/test') return { expect: () => { throw new Error('Business assertions must not run before the sentinel'); } };
    if (name === './browser-launch-guard.cjs') return { launchBrowserWithGuard: async () => ({ browser }) };
    if (name === './ui-audit-user.cjs') return { loginUiAuditUser: async () => ({ user: profile, token: actor.token }) };
    if (name === './browser-cjk-font-guard.cjs') return { verifyRenderedCjk: async () => { throw new Error('No screenshot acceptance in startup contract'); } };
    return require(name);
  }, URL, Date }, { filename: file });
  return { create: () => module.exports.createSharedQualityBrowser({ urls: ['http://node-a.test', 'http://node-b.test'],
    actors: { qc: actor }, runId: 'deterministic-startup', folder: 'diagnostic-only' }), calls, sentinel, profile, listeners };
}

test('quality startup settles the first navigation before fresh auth and reaches only the real receipt selector', async () => {
  const h = qualityStartupHarness(), browser = await h.create();
  await assert.rejects(browser.inspect({ receiptId: 4 }), error => error === h.sentinel);
  assert.deepEqual(h.calls.filter(row => !['diagnostic-screenshot', 'timeout'].includes(row[0])),
    [['goto'], ['initial-startup-settled'], ['fresh-request'], ['reload'], ['fresh-startup-settled'], ['select', 'incoming-quality-select-4']]);
  assert.equal(browser.evidence().browserProfiles.length, 1);
  assert.equal(browser.evidence().browserProfiles[0].actual.id, h.profile.id);
  assert.equal(browser.evidence().actions.length, 0); await browser.close();
});

test('quality fresh auth rejects a borrowed identity before receipt selection', async () => {
  const h = qualityStartupHarness({ drift: true }), browser = await h.create();
  await assert.rejects(browser.inspect({ receiptId: 4 }), /Expected values to be strictly deep-equal/);
  assert.equal(h.calls.some(row => row[0] === 'select'), false);
  assert.equal(browser.evidence().browserProfiles.length, 0); await browser.close();
});

test('quality missing fresh response fails closed and captures bounded load-only diagnostics', async () => {
  const h = qualityStartupHarness({ noResponse: true }), browser = await h.create();
  await assert.rejects(browser.inspect({ receiptId: 4 }), /Fresh quality auth\/me request failed/);
  assert.equal(h.calls.some(row => row[0] === 'select'), false);
  const trace = browser.evidence().loads[0];
  assert.equal(trace.job, 'qc'); assert.equal(trace.receiptId, 4); assert.equal(trace.phase, 'fresh-auth');
  assert.equal(trace.failure.login, false); assert.equal(trace.failure.loading, false);
  assert.equal(trace.events.length, 40); assert.equal(trace.events[0].event, 'auth-requestfailed');
  assert.equal(trace.events[0].error, 'net::ERR_ABORTED [redacted]');
  assert.equal(h.calls.some(row => row[0] === 'diagnostic-screenshot'), true);
  assert.equal(h.listeners.size, 0);
  assert.equal(/private-session|authorization|password/i.test(JSON.stringify(browser.evidence())), false);
  await browser.close();
});
