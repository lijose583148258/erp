const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const catalog = require('./config/enterprise-round2-v1.json');
const { validateCatalog, summarize, createRound2Runner, synchronizedBurst } = require('./lib/enterprise-round2-runner.cjs');
const { verifyInventoryBrowser, verifyInventoryWorkforceReadbacks } = require('./lib/enterprise-round2-inventory-browser.cjs');
const { inventoryBrowserFixture } = require('./fixtures/inventory-browser-proof-fixture.cjs');
const { verifyPurchaseReceiptSubmissionProof, verifyPurchaseReceiptRecoveryProof } = require('./lib/enterprise-round2-purchase-receipt-proof.cjs');
const { purchaseReceiptSubmissionProofFixture, purchaseReceiptRecoveryProofFixture, controlledPurchaseReceiptSubmissionProofFixture } = require('./fixtures/purchase-receipt-proof-fixture.cjs');

test('independent purchase receipt verifiers accept explicitly synthetic contracts without business acceptance credit', () => {
  for (const provider of ['sqlite', 'postgresql']) assert.deepEqual(verifyPurchaseReceiptSubmissionProof(purchaseReceiptSubmissionProofFixture(provider)),
    { concurrentNodes: 2, originalReceipts: 1, finalReceipts: 2, auditFailureRollback: true, fullReceivedReplay: true });
  assert.deepEqual(verifyPurchaseReceiptRecoveryProof(purchaseReceiptRecoveryProofFixture()),
    { lostAcknowledgment: true, refreshRecovery: true, physicalReceiptCount: 1, physicalQuantity: 5, costAmount: 50 });
});
test('V2 independent reader checks synthetic frozen supplier AP, independent source approval and held internal batches without rewriting V1 fixtures', () => {
  for (const provider of ['sqlite','postgresql']) assert.deepEqual(verifyPurchaseReceiptSubmissionProof(controlledPurchaseReceiptSubmissionProofFixture(provider)),
    { concurrentNodes:2, originalReceipts:1, finalReceipts:2, auditFailureRollback:true, fullReceivedReplay:true });
  assert.equal(purchaseReceiptSubmissionProofFixture().concurrent[0].json.data.submission.schema, 'purchase-receipt-submission/v1');
});
for (const [label, mutate] of [
  ['caller omitted reviewed revision', e => { delete e.concurrent[0].requestBody.expectedRevision; }],
  ['internal batch reused supplier lot', e => { e.concurrent[0].json.data.submission.receipt.batchNo = 'synthetic-first'; }],
  ['batch held flag fabricated as released', e => { e.committed.batches[0].qualityStatus = 'released'; }],
  ['unknown legacy AP treated as zero', e => { e.committed.receipts[0].payableAmountNative = null; }],
  ['typed base liability altered', e => { e.committed.receipts[0].payableAmountBase = '9.99'; }],
  ['self source approval', e => { e.committed.audits[1].userId = e.committed.audits[0].userId; }],
  ['dispatch pretended to be independent approval', e => { const a = JSON.parse(e.committed.audits[1].details); a.isSourceApproval = false; e.committed.audits[1].details = JSON.stringify(a); }],
  ['source plan replaced', e => { const a = JSON.parse(e.committed.audits[0].details); a.after.incomingQualityPlanJson = '{}'; e.committed.audits[0].details = JSON.stringify(a); }],
  ['source schema unknown', e => { const a = JSON.parse(e.committed.audits[0].details); a.schema = 'unrecognized'; e.committed.audits[0].details = JSON.stringify(a); }],
  ['raw supplier lot overwritten', e => { e.committed.receipts[0].supplierBatchNo = 'OTHER'; }],
  ['receipt batch ID changed', e => { e.committed.receipts[0].batchId = 99; }],
]) test(`controlled receipt verifier rejects ${label}`, () => {
  const e = controlledPurchaseReceiptSubmissionProofFixture(); mutate(e); assert.throws(() => verifyPurchaseReceiptSubmissionProof(e));
});
for (const [label, mutate] of [
  ['missing raw stock balance coverage', e => { delete e.committed.balances; }],
  ['one node represented twice', e => { e.concurrent[1].instance = 0; }],
  ['two different receivers called one intent', e => { e.concurrent[1].actorId = 20; }],
  ['second node used another key', e => { e.concurrent[1].requestKey = 'another-key-123'; }],
  ['second node changed the receipt body', e => { e.concurrent[1].requestBody.quantity = 0.5; }],
  ['two owners instead of one owner and one acknowledgment', e => { e.concurrent[1].json.data.replayed = false; }],
  ['no owner acknowledgment', e => { e.concurrent[0].json.data.replayed = true; }],
  ['response omitted the durable submission', e => { delete e.concurrent[0].json.data.submission; }],
  ['request targeted an unrelated PO', e => { e.concurrent[0].purchaseOrderId = 99; }],
  ['recorded response contains an unrecognized receipt field', e => { e.concurrent[0].json.data.submission.receipt.approved = true; }],
  ['raw receipt durable key changed', e => { e.committed.receipts[0].submissionKey = 'different-key-123'; }],
  ['raw receipt fingerprint changed', e => { e.committed.receipts[0].submissionFingerprint = 'f'.repeat(64); }],
  ['raw receipt JSON is invalid', e => { e.committed.receipts[0].submissionJson = '{'; }],
  ['raw receipt is missing', e => { e.committed.receipts = []; }],
  ['raw receipt is duplicated', e => { e.committed.receipts.push({ ...e.committed.receipts[0] }); }],
  ['receipt audit actor changed', e => { e.committed.audits[1].userId = 20; }],
  ['receipt audit action is not a receipt', e => { e.committed.audits[1].action = 'STATUS_CHANGE'; }],
  ['receipt audit resource targets a different PO', e => { e.committed.audits[1].resourceId = 99; }],
  ['receipt audit receipt hash is forged', e => { const d = JSON.parse(e.committed.audits[1].details); d.receiptHash = 'f'.repeat(64); e.committed.audits[1].details = JSON.stringify(d); }],
  ['receipt audit key hash is forged', e => { const d = JSON.parse(e.committed.audits[1].details); d.submissionKeyHash = 'f'.repeat(64); e.committed.audits[1].details = JSON.stringify(d); }],
  ['stock movement does not match actual receipt', e => { e.committed.entries[0].movements[0].quantityDelta = 2; }],
  ['stock balance does not match actual receipt', e => { e.committed.balances[0].quantity = 2; }],
  ['cost ledger is from another voucher', e => { e.committed.costs[0].sourceRef = 'other-entry'; }],
  ['cost amount drift', e => { e.committed.costs[0].costAmountDelta = 20; }],
  ['changed facts request was actually identical', e => { e.changed.requestBody = { ...e.concurrent[0].requestBody }; }],
  ['different actor rejection actually used the owner', e => { e.differentActor.actorId = e.concurrent[0].actorId; }],
  ['key conflicts silently changed the PO timestamp', e => { e.afterConflicts.order.updatedAt = '2026-10-14T00:00:03.000Z'; }],
  ['full received replay is a new posting', e => { e.replay.json.data.replayed = false; }],
  ['full received replay changed its receipt', e => { e.replay.json.data.submission.receipt.receiptNo = 'new-receipt'; }],
  ['full received replay reset the remaining quantity', e => { e.replay.json.data.receiptSummary.remainingQuantity = 1; }],
  ['full received replay advanced the PO timestamp', e => { e.afterReplay.order.updatedAt = '2026-10-14T00:00:03.000Z'; }],
  ['full received replay rewrote receipt history', e => { e.afterReplay.receipts[0].note = 'rewritten'; }],
  ['remaining receipt lost its immutable JSON', e => { e.full.receipts[1].submissionJson = null; }],
  ['remaining receipt reuses the first key', e => { e.full.receipts[1].submissionKey = e.full.receipts[0].submissionKey; }],
  ['audit fault returned success', e => { e.auditFailure.status = 201; }],
  ['audit fault readback omits inventory', e => { delete e.faultAfter.balances; }],
  ['audit fault retained an orphan stock balance', e => { e.faultAfter.balances.push({ id: 99, materialId: 9, batchNo: 'orphan', unit: 'kg', quantity: 1 }); }],
  ['audit fault retained a receipt', e => { e.faultAfter.receipts.push({ ...e.committed.receipts[0] }); }],
  ['audit fault orphan batch is absent instead of explicitly null', e => { delete e.orphanFaultBatch; }],
  ['audit fault did not install a database trigger', e => { e.faultInjection.installed = []; }],
  ['audit fault trigger targets a different action', e => { e.faultInjection.installed[0].definition = e.faultInjection.installed[0].definition.replace('CREATE_RECEIPT', 'STATUS_CHANGE'); }],
  ['audit fault trigger targets a different resource', e => { e.faultInjection.installed[0].definition = e.faultInjection.installed[0].definition.replace("'purchase_order'", "'order'"); }],
  ['audit fault trigger targets a different PO', e => { e.faultInjection.installed[0].definition = e.faultInjection.installed[0].definition.replace('resource_id = 12', 'resource_id = 123'); }],
  ['audit fault trigger never raises the intended fault', e => { e.faultInjection.installed[0].definition = e.faultInjection.installed[0].definition.replace('Synthetic receipt audit unavailable', 'Other error'); }],
  ['audit fault trigger was not removed', e => { e.faultInjection.removed = e.faultInjection.installed; }],
  ['audit fault trigger existed before the test', e => { e.faultInjection.before = e.faultInjection.installed; }],
]) test(`purchase durable receipt verifier rejects ${label}`, () => {
  const e = purchaseReceiptSubmissionProofFixture(); mutate(e); assert.throws(() => verifyPurchaseReceiptSubmissionProof(e));
});
test('PostgreSQL audit fault proof binds the actual trigger function and its removal', () => {
  for (const mutate of [
    e => { e.faultInjection.installedFunctions = []; },
    e => { e.faultInjection.installedFunctions[0].definition = e.faultInjection.installedFunctions[0].definition.replace('Synthetic receipt audit unavailable', 'Unrelated fault'); },
    e => { e.faultInjection.removedFunctions = e.faultInjection.installedFunctions; },
  ]) { const e = purchaseReceiptSubmissionProofFixture('postgresql'); mutate(e); assert.throws(() => verifyPurchaseReceiptSubmissionProof(e)); }
});
for (const [label, mutate] of [
  ['no recovery evidence', e => { delete e.receiptRecovery; }],
  ['owner response was only a replay', e => { e.receiptRecovery.ownerResponse.body.data.replayed = true; }],
  ['same-key retry became a new owner', e => { e.receiptRecovery.replayResponse.body.data.replayed = false; }],
  ['retry header key changed', e => { e.receiptRecovery.replayRequest.requestKey = 'another-key-123'; }],
  ['retry receipt body changed', e => { e.receiptRecovery.replayRequest.body.acceptedQuantity = 4; }],
  ['intent storage belongs to another receiver', e => { e.receiptRecovery.storageSlot = 'ailaoda.purchase-receipt-intent/v1.99.1'; }],
  ['intent storage belongs to another PO', e => { e.receiptRecovery.storageSlot = 'ailaoda.purchase-receipt-intent/v1.12.99'; }],
  ['restored intent disappeared after reload', e => { e.receiptRecovery.persistedAfterRefresh = null; }],
  ['restored intent user changed', e => { e.receiptRecovery.intent.userId = '99'; }],
  ['restored intent PO changed', e => { e.receiptRecovery.intent.orderId = '99'; }],
  ['no real refresh was recorded', e => { e.receiptRecovery.refreshed = false; }],
  ['unexpected refresh dialog', e => { e.receiptRecovery.refreshDialogs = [{ type: 'confirm', accepted: true }]; }],
  ['refresh dialog operation failed', e => { e.receiptRecovery.refreshDialogError = 'Refresh aborted'; }],
  ['restored form remained editable', e => { e.receiptRecovery.refreshGuard.inputsDisabled = 0; }],
  ['restored retry was blocked', e => { e.receiptRecovery.refreshGuard.retryEnabled = false; }],
  ['restored quantity is current remaining not original five', e => { e.receiptRecovery.restoredValues[0] = '7'; }],
  ['original intent was not cleared after verified acknowledgment', e => { e.receiptRecovery.storageAfterReplay = e.receiptRecovery.persistedBeforeRefresh; }],
  ['replay changed the raw PO timestamp', e => { e.receiptRecovery.afterReplay.orders[0].updatedAt = 'later'; }],
  ['replay changed raw cost', e => { e.receiptRecovery.afterReplay.costs[0].costAmountDelta = 100; }],
  ['replay duplicated raw receipt', e => { e.receiptRecovery.afterReplay.receipts.push({ ...e.receiptRecovery.afterReplay.receipts[0], id: 99 }); }],
  ['raw original receipt submission JSON is missing', e => { e.receiptRecovery.afterOwner.receipts[0].submissionJson = null; }],
  ['raw original receipt audit is forged', e => { e.receiptRecovery.afterOwner.audits[4].details = '{}'; }],
  ['final role proof replaced the original physical receipt', e => { e.final.receipts[0].id = 99; }],
  ['successful UI retry was recorded with a different key', e => { e.writes[3].requestKey = 'another-key-123'; }],
  ['successful UI retry did not validate the original response', e => { e.writes[3].response.data.submission.auditId = 99; }],
  ['another role made the successful receipt retry', e => { e.writes[3].job = 'buyer'; }],
  ['missing restored screenshot', e => { e.receiptRecovery.refreshedScreenshot = ''; }],
]) test(`purchase receipt browser recovery verifier rejects ${label}`, () => {
  const e = purchaseReceiptRecoveryProofFixture(); mutate(e); assert.throws(() => verifyPurchaseReceiptRecoveryProof(e));
});
test('purchase recovery producer performs one real owner fetch, lost ACK, and reload without fabricating a second delivery', () => {
  const source = fs.readFileSync(path.join(__dirname, 'lib/enterprise-round2-procurement-browser.cjs'), 'utf8');
  assert.match(source, /const response = await route\.fetch\(\{ timeout: 15000 \}\)/);
  assert.match(source, /await route\.abort\('failed'\); resolveOwner\(\)/);
  assert.match(source, /if \(page\.url\(\) === url\) await page\.reload\(/);
  assert.match(source, /recovery\.persistedAfterRefresh = await receiver\.evaluate/);
  assert.match(source, /assert\.deepEqual\(recovery\.afterReplay, recovery\.beforeReplay/);
  assert.match(source, /scope: 'Lost HTTP acknowledgment[^\n]*not database restart/);
});

test('inventory readback verifier accepts stock and both legitimate transfer/shipping outcomes', () => {
  for (const status of [undefined, 'pending', 'in_transit']) {
    const { source, proof } = inventoryBrowserFixture(status);
    assert.equal(verifyInventoryBrowser(proof, source).actors.length, 2);
  }
});

// Synthetic reader contracts only; these do not replace the existing real
// twenty-writer race, its two native participant pages, or workforce acceptance.
function inventoryWorkforceFixture() {
  const fixture = inventoryBrowserFixture();
  const { source, proof } = fixture, people = [];
  let id = 100;
  for (const { job, count } of catalog.roles) for (let index = 1; index <= count; index++) {
    const role = `synthetic_${job}`, personId = ++id;
    const profile = { id: personId, username: `synthetic_${personId}`, role, segment: 'mixed', isActive: true,
      mustChangePassword: false, permissions: ['warehouse.read', 'warehouse.write', 'warehouse.ledger.read'], dataScopes: ['warehouse_visible'] };
    people.push({ id: personId, job, index, role, profile, profilesByInstance: { 0: structuredClone(profile), 1: structuredClone(profile) } });
  }
  source.workforce = { people, appUrls: ['http://127.0.0.1:51001', 'http://127.0.0.1:51002'] };
  Object.assign(source.state.balances[0], { materialId: 8, locationId: 2 });
  Object.assign(source.state.entries[0], { sourceType: 'warehouse_manual_inbound', direction: 'inbound', createdBy: 1,
    warehouseId: 1, locationId: 2, reason: 'synthetic fixture', note: null });
  Object.assign(source.state.movements[0], { materialId: 8, locationId: 2, stockBalanceId: 1, quantityBefore: 0, quantityAfter: 100 });
  proof.workforceReadbacks = proof.readbacks.map((read, instance) => {
    const person = people.find(row => row.job === 'warehouse' && row.index === instance + 1);
    const response = (pathname, query, data) => ({ actorId: person.id, instance,
      origin: source.workforce.appUrls[instance], method: 'GET', pathname, query, authorizationMatched: true,
      status: 200, json: { success: true, data } });
    const observed = structuredClone(read);
    Object.assign(observed, { actorId: person.id, role: person.role, observerOnly: true,
      actualProfile: { endpoint: '/auth/me', status: 200, ...structuredClone(person.profile) },
      nativeProfile: response('/api/auth/me', {}, structuredClone(person.profile)),
      apiReadbacks: {
        balances: response('/api/warehouses/stock-balances', { productName: 'unit-product' }, [
          { ...structuredClone(source.state.balances[0]), warehouseName: 'warehouse', locationName: 'location' }]),
        ledger: response('/api/warehouses/stock-entries', { batchNo: 'unit-batch' }, [
          { ...structuredClone(source.state.entries[0]), movements: structuredClone(source.state.movements), movementCount: 1, netQuantityDelta: 100 }]),
      } });
    return observed;
  });
  return fixture;
}

test('stock observer reader binds same20 public profiles, real response facts and native rows separately from writers', () => {
  const { source, proof } = inventoryWorkforceFixture();
  assert.deepEqual(verifyInventoryWorkforceReadbacks(proof, source), { observers: [108, 109], nodes: [0, 1] });
  assert.equal(verifyInventoryBrowser(proof, source).actors.length, 2);
  assert.deepEqual(proof.readbacks.map(row => row.actorId), [1, 2], 'Original winner/loser evidence is unchanged');
});

for (const [label, mutate] of [
  ['no source cohort', ({ source }) => { delete source.workforce; }],
  ['incomplete source cohort', ({ source }) => { source.workforce.people.pop(); }],
  ['duplicate source identity', ({ source }) => { source.workforce.people[0].id = source.workforce.people[1].id; }],
  ['missing observers', ({ proof }) => { delete proof.workforceReadbacks; }],
  ['one observer', ({ proof }) => { proof.workforceReadbacks.pop(); }],
  ['pressure writer substituted', ({ proof }) => { proof.workforceReadbacks[0].actorId = 1; }],
  ['different warehouse substituted', ({ proof, source }) => { proof.workforceReadbacks[0].actorId = source.workforce.people.find(p => p.job === 'warehouse' && p.index === 3).id; }],
  ['wrong job', ({ source }) => { source.workforce.people.find(p => p.job === 'warehouse').job = 'sales'; }],
  ['observer labelled a writer', ({ proof }) => { proof.workforceReadbacks[0].observerOnly = false; }],
  ['two readers on same node', ({ proof }) => { proof.workforceReadbacks[1].instance = 0; }],
  ['profile drift on API auth', ({ proof }) => { proof.workforceReadbacks[0].actualProfile.permissions.push('*'); }],
  ['inactive observer', ({ proof }) => { proof.workforceReadbacks[0].nativeProfile.json.data.isActive = false; }],
  ['password change required', ({ proof }) => { proof.workforceReadbacks[0].actualProfile.mustChangePassword = true; }],
  ['native borrowed profile', ({ proof }) => { proof.workforceReadbacks[0].nativeProfile.json.data.id++; }],
  ['native wrong username', ({ proof }) => { proof.workforceReadbacks[0].nativeProfile.json.data.username = 'other'; }],
  ['native cross-origin response', ({ proof }) => { proof.workforceReadbacks[0].nativeProfile.origin = 'http://127.0.0.1:59999'; }],
  ['native wrong bearer', ({ proof }) => { proof.workforceReadbacks[0].apiReadbacks.balances.authorizationMatched = false; }],
  ['native POST substituted', ({ proof }) => { proof.workforceReadbacks[0].apiReadbacks.ledger.method = 'POST'; }],
  ['native response other node', ({ proof }) => { proof.workforceReadbacks[0].apiReadbacks.ledger.instance = 1; }],
  ['native response other actor', ({ proof }) => { proof.workforceReadbacks[0].apiReadbacks.ledger.actorId++; }],
  ['native missing response', ({ proof }) => { delete proof.workforceReadbacks[0].apiReadbacks.ledger; }],
  ['native unsuccessful response', ({ proof }) => { proof.workforceReadbacks[0].apiReadbacks.ledger.json.success = false; }],
  ['native response status failure', ({ proof }) => { proof.workforceReadbacks[0].apiReadbacks.ledger.status = 403; }],
  ['native wrong batch query', ({ proof }) => { proof.workforceReadbacks[0].apiReadbacks.ledger.query.batchNo = 'other'; }],
  ['native restricted voucher query', ({ proof }) => { proof.workforceReadbacks[0].apiReadbacks.ledger.query.sourceType = 'warehouse_transfer'; }],
  ['native wrong product query', ({ proof }) => { proof.workforceReadbacks[0].apiReadbacks.balances.query.productName = 'other'; }],
  ['native response missing balance', ({ proof }) => { proof.workforceReadbacks[0].apiReadbacks.balances.json.data = []; }],
  ['native response duplicate balance', ({ proof }) => { const rows = proof.workforceReadbacks[0].apiReadbacks.balances.json.data; rows.push(structuredClone(rows[0])); }],
  ['native response wrong material', ({ proof }) => { proof.workforceReadbacks[0].apiReadbacks.balances.json.data[0].materialId++; }],
  ['native response wrong location', ({ proof }) => { proof.workforceReadbacks[0].apiReadbacks.balances.json.data[0].locationId++; }],
  ['native response quantity drift', ({ proof }) => { proof.workforceReadbacks[0].apiReadbacks.balances.json.data[0].quantity--; }],
  ['native response location label drift', ({ proof }) => { proof.workforceReadbacks[0].apiReadbacks.balances.json.data[0].locationName = 'elsewhere'; }],
  ['native response missing voucher', ({ proof }) => { proof.workforceReadbacks[0].apiReadbacks.ledger.json.data = []; }],
  ['native voucher creator drift', ({ proof }) => { proof.workforceReadbacks[0].apiReadbacks.ledger.json.data[0].createdBy++; }],
  ['native voucher source drift', ({ proof }) => { proof.workforceReadbacks[0].apiReadbacks.ledger.json.data[0].sourceRef = 'other'; }],
  ['native voucher movement missing', ({ proof }) => { proof.workforceReadbacks[0].apiReadbacks.ledger.json.data[0].movements = []; }],
  ['native voucher movement amount drift', ({ proof }) => { proof.workforceReadbacks[0].apiReadbacks.ledger.json.data[0].movements[0].quantityDelta--; }],
  ['native voucher movement total drift', ({ proof }) => { proof.workforceReadbacks[0].apiReadbacks.ledger.json.data[0].netQuantityDelta--; }],
  ['native table missing voucher', ({ proof }) => { proof.workforceReadbacks[0].ledger = []; }],
  ['native table quantity drift', ({ proof }) => { proof.workforceReadbacks[0].balances[0].cells[2] = '99'; }],
  ['native customer catalog access', ({ proof }) => { proof.workforceReadbacks[0].customerCatalogRequests++; }],
  ['native missing screenshot', ({ proof }) => { proof.workforceReadbacks[0].screenshots.pop(); }],
]) test(`stock observer reader rejects ${label}`, () => {
  const fixture = inventoryWorkforceFixture(); mutate(fixture);
  assert.throws(() => verifyInventoryBrowser(fixture.proof, fixture.source));
});

test('stock observers cannot be silently omitted when the original cohort proof exists', () => {
  const { source, proof } = inventoryWorkforceFixture(); delete proof.workforceReadbacks;
  assert.throws(() => verifyInventoryBrowser(proof, source), /observer pages/);
});

test('stock observer extension is not accepted for the independent transfer/shipping race', () => {
  const { source, proof } = inventoryWorkforceFixture(); source.persisted = { status: 'pending' };
  assert.throws(() => verifyInventoryWorkforceReadbacks(proof, source), /stock20/);
});

function inventoryObservedGet() {
  const module = { exports: {} };
  // Expose this private transport assertion only inside the test VM. It does
  // not stub business pages or claim browser acceptance from synthetic traffic.
  require('node:vm').runInNewContext(fs.readFileSync(path.join(__dirname, 'lib/enterprise-round2-inventory-browser.cjs'), 'utf8')
    + '\nmodule.exports.capture = observedBrowserGet;', { module, exports: module.exports, require, URL });
  return module.exports.capture;
}

test('stock native response capture records only successful private bearer comparison, never the header', async () => {
  const capture = inventoryObservedGet(), secret = 'PRIVATE_STOCK_OBSERVER_SESSION';
  const actor = { id: 108, token: secret };
  const response = { url: () => 'http://127.0.0.1:51001/api/warehouses/stock-balances?productName=unit-product',
    request: () => ({ method: () => 'GET', headerValue: async name => name === 'authorization' ? `Bearer ${secret}` : null }),
    status: () => 200, json: async () => ({ success: true, data: [] }) };
  const read = await capture(response, actor, 0, 'http://127.0.0.1:51001');
  assert.equal(read.authorizationMatched, true); assert.equal(read.actorId, 108);
  assert(!JSON.stringify(read).includes(secret)); assert(!Object.hasOwn(read, 'headers'));
});

for (const [label, mutate] of [
  ['wrong private bearer', r => { r.request = () => ({ method: () => 'GET', headerValue: async () => 'Bearer OTHER_PRIVATE_SESSION' }); }],
  ['foreign origin', r => { r.url = () => 'http://127.0.0.1:59999/api/warehouses/stock-entries'; }],
  ['POST', r => { r.request = () => ({ method: () => 'POST', headerValue: async () => 'Bearer PRIVATE_EXPECTED_SESSION' }); }],
  ['HTTP denial', r => { r.status = () => 403; }],
  ['failed envelope', r => { r.json = async () => ({ success: false, data: [] }); }],
]) test(`stock native response capture rejects ${label} without private token error output`, async () => {
  const response = { url: () => 'http://127.0.0.1:51001/api/warehouses/stock-entries',
    request: () => ({ method: () => 'GET', headerValue: async () => 'Bearer PRIVATE_EXPECTED_SESSION' }),
    status: () => 200, json: async () => ({ success: true, data: [] }) };
  mutate(response);
  await assert.rejects(inventoryObservedGet()(response, { id: 108, token: 'PRIVATE_EXPECTED_SESSION' }, 0, 'http://127.0.0.1:51001'), error => {
    assert(!require('node:util').inspect(error).includes('PRIVATE_EXPECTED_SESSION'));
    assert(!require('node:util').inspect(error).includes('OTHER_PRIVATE_SESSION')); return true;
  });
});

for (const [label, mutate] of [
  ['stale displayed quantity', ({ proof }) => { proof.readbacks[0].balances[0].cells[2] = '100'; }],
  ['wrong batch', ({ proof }) => { proof.readbacks[0].balances[0].cells[1] = 'other-batch'; }],
  ['wrong location', ({ proof }) => { proof.readbacks[0].balances[0].cells[5] = 'other-location'; }],
  ['missing ledger', ({ proof }) => { proof.readbacks[0].ledger = []; }],
  ['missing movement quantity', ({ proof }) => { proof.readbacks[0].ledger[0].text = 'entry-1 ref-1 posted 1 行 / 40 unit-product unit-batch'; }],
  ['same actor twice', ({ proof }) => { proof.readbacks[1].actorId = proof.readbacks[0].actorId; }],
  ['same node twice', ({ proof }) => { proof.readbacks[1].instance = 0; }],
  ['unauthorized customer read', ({ proof }) => { proof.readbacks[0].customerCatalogRequests = 1; }],
  ['wrong shipment status', ({ proof }) => { proof.readbacks[0].shipment.status = '待发货'; }],
  ['covered shipment status', ({ proof }) => { proof.readbacks[0].shipment.statusUnobscured = false; }],
  ['lost screenshot', ({ proof }) => { proof.readbacks[0].screenshots.pop(); }],
  ['API failure', ({ proof }) => { proof.readbacks[0].httpStatuses[0] = 403; }],
  ['runtime error', ({ proof }) => { proof.runtimeErrors.push('403 Forbidden'); }],
  ['cost drift', ({ source }) => { source.state.costs[0].costAmountDelta += 1; }],
  ['physical balance drift', ({ source }) => { source.state.batch.stockQuantity += 1; }],
]) test(`inventory browser rejects ${label}`, () => {
  const fixture = inventoryBrowserFixture('in_transit'); mutate(fixture);
  assert.throws(() => verifyInventoryBrowser(fixture.proof, fixture.source));
});

test('20 positions, 12 chains and unique obligations are frozen', () => {
  assert(validateCatalog(catalog).length >= 24);
  assert.throws(() => validateCatalog({ ...catalog, chains: catalog.chains.slice(1) }));
  const duplicated = structuredClone(catalog);
  duplicated.chains[1].checks.push(duplicated.chains[0].checks[0]);
  assert.throws(() => validateCatalog(duplicated), /Duplicate/);
});

test('presales are allowed without negative physical stock; barter remains mandatory', () => {
  assert.equal(catalog.businessPolicy.salesOverbooking, 'allowed_with_traceable_fulfillment_plan');
  assert.equal(catalog.businessPolicy.physicalStock, 'never_negative');
  const ids = validateCatalog(catalog);
  for (const id of ['presale-with-fulfillment-plan', 'backorder-adjustment-closeout', 'barter-dual-stock-posting-replay', 'barter-offset-cash-difference', 'barter-reversal-conservation']) {
    assert(ids.includes(id), `Missing obligation: ${id}`);
  }
});

test('partial, missing, blocked, unsupported and running checks cannot make a chain green', () => {
  for (const status of ['not_run', 'blocked', 'unsupported', 'running']) {
    const checks = validateCatalog(catalog).map(id => ({ id, status: 'passed' }));
    checks[0].status = status;
    assert.equal(summarize({ checks }, catalog).status, 'incomplete');
    checks.shift();
    assert.equal(summarize({ checks }, catalog).status, 'incomplete');
  }
});

test('only complete fixed-ID evidence can pass, duplicate and unknown IDs fail', () => {
  const checks = validateCatalog(catalog).map(id => ({ id, status: 'passed' }));
  assert.equal(summarize({ checks }, catalog).passedChains, 12);
  assert.throws(() => summarize({ checks: [...checks, checks[0]] }, catalog));
  assert.throws(() => summarize({ checks: [...checks, { id: 'unknown', status: 'passed' }] }, catalog));
});

test('failure and timeout persist without truncating independent checks', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'round2-contract-'));
  const reportPath = path.join(folder, 'report.json');
  const runner = createRound2Runner({ catalog, reportPath });
  await runner.run('stock-20-contention', async () => { throw new Error('injected failure'); });
  await runner.run('payment-duplicate-verification', async signal => new Promise(resolve => {
    signal.addEventListener('abort', () => resolve({ late: true }), { once: true });
  }), { timeoutMs: 20 });
  await runner.run('transfer-shipping-contention', async () => ({ persistedStock: 40 }));
  const report = runner.finish();
  assert.equal(report.status, 'failed');
  assert.equal(report.summary.failedChecks, 2);
  assert.equal(report.summary.passedChecks, 1);
  assert.equal(JSON.parse(fs.readFileSync(reportPath)).summary.passedChecks, 1);
  assert(path.resolve(folder).startsWith(`${path.resolve(os.tmpdir())}${path.sep}round2-contract-`), 'Cleanup must remain in the generated test directory');
  fs.rmSync(folder, { recursive: true });
});

