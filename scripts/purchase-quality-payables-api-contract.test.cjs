const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyPurchaseQualityPayablesApiProof } = require('./lib/purchase-quality-payables-api-proof.cjs');
const { purchaseQualityPayablesApiProofFixture: fixture } = require('./fixtures/purchase-quality-payables-api-proof-fixture.cjs');

for (const provider of ['sqlite', 'postgresql']) test(`synthetic ${provider} API verifier contract, not execution or cloud acceptance`, () => {
  const input = fixture(provider), before = JSON.stringify(input);
  assert.deepEqual(verifyPurchaseQualityPayablesApiProof(input), { receipts: 2, acceptedQuantity: 3, payableAmountNative: '30.03', payableAmountBase: '214.50',
    verifiedPayments: 3, cancelledDrafts: 1, paidAmountNative: '10.01', paidAmountBase: '71.50', requestCount: 45 });
  assert.equal(JSON.stringify(input), before, 'The verifier must be read-only');
});

test('typed raw database decimals and dates are checked independently of their JSON representation', () => {
  const e = fixture('postgresql');
  for (const row of e.finalDatabase.rows) {
    row.amountNative = { toJSON: () => String(row.id === 40 || row.id === 41 ? 1 : 8.01) };
    const base = row.baseAmount; row.baseAmount = { toJSON: () => String(base) }; row.date = new Date(row.date); row.createdAt = new Date(row.createdAt);
    if (row.verifiedAt) row.verifiedAt = new Date(row.verifiedAt);
  }
  for (const receipt of e.unrelatedBefore.receipts) {
    receipt.payableAmountNative = String(Number(receipt.payableAmountNative)); receipt.payableAmountBase = String(Number(receipt.payableAmountBase));
  }
  e.unrelatedAfter = JSON.parse(JSON.stringify(e.unrelatedBefore));
  assert.equal(verifyPurchaseQualityPayablesApiProof(e).verifiedPayments, 3);
});

test('race evidence follows each node identity, not nondeterministic response-completion order', () => {
  const e = fixture();
  [e.requests[3], e.requests[4]] = [e.requests[4], e.requests[3]];
  [e.requests[19], e.requests[20]] = [e.requests[20], e.requests[19]];
  [e.requests[43], e.requests[44]] = [e.requests[44], e.requests[43]];
  assert.equal(verifyPurchaseQualityPayablesApiProof(e).requestCount, 45);
});

test('producer requirement booleans cannot replace or veto complete original facts', () => {
  const e = fixture(); e.requirements = { passed: false, native_and_base_partial_payments_close_exactly: false };
  assert.equal(verifyPurchaseQualityPayablesApiProof(e).paidAmountBase, '71.50');
  assert.throws(() => verifyPurchaseQualityPayablesApiProof({ ...e, receiptAudits: undefined, requirements: { passed: true } }));
});

