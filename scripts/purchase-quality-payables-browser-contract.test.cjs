const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyPurchaseQualityBrowserProof } = require('./lib/purchase-quality-payables-browser-proof.cjs');
const { fixture } = require('./fixtures/purchase-quality-payables-browser-proof-fixture.cjs');
const copy = value => JSON.parse(JSON.stringify(value));

test('explicitly synthetic four-role browser contract is internally consistent, not actual execution evidence', () => assert.equal(verifyPurchaseQualityBrowserProof(fixture()), true));
for (const [label, mutate] of [
  ['QC gains priced procurement read', e => e.actors[0].permissions.push('procurement.read')],
  ['QA and QC become the same person', e => { e.actors[1].id = e.actors[0].id; }],
  ['browser auth profile differs from actual login', e => { e.browserProfiles[0].actual.role = 'admin'; }],
  ['one permission denial is omitted', e => e.denied.pop()],
  ['denied write changes stock', e => { e.afterDenied.balances[0].quantity = 3; }],
  ['QC-only secretly fetches prices', e => e.browserRequests.push({ job: 'qc', method: 'GET', endpoint: '/api/procurement/orders' })],
  ['QC read DTO leaks AP through nested data', e => { e.readbacks.quality[0].data.plan.private = { payableAmountNative: '20.02' }; }],
  ['QC audit is missing', e => { e.after.audits = e.after.audits.filter(a => a.id !== 10); }],
  ['QA evidence is rewritten', e => { e.qaWrite.body.data.review.inspectionHash = '0'.repeat(64); }],
  ['unknown ACK rotates request key on refresh', e => { e.lostAck.intentAtReadbackDelivery.key = 'synthetic-another-key'; }],
  ['unknown ACK allows changing money', e => { e.lostAck.disabledFieldCount = 6; }],
  ['no actual reload', e => { e.lostAck.realReload = false; }],
  ['intent clears before independent readback', e => { e.lostAck.intentAtReadbackDelivery = null; }],
  ['refresh issues a second payment POST', e => e.browserRequests.push(copy(e.browserRequests[0]))],
  ['readback changes original opaque bank reference', e => { e.lostAck.independentReadback.body.data.payments[0].submission.payment.paymentAccountRef = 'GUESS'; }],
  ['FX payment base cents drift', e => { e.lostAck.ownerResponse.body.data.submission.payment.baseAmount = '14.28'; }],
  ['supplier payment reposts inventory costs', e => { e.after.costs[0].costAmountDelta = 145; }],
  ['supplier payment also posts customer AR', e => e.after.customerPayments.push({ id: 1 })],
  ['verified payment is duplicated in raw database', e => e.after.payments.push(copy(e.after.payments[0]))],
  ['node two reads different AP remaining', e => { e.readbacks.payments[1].data.outstandingAmountNative = '18.01'; }],
  ['draft falsely rendered as paid', e => { e.lostAck.unknownScreenshot.amounts[1].text = '2.00 USD 14.29 CNY账面'; }],
  ['correct API but incorrect financial UI', e => { e.screenshots[2].amounts[2].text = '19.02 USD 135.85 CNY账面'; }],
  ['business POST abort mislabeled telemetry', e => e.recoveryCancelledTelemetry.push({ job: 'recorder', method: 'POST', endpoint: '/api/procurement/receipts/2/payments', message: 'net::ERR_ABORTED', duringForcedReload: true, observedNs: '3' })],
  ['unrelated console network error swallowed', e => e.expectedTransportErrors.push({ job: 'recorder', kind: 'console', endpoint: '/api/other', locationUrl: 'http://localhost/api/other', message: 'net::ERR_CONNECTION_FAILED' })],
  ['blocked screenshot', e => { e.screenshots[2].dialogCount = 1; }],
  ['missing Chinese glyphs', e => { e.screenshots[0].font.glyphs[0].inkPixels = 0; }],
  ['unexpected console error hidden', e => e.errors.push({ job: 'qa', kind: 'console', message: 'Unexpected error' })],
]) test(`browser proof rejects ${label}`, () => { const e = fixture(); mutate(e); assert.throws(() => verifyPurchaseQualityBrowserProof(e)); });