test('barrier launches distinct actors together and retains each outcome', async () => {
  const actors = Array.from({ length: 20 }, (_, id) => ({ id }));
  const result = await synchronizedBurst(actors, async actor => ({ status: actor.id === 19 ? 409 : 201 }));
  assert.equal(result.length, 20);
  assert.equal(result.filter(row => row.status === 409).length, 1);
  assert(result.every(row => row.finishedMs >= row.startedMs));
  await assert.rejects(synchronizedBurst([{ id: 1 }, { id: 1 }], async () => ({})), /Distinct/);
});

test('requested cloud Round2 is mandatory even when continue-on-error makes its conclusion green', () => {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, 'enterprise-cloud-business-audit-summary-v1.cjs'), 'utf8');
  const baselineIds = [...source.matchAll(/\['([a-z0-9_]+)',/g)].map(match => match[1]).filter(id => id !== 'round2_business');
  for (const requested of [false, true]) {
    let report;
    let exitCode = 0;
    const steps = Object.fromEntries(baselineIds.map(id => [id, { outcome: 'success', conclusion: 'success' }]));
    steps.round2_business = { outcome: 'failure', conclusion: 'success' };
    vm.runInNewContext(source, {
      require: name => name === 'node:fs' ? { mkdirSync() {}, writeFileSync(_path, data) { report = JSON.parse(data); } } : require(name),
      process: { env: { BUSINESS_AUDIT_STEPS_JSON: JSON.stringify(steps), ROUND2_REQUESTED: String(requested) }, exit(code) { exitCode = code; } },
      console: { log() {}, error() {} },
    });
    assert.equal(report.status, requested ? 'failed' : 'passed');
    assert.equal(exitCode, requested ? 1 : 0);
  }
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/enterprise-cloud-sandbox.yml'), 'utf8');
  assert.match(workflow, /id: round2_business[\s\S]{0,150}always\(\)[\s\S]{0,150}continue-on-error: true/);
  assert.match(workflow, /ROUND2_REQUESTED: \$\{\{ inputs.round2 \|\| false \}\}/);
});