const rewrite = (row, field, change) => { const value = JSON.parse(row[field]); change(value); row[field] = JSON.stringify(value); };
for (const [label, mutate] of [
  ['summary-only API claim', e => { Object.keys(e).forEach(k => { if (k !== 'version') delete e[k]; }); e.requirements = { passed: true }; }],
  ['unknown database environment', e => { e.provider = 'mysql'; }],
  ['missing source audit rows', e => { delete e.receiptAudits; }],
  ['source author approving own quote', e => { e.setup.approverId = e.setup.buyerId; }],
  ['approval audit from another actor', e => { e.receiptAudits[1].userId = 999; }],
  ['mutable specification source', e => { rewrite(e.receiptAudits[0], 'details', value => { value.source.incomingQualityHash = '0'.repeat(64); }); }],
  ['missing receipt audit', e => { e.receiptAudits.pop(); }],
  ['rewritten receipt journal', e => { rewrite(e.unrelatedBefore.receipts[0], 'submissionJson', value => { value.facts.receivedBy = 999; }); }],
  ['same supplier lot merging internal batch', e => { e.receipt2.submission.receipt.batchId = e.receipt1.submission.receipt.batchId; }],
  ['zero liability before QA', e => { e.preQA.payableAmountNative = '0.00'; }],
  ['unreleased payment eligibility', e => { e.preQA.paymentEligibility.eligible = true; }],
  ['fractional cent in raw payable', e => { e.unrelatedBefore.receipts[0].payableAmountBase = '71.501'; }],
  ['missing real physical receipt', e => { e.unrelatedBefore.entries = []; }],
  ['physical movement assigned to wrong voucher', e => { e.unrelatedBefore.movements[0].entryId = 999; }],
  ['inventory cost tail drift', e => { e.unrelatedBefore.costs[0].costAmountDelta = 71.51; }],
  ['supplier payment reposts inventory', e => { e.unrelatedAfter.movements.push({ quantityDelta: 1 }); }],
  ['supplier payment reposts customer AR', e => { e.unrelatedAfter.customerPayments.push({ amount: 10.01 }); }],
  ['two draft owners instead of immutable replay', e => { e.concurrentDraft[1].json.data.replayed = false; }],
  ['two verifier owners', e => { e.concurrentVerify[1].json.data.replayed = false; }],
  ['both race responses from one node', e => { e.requests[4].instance = 0; }],
  ['missing failed QC lifecycle', e => { e.qualityStages.shift(); }],
  ['failed QC not quarantined', e => { e.qualityStages[0].batch.qualityStatus = 'released'; }],
  ['retest automatically released', e => { e.qualityStages[1].batch.qualityStatus = 'released'; }],
  ['old QA acknowledgement releasing newer hold', e => { e.qualityStages[4].batch.qualityStatus = 'released'; }],
  ['QC changes physical stock', e => { e.qualityStages[2].batch.stockQuantity = 0; }],
  ['changed original QC measurement row', e => { rewrite(e.qualityStages[2].checks[1], 'measurementsJson', value => { value[0].measuredNumeric = '8.1'; }); }],
  ['missing independent QA raw audit', e => { e.qualityStages[2].audits.pop(); }],
  ['raw QA timestamp differs from immutable review', e => { e.qualityStages[2].checks[1].reviewedAt = '2026-10-15T00:00:00.000Z'; }],
  ['raw QA reason differs from immutable review', e => { e.qualityStages[2].checks[1].reviewNote = 'changed reason'; }],
  ['unreviewed QC has a fake review timestamp', e => { e.qualityStages[1].checks[1].reviewedAt = '2026-10-15T00:00:00.000Z'; }],
  ['unreviewed QC has a fake review note', e => { e.qualityStages[1].checks[1].reviewNote = 'not reviewed'; }],
  ['final readbacks duplicated one node', e => { e.requests[44].instance = 0; }],
  ['rewritten original QA audit', e => { rewrite(e.qualityStages[5].audits[1], 'details', value => { value.reviewHash = '0'.repeat(64); }); }],
  ['QC price leak', e => { e.qualityReadback.price = 10.01; }],
  ['historical corruption silently becoming zero', e => { e.unknownCandidate.outstandingAmountNative = '0.00'; }],
  ['original payment acknowledgement changed by retest', e => { e.originalPaymentReplay.verification.qualityRevision = 3; }],
  ['audit fault left verified payment committed', e => { e.afterAuditFault.rows[3].status = 'verified'; }],
  ['cancelled draft erased instead of retained', e => { e.finalDatabase.rows.splice(2, 1); }],
  ['duplicate verified payment journal', e => { e.finalDatabase.rows.push(e.finalDatabase.rows[0]); }],
  ['extra financial audit', e => { e.finalDatabase.audits.push({ ...e.finalDatabase.audits[0], id: 999 }); }],
  ['wrong payment base allocation', e => { e.finalDatabase.rows[1].baseAmount = 7.14; }],
  ['rewritten immutable registration key', e => { e.finalDatabase.rows[0].requestKey = 'different-key'; }],
  ['bank account case folded', e => { e.finalDatabase.rows[0].paymentAccountRef = e.finalDatabase.rows[0].paymentAccountRef.toLowerCase(); }],
  ['payment audit fingerprint changed', e => { rewrite(e.finalDatabase.audits[0], 'details', value => { value.fingerprint = '0'.repeat(64); }); }],
  ['cancelled draft displayed as paid', e => { e.finalReadbacks[0].paidAmountNative = '18.02'; }],
  ['other node sees different outstanding', e => { e.finalReadbacks[1].outstandingAmountNative = '0.01'; }],
  ['missing real HTTP operation', e => { e.requests.pop(); }],
  ['new key after unknown acknowledgement', e => { e.requests[3].key = 'synthetic-new-key'; }],
  ['unreleased payment was accepted', e => { e.requests[29].status = 200; e.requests[29].json.success = true; }],
  ['duplicate bank reference accepted on another receipt', e => { e.requests[42].status = 201; e.requests[42].json.success = true; }],
  ['overpayment not exercised', e => { e.requests[41].data.amountNative = 0; }],
]) test(`independent API proof rejects ${label}`, () => {
  const e = fixture(); mutate(e); assert.throws(() => verifyPurchaseQualityPayablesApiProof(e));
});