test('actual workflow shell runs all nine human audits under Actions bash -e after failures', () => {
  const { spawnSync } = require('node:child_process');
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/enterprise-cloud-sandbox.yml'), 'utf8');
  const section = workflow.split('      - name: Simulate human ERP workflows')[1].split('\n      - name:')[0];
  const script = section.split('        run: |')[1].split('\n').map(line => line.replace(/^ {10}/, '')).join('\n');
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  for (const failAt of [1, 7, 9]) {
    // Only substitute business commands, not run_audit or the workflow's shell options.
    const stub = `calls=0
npm() { calls=$((calls+1)); echo "EXECUTED:$calls:$*"; if (( calls == ${failAt} )); then return 23; fi; }
env() { while [[ "$1" == *=* ]]; do shift; done; "$@"; }
export DATABASE_URL=fixture
`;
    const result = spawnSync(bash, ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', stub + script], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stderr);
    assert.equal((result.stdout.match(/^EXECUTED:/gm) || []).length, 9, result.stdout);
    assert.match(result.stdout, /EXECUTED:8:run audit:collection:human-flow/);
    assert.match(result.stdout, /Human ERP workflow failures: .*:23/);
  }
});

test('font preparation failure remains fatal only at the final aggregate even with a green conclusion', () => {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, 'enterprise-cloud-business-audit-summary-v1.cjs'), 'utf8');
  const ids = [...source.matchAll(/\['([a-z0-9_]+)',/g)].map(match => match[1]).filter(id => id !== 'round2_business');
  assert(ids.includes('browser_fonts'));
  for (const outcome of ['failure', 'skipped', 'cancelled', 'success']) {
    const steps = Object.fromEntries(ids.map(id => [id, { outcome: 'success', conclusion: 'success' }]));
    steps.browser_fonts = { outcome, conclusion: 'success' };
    let report; let exitCode = 0;
    vm.runInNewContext(source, {
      require: name => name === 'node:fs' ? { mkdirSync() {}, writeFileSync(_path, data) { report = JSON.parse(data); } } : require(name),
      process: { env: { BUSINESS_AUDIT_STEPS_JSON: JSON.stringify(steps) }, exit(code) { exitCode = code; } },
      console: { log() {}, error() {} },
    });
    assert.equal(report.summary.expected, ids.length);
    assert.equal(report.summary.failed, outcome === 'success' ? 0 : 1);
    assert.equal(exitCode, outcome === 'success' ? 0 : 1);
    assert.equal(report.audits.filter(item => item.id !== 'browser_fonts').every(item => item.status === 'passed'), true);
  }
});

test('partial fulfillment audit is independent and fatal at aggregation, without claiming the 37 obligations', () => {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, 'enterprise-cloud-business-audit-summary-v1.cjs'), 'utf8');
  const ids = [...source.matchAll(/\['([a-z0-9_]+)',/g)].map(match => match[1]).filter(id => id !== 'round2_business');
  assert(ids.includes('sales_partial_fulfillment'));
  for (const outcome of ['failure', 'skipped', 'cancelled', 'success']) {
    const steps = Object.fromEntries(ids.map(id => [id, { outcome: 'success', conclusion: 'success' }]));
    steps.sales_partial_fulfillment = { outcome, conclusion: 'success' };
    let report; let exitCode = 0;
    vm.runInNewContext(source, {
      require: name => name === 'node:fs' ? { mkdirSync() {}, writeFileSync(_path, data) { report = JSON.parse(data); } } : require(name),
      process: { env: { BUSINESS_AUDIT_STEPS_JSON: JSON.stringify(steps) }, exit(code) { exitCode = code; } },
      console: { log() {}, error() {} },
    });
    assert.equal(exitCode, outcome === 'success' ? 0 : 1);
    assert.equal(report.summary.failed, outcome === 'success' ? 0 : 1);
  }
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/enterprise-cloud-sandbox.yml'), 'utf8');
  assert.match(workflow, /id: sales_partial_fulfillment[\s\S]{0,170}always\(\)[\s\S]{0,160}continue-on-error: true/);
  assert.match(workflow, /run: node \.\/scripts\/sales-partial-fulfillment-audit-v1.cjs/);
  assert.equal(validateCatalog(catalog).length, 37);
});

test('unsaved regression forces the real focus race and preserves all confirmation checks', () => {
  const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
  const source = read('unsaved-changes-browser-audit-v1.cjs');
  assert.match(read('../app/useDialogFocus.ts'), /dialog\.contains\(document\.activeElement\)/);
  assert.match(source, /String\(callback\)\.includes\('data-autofocus'\)/);
  assert.match(source, /addEventListener\('focus',[\s\S]{0,160}\.release\(\)/);
  assert.match(source, /notesPreserved, 'delayed dialog focus stole/);
  assert.match(source, /notes input was redirected into customer search/);
  assert.match(source, /const dismissDialog = answerNextDialog\(page, false\)/);
  assert.match(source, /const acceptDialog = answerNextDialog\(page, true\)/);
  const runner = read('enterprise-round2-local-v1.cjs');
  assert.match(runner, /\['unsaved-focus', 'scripts\/unsaved-changes-browser-audit-v1.cjs'/);
  assert.match(runner, /assert\.equal\(proof\.dialogs\.length, 16\)/);
});

test('partial receipt valuation uses actual voucher history and replays fractional-cost evidence without expanding acceptance', () => {
  const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
  const receipt = read('../backend/src/services/procurement-receipt.service.ts');
  assert.match(receipt, /l\.source_ref = e\.entry_no/);
  assert.doesNotMatch(receipt, /LEFT JOIN inventory_cost_ledgers[^`]*l\.batch_id = b\.id/);
  assert.match(receipt, /readPostedPurchaseReceiptCost\(tx, order, totals\.acceptedQuantity\)/);
  assert.match(receipt, /resolveReceiptCostAmount\(order, acceptedQuantity, totals\.acceptedQuantity, postedCostBefore\)/);
  assert.match(read('lib/enterprise-round2-procurement.cjs'), /await purchaseReceiptCostProbe\(/);
  assert.match(read('lib/enterprise-round2-procurement.cjs'), /\[0\.17, 0\.16, 0\.17, 0\.17, 0\.16, 0\.17\]/);
  assert.match(read('enterprise-round2-audit-v1.cjs'), /ROUND2_ONLY_CHECK === 'po-stale-edit-conflict'/);
  assert.equal(validateCatalog(catalog).length, 37);
});

test('purchase source freezing is revision-bound, nullable for unconfirmed history, and cannot fake the full QC/AP obligation', () => {
  const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
  const revision = read('../backend/src/services/procurement-revision.service.ts');
  assert.match(revision, /purchaseGovernanceSnapshots\(\{ \.\.\.binding, revision: before\.revision \+ 1 \}/);
  assert.match(revision, /\.\.\.valuation, \.\.\.governance/);
  const domain = read('../backend/src/domain/purchase-governance.ts');
  assert.match(domain, /terms === undefined \? null/);
  assert.match(domain, /plan === undefined \? null/);
  assert.match(domain, /prorateMoney\(amountNative, 1, bound\.exchangeRate\)/);
  assert.match(read('lib/enterprise-round2-procurement.cjs'), /await purchaseGovernanceProbe\(/);
  // Source freezing alone is still not acceptance. The original obligation is
  // now executable only through actual API + four-role browser + raw verifier.
  const runner = read('enterprise-round2-audit-v1.cjs');
  assert.match(runner, /purchaseQualityPayablesApiProbe\(/);
  assert.match(runner, /await purchaseQualityPayablesBrowser\(/);
  assert.match(runner, /verifyPurchaseQualityBrowserProof\(browser\)/);
  assert.match(runner, /runner\.run\('purchase-partial-receipt-qc-payables', purchaseQualityPayables/);
  assert.match(read('lib/purchase-quality-payables-api-proof.cjs'), /failed_audit_rolls_back_payment/);
  assert.match(read('lib/purchase-quality-payables-browser-proof.cjs'), /assert\.deepEqual\(e\.errors, \[\]\)/);
  assert.equal(validateCatalog(catalog).length, 37);
});

const { createShippingAuditData } = require('./lib/shipping-browser-audit-fixtures.cjs');
const { createLinkedShipment, seedShipmentStock, verifyShippingIssue } = require('./lib/shipping-browser-data-helpers.cjs');
const fixtureOptions = () => ({
  data: { ...createShippingAuditData('contract'), materialId: 1 },
  report: { linkedShipment: { shipmentNo: 'SHP-contract' } },
  unwrapList: payload => payload.json.data,
  timebox: async (_page, _name, _timeout, action) => action(),
  timeouts: { api: 1000, readBack: 1000 },
});

function linkedFixtureOptions() {
  const options = fixtureOptions();
  options.report.order = { id: '7', customerId: '8' };
  const order = { id: 7, customerId: 8, items: [
    { id: 91, materialId: 1, productName: options.data.linkedProduct, quantity: 12, unit: ' KG ' },
    { id: 92, materialId: 2, productName: 'unrelated', quantity: 500, unit: 'kg' },
    { id: 93, materialId: 1, productName: 'different unit', quantity: 500, unit: 'L' },
  ] };
  const calls = [];
  options.apiFetch = async (_page, route, request) => {
    calls.push({ route, request });
    if (route === '/orders/7') return { ok: true, json: { data: order } };
    assert.equal(route, '/shipping');
    return { ok: true, json: { data: { id: 10, shipmentNo: 'SHP-contract', ...request.data } } };
  };
  return { options, order, calls };
}

test('shipping fixture binds a persisted material/unit line before POST, never a display-name guess', async () => {
  const { options, order, calls } = linkedFixtureOptions();
  options.data.linkedProduct = 'not the persisted canonical name';
  await createLinkedShipment(options);
  assert.deepEqual(calls.map(call => call.route), ['/orders/7', '/shipping']);
  const submitted = calls[1].request.data;
  assert.equal(submitted.orderItemId, 91);
  assert.equal(submitted.productName, order.items[0].productName);
  assert.equal(submitted.materialId, 1);
  assert.equal(submitted.quantity, 12);
  assert.equal(submitted.unit, 'kg');
  assert.equal(options.report.order.orderItemId, '91');
  assert.equal(options.report.linkedShipment.orderItemId, '91');
});

test('shipping fixture rejects absent, ambiguous, cross-unit and oversized lines without POST', async () => {
  const cases = [
    order => { order.items = []; },
    order => { order.items.push({ ...order.items[0], id: 94 }); },
    order => { delete order.items[0].id; },
    order => { order.items[0].materialId = null; },
    order => { order.items[0].unit = 'L'; },
    order => { order.items[0].quantity = 6; },
    order => { order.items[0].quantity = 'not a quantity'; },
    order => { order.customerId = 9; },
    order => { order.id = 9; },
    (_order, options) => { options.data.quantity = 0; },
    (_order, options) => { options.data.quantity = NaN; },
    (_order, options) => { options.data.quantity = 13; },
  ];
  for (const mutate of cases) {
    const { options, order, calls } = linkedFixtureOptions();
    mutate(order, options);
    await assert.rejects(createLinkedShipment(options), /shipping (fixture|order line readback)/);
    assert.deepEqual(calls.map(call => call.route), ['/orders/7']);
  }
});

test('shipping fixture rejects failed order readback and missing persisted shipment linkage', async () => {
  const failedRead = linkedFixtureOptions();
  failedRead.options.apiFetch = async () => ({ ok: false, status: 503 });
  await assert.rejects(createLinkedShipment(failedRead.options), /line readback failed: 503/);
  const missingLink = linkedFixtureOptions();
  const originalFetch = missingLink.options.apiFetch;
  missingLink.options.apiFetch = async (...args) => {
    const result = await originalFetch(...args);
    if (args[1] === '/shipping') delete result.json.data.orderItemId;
    return result;
  };
  await assert.rejects(createLinkedShipment(missingLink.options), /did not preserve/);
  assert.equal(missingLink.options.report.order.orderItemId, undefined);
});

test('shipping browser fixture seeds explicit carrying cost through the stock API', async () => {
  const options = fixtureOptions();
  let seeded;
  options.apiFetch = async (_page, route, request) => {
    if (route === '/warehouses') return { ok: true, json: { data: [{ locations: [{ id: 2, code: 'LOC-FG' }] }] } };
    assert.equal(route, '/warehouses/stock-balances');
    seeded = request.data;
    return { ok: true };
  };
  await seedShipmentStock(options);
  assert.equal(seeded.unitCost, 10);
  assert.equal(options.report.seededStock.costAmount, 240);
  options.data.unitCost = undefined;
  await assert.rejects(seedShipmentStock(options), /explicit nonnegative unitCost/);
});

test('shipping browser readback rejects quantity-only and duplicate cost evidence', async () => {
  const options = fixtureOptions();
  const { data } = options;
  const batch = { id: 9, productName: data.linkedProduct, batchNo: data.batchNo, stockQuantity: 12 };
  const costRow = { sourceRef: 'STK-contract', quantityDelta: -12, costAmountDelta: -120 };
  const ledger = { summary: { totalQuantityDelta: 12, currentQuantity: 12, currentCostAmount: 120 }, items: [costRow] };
  options.apiFetch = async (_page, route) => {
    let result;
    if (route.startsWith('/warehouses/stock-balances?')) result = [{ ...batch, locationCode: 'LOC-FG', quantity: 12 }];
    else if (route.startsWith('/warehouses/stock-entries?')) result = [{ sourceType: 'shipping_issue', sourceRef: 'SHP-contract', entryNo: 'STK-contract', movements: [{ ...batch, quantityDelta: -12 }] }];
    else if (route.startsWith('/assets/batches?')) result = [batch];
    else if (route === '/production/batches/9/cost-ledger?pageSize=100') result = ledger;
    else throw new Error(`Unexpected route ${route}`);
    return { ok: true, json: { data: result } };
  };
  await verifyShippingIssue(options);
  assert.equal(options.report.issueEvidence.costAmount, 120);
  ledger.summary.currentCostAmount = 240;
  await assert.rejects(verifyShippingIssue(options), /cost conservation mismatch/);
  ledger.summary.currentCostAmount = 120;
  batch.stockQuantity = 24;
  await assert.rejects(verifyShippingIssue(options), /batch quantity mismatch/);
  batch.stockQuantity = 12;
  ledger.items.push(costRow);
  await assert.rejects(verifyShippingIssue(options), /exactly one matching issue/);
});

test('PO revisions have additive database upgrade paths and explicit cloud browser coverage', () => {
  const root = path.join(__dirname, '..');
  const schema = fs.readFileSync(path.join(root, 'backend/prisma/models/procurement.prisma'), 'utf8');
  const repair = fs.readFileSync(path.join(root, 'backend/src/database/runtime-schema-core-repair.ts'), 'utf8');
  const { loadMigrations } = require('./postgres-schema-migrate-v1.cjs');
  const upgrade = loadMigrations().find(item => item.id === '202609250001_purchase-order-revision');
  assert.match(schema, /revision\s+Int\s+@default\(0\)/);
  assert.match(repair, /'purchase_orders', 'revision', 'INTEGER NOT NULL DEFAULT 0'/);
  assert.match(upgrade.sql, /ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 0/);
  assert.doesNotMatch(upgrade.sql, /\b(?:DROP|DELETE|TRUNCATE)\b/i);
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/enterprise-cloud-sandbox.yml'), 'utf8');
  assert.match(workflow, /id: round2_business[\s\S]{0,350}ROUND2_BROWSER: "true"/);
});

test('CJK raster evidence rejects tofu/blank glyphs even when DOM Chinese text is correct', () => {
  const { assertCjkRasterEvidence } = require('./lib/browser-cjk-font-guard.cjs');
  const glyphs = Array.from('采购版本变更数量审批').map((character, index) => ({ character, signature: `glyph-${index}`, inkPixels: 100 }));
  const evidence = { missingSignatures: ['tofu', 'tofu-other'], glyphs };
  assert.equal(assertCjkRasterEvidence(evidence), evidence);
  assert.throws(() => assertCjkRasterEvidence({ ...evidence, glyphs: glyphs.map(glyph => ({ ...glyph, signature: 'tofu' })) }), /missing-glyph/);
  assert.throws(() => assertCjkRasterEvidence({ ...evidence, glyphs: glyphs.map(glyph => ({ ...glyph, signature: 'same' })) }), /identical glyphs/);
  assert.throws(() => assertCjkRasterEvidence({ ...evidence, glyphs: glyphs.map(glyph => ({ ...glyph, inkPixels: 0 })) }), /blank/);
  assert.throws(() => assertCjkRasterEvidence({ ...evidence, missingSignatures: [] }), /reference signatures/);
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/enterprise-cloud-sandbox.yml'), 'utf8');
  assert.match(workflow, /apt-get install[^\n]*fonts-noto-cjk/);
  assert.match(workflow, /id: browser_fonts\s+continue-on-error: true/);
  assert.match(fs.readFileSync(path.join(__dirname, 'enterprise-cloud-business-audit-summary-v1.cjs'), 'utf8'), /\['browser_fonts',/);
});
test('BOM freeze probes are discoverable before runtime and browser dependencies are installed', () => {
  const { bomFreezeProbe, bomHistoryBrowser } = require('./lib/enterprise-round2-bom-freeze.cjs');
  assert.equal(typeof bomFreezeProbe, 'function');
  assert.equal(typeof bomHistoryBrowser, 'function');
});

test('BOM freeze write paths and browser readback changes trigger the cumulative cloud gate', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/enterprise-cloud-sandbox.yml'), 'utf8');
  const prPaths = workflow.split('  pull_request:')[1].split('  push:')[0];
  for (const file of ['scripts/lib/enterprise-round2-bom-freeze.cjs', 'backend/src/services/production-bom-freeze*.ts',
    'backend/src/services/production-mutation.service.ts', 'backend/src/services/material-governance.service.ts',
    'backend/src/controllers/material.controller.ts', 'backend/src/controllers/production.controller.ts',
    'pages/production/ProductionWorkOrderSection.tsx']) assert(prPaths.includes(`'${file}'`), `${file} no longer triggers cloud regression`);
});
