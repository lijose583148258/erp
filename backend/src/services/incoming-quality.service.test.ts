import { Prisma } from '@prisma/client';
import { purchaseGovernanceSnapshots } from '../domain/purchase-governance';
import { buildPurchaseReceiptPayable } from '../domain/purchase-payable';
import { controlledPurchaseReceiptAuditDetails, controlledPurchaseReceiptFingerprint, normalizeControlledPurchaseReceipt } from '../domain/purchase-controlled-receipt';
import { purchaseSourceMetadata } from './procurement-source-confirmation.service';
import { submitIncomingQualityCheck, reviewIncomingQualityCheck, assertLatestIncomingQualityRelease, assertHistoricalIncomingQualityRelease, getIncomingQualityBundle } from './incoming-quality.service';

// These tests invoke real service/domain/provenance helpers with in-memory ORM
// mocks. They prove guards and write scope/order, not real DB rollback or races.
function fixture() {
  const binding = { revision: 1, supplierId: 2, materialId: 3, unit: 'kg', quantity: 10, price: 10, currency: 'CNY', exchangeRate: 1 };
  const plan = { specificationRef: 'SIGNED-SUPPLIER-SPEC', specificationRevision: 'R1', characteristics: [
    { code: 'PH', name: 'pH', valueType: 'numeric', unit: 'pH', lowerLimit: '6.5', upperLimit: '7.5', testMethod: 'Calibrated meter', required: true },
    { code: 'APPEARANCE', name: 'Appearance', valueType: 'text', unit: null, targetText: 'clear|transparent', testMethod: 'Visual', required: true },
  ] };
  const sources = purchaseGovernanceSnapshots(binding, { taxTreatment: 'none_or_third_party', supplierTaxAmount: 0,
    supplierChargesAmount: 0, evidenceRef: 'ORIGINAL-SIGNED-QUOTE' }, plan);
  const order = { id: 7, ...binding, ...sources, status: 'pending', updatedAt: new Date('2026-10-14T00:00:00Z') };
  const meta = purchaseSourceMetadata(order);
  const audits: any[] = [
    { id: 1, userId: 10, action: 'CREATE', resource: 'purchase_order', resourceId: 7,
      details: JSON.stringify({ schema: 'purchase-create/v1', after: order, source: meta }) },
    { id: 2, userId: 11, action: 'STATUS_CHANGE', resource: 'purchase_order', resourceId: 7,
      details: JSON.stringify({ schema: 'purchase-status/v2', revision: 1, from: 'pending', to: 'approved', isSourceApproval: true,
        sourceAuditId: 1, supplierPayableHash: meta.supplierPayableHash, incomingQualityHash: meta.incomingQualityHash }) },
  ];
  const batch = { id: 31, batchNo: 'PO-7-RCV-PRC-41', materialId: 3, productName: 'Raw resin', unit: 'kg', qualityStatus: 'hold', stockQuantity: 5 };
  const payable = buildPurchaseReceiptPayable({ purchaseOrderId: 7, receiptNo: 'PRC-41', supplierBatchNo: 'ACTUAL-SUPPLIER-LOT', batchNo: batch.batchNo,
    receivedBy: 12, binding, supplierPayableBasisJson: sources.supplierPayableBasisJson!, sourceAuditId: 1, approvalAuditId: 2,
    receivedQuantity: 5, receivedQuantityBefore: 0, postedAmountNativeBefore: 0, postedAmountBaseBefore: 0 });
  const facts = { purchaseOrderId: 7, receivedBy: 12, quantity: 5, acceptedQuantity: 5, rejectedQuantity: 0,
    batchNo: 'ACTUAL-SUPPLIER-LOT', receivedAt: null, discrepancyReason: null, discrepancyType: 'short_shipped', note: null, expectedRevision: 1 };
  const receipt: any = { id: 41, receiptNo: 'PRC-41', purchaseOrderId: 7, quantity: 5, acceptedQuantity: 5, rejectedQuantity: 0,
    unit: 'kg', batchNo: batch.batchNo, supplierBatchNo: facts.batchNo, batchId: batch.id, stockEntryRef: batch.batchNo,
    note: null, discrepancyReason: null, receivedBy: 12, receivedAt: new Date('2026-10-14T01:00:00Z'), createdAt: new Date('2026-10-14T01:00:01Z'),
    payableAmountNative: payable.payableAmountNative, payableAmountBase: payable.payableAmountBase, payableSnapshotJson: payable.payableSnapshotJson,
    incomingQualityPlanJson: sources.incomingQualityPlanJson, submissionKey: 'receipt-intent-41', submissionFingerprint: controlledPurchaseReceiptFingerprint(facts) };
  const frozenReceipt = normalizeControlledPurchaseReceipt(receipt);
  receipt.submissionJson = JSON.stringify({ schema: 'purchase-receipt-submission/v2', key: receipt.submissionKey,
    fingerprint: receipt.submissionFingerprint, auditId: 3, facts, receipt: frozenReceipt });
  audits.push({ id: 3, userId: 12, action: 'CREATE_RECEIPT', resource: 'purchase_order', resourceId: 7,
    details: JSON.stringify(controlledPurchaseReceiptAuditDetails(receipt.submissionKey, receipt.submissionFingerprint, frozenReceipt)) });
  const checks: any[] = [];
  const tx: any = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    purchaseOrder: { findUnique: jest.fn(() => { throw Error('No live PO/source rebinding allowed'); }) },
    purchaseReceipt: { findUnique: jest.fn(async () => ({ ...receipt, batch })), findMany: jest.fn(async () => [receipt]) },
    productBatch: { findUnique: jest.fn(async () => batch), update: jest.fn(async ({ data }) => Object.assign(batch, data)) },
    incomingQualityCheck: {
      findFirst: jest.fn(async ({ where }) => checks.filter(row => row.purchaseReceiptId === where.purchaseReceiptId
        && (where.requestKey === undefined || row.requestKey === where.requestKey)).sort((a, b) => b.revision - a.revision)[0] || null),
      findUnique: jest.fn(async ({ where }) => checks.find(row => row.id === where.id) || null),
      findMany: jest.fn(async () => [...checks].sort((a, b) => b.revision - a.revision)),
      create: jest.fn(async ({ data }) => { const row = { id: 51 + checks.length, reviewedByUserId: null, reviewedAt: null,
        reviewNote: null, decision: null, reviewJson: null, ...data }; checks.push(row); return row; }),
      update: jest.fn(async ({ where, data }) => ({ ...Object.assign(checks.find(row => row.id === where.id), data) })),
      updateMany: jest.fn(async ({ where, data }) => { const row = checks.find(item => item.id === where.id && item.status === where.status && item.revision === where.revision);
        if (!row) return { count: 0 }; Object.assign(row, data); return { count: 1 }; }),
    },
    auditLog: { findUnique: jest.fn(async ({ where }) => audits.find(row => row.id === where.id) || null),
      create: jest.fn(async ({ data }) => { const row = { id: 100 + audits.length, ...data }; audits.push(row); return row; }) },
  };
  return { tx, batch, receipt, checks, audits, sources };
}
const sample = (ph = '7.0') => ({ sampleNo: 'ACTUAL-SAMPLE-01', note: 'Physical retained sample', measurements: [
  { code: 'PH', unit: 'pH', measuredNumeric: ph, measuredText: null, instrumentNo: 'METER-001' },
  { code: 'APPEARANCE', unit: null, measuredNumeric: null, measuredText: 'Clear', instrumentNo: 'VISUAL-001' },
] });
const decision = (revision = 1, value: 'released' | 'rejected' = 'released') => ({ expectedRevision: revision, decision: value, reason: 'Independent QA reviewed retained sample and instrument evidence' });
const writes = (f: ReturnType<typeof fixture>) => [f.tx.incomingQualityCheck.create.mock.calls.length, f.tx.incomingQualityCheck.update.mock.calls.length,
  f.tx.incomingQualityCheck.updateMany.mock.calls.length, f.tx.productBatch.update.mock.calls.length, f.tx.auditLog.create.mock.calls.length];

describe('incoming receipt QC/independent QA with real domain evidence and mocked persistence', () => {
  it('proves the original release after a later hold, but refuses its altered audit or another receipt', async () => {
    const f = fixture(), first = await submitIncomingQualityCheck(f.tx, 41, sample(), 20, 'inspection-historical');
    await reviewIncomingQualityCheck(f.tx, first.inspection.id, { expectedRevision: 1, decision: 'released', reason: 'Independent first release' }, 21);
    await submitIncomingQualityCheck(f.tx, 41, sample(), 20, 'inspection-retest-02');
    expect(f.batch.qualityStatus).toBe('hold');
    expect((await assertHistoricalIncomingQualityRelease(f.tx, first.inspection.id, 41)).review.decision).toBe('released');
    await expect(assertLatestIncomingQualityRelease(f.tx, 31)).rejects.toThrow('INCOMING_QA_RELEASE_REQUIRED');
    await expect(assertHistoricalIncomingQualityRelease(f.tx, first.inspection.id, 42)).rejects.toThrow('INCOMING_QUALITY_EVIDENCE_INVALID');
    const reviewAudit = f.audits.find(row => row.action === 'REVIEW_INCOMING_QC')!;
    reviewAudit.details = '{}';
    await expect(assertHistoricalIncomingQualityRelease(f.tx, first.inspection.id, 41)).rejects.toThrow('INCOMING_QUALITY_EVIDENCE_INVALID');
    expect(f.batch.qualityStatus).toBe('hold');
  });
  it('freezes measurements, computes result, holds stock, and allocates a single auditable revision', async () => {
    const f = fixture(), out = await submitIncomingQualityCheck(f.tx, 41, sample(), 20, 'inspection-key-01');
    expect(out.replayed).toBe(false); expect(out.inspection.result).toBe('pass'); expect(out.inspection.revision).toBe(1);
    expect(f.batch.qualityStatus).toBe('hold'); expect(out.submission.inspection.measurements[0].measuredNumeric).toBe('7');
    expect(f.tx.$executeRaw.mock.calls.map((call: any[]) => call[0].join('?'))).toEqual([
      'UPDATE "purchase_orders" SET "id" = "id" WHERE "id" = ?', 'UPDATE "product_batches" SET "id" = "id" WHERE "id" = ?',
    ]);
    expect(f.tx.purchaseOrder.findUnique).not.toHaveBeenCalled();
    expect(f.receipt.payableAmountNative.equals(new Prisma.Decimal(50))).toBe(true);
    expect(f.tx.auditLog.create).toHaveBeenCalledTimes(1);
  });
  it.each(['required', 'unit', 'numeric', 'caller-result', 'unknown'])('rejects %s mismatch without business writes', async kind => {
    const f = fixture(), raw: any = sample();
    if (kind === 'required') raw.measurements.pop();
    if (kind === 'unit') raw.measurements[0].unit = 'kg';
    if (kind === 'numeric') raw.measurements[0].measuredNumeric = 'Infinity';
    if (kind === 'caller-result') raw.result = 'pass';
    if (kind === 'unknown') raw.measurements[0].code = 'UNKNOWN';
    await expect(submitIncomingQualityCheck(f.tx, 41, raw, 20, 'inspection-key-01')).rejects.toThrow();
    expect(writes(f)).toEqual([0, 0, 0, 0, 0]);
  });
  it.each(['null-AP', 'legacy-key', 'wrong-receipt-audit', 'self-approved-source', 'wrong-batch'])('does not manufacture QC provenance for %s', async kind => {
    const f = fixture();
    if (kind === 'null-AP') f.receipt.payableAmountNative = null;
    if (kind === 'legacy-key') f.receipt.submissionJson = JSON.stringify({ schema: 'purchase-receipt-submission/v1' });
    if (kind === 'wrong-receipt-audit') f.audits[2].details = '{}';
    if (kind === 'self-approved-source') f.audits[1].userId = 10;
    if (kind === 'wrong-batch') f.batch.materialId = 99;
    await expect(submitIncomingQualityCheck(f.tx, 41, sample(), 20, 'inspection-key-01')).rejects.toThrow();
    expect(writes(f)).toEqual([0, 0, 0, 0, 0]);
  });
  it('returns the original submit ACK after QA and later reinspection, without a second hold/write', async () => {
    const f = fixture(), original = await submitIncomingQualityCheck(f.tx, 41, sample(), 20, 'inspection-key-01');
    await reviewIncomingQualityCheck(f.tx, original.inspection.id, decision(), 21);
    await submitIncomingQualityCheck(f.tx, 41, sample('8'), 20, 'inspection-key-02');
    const before = writes(f), replay = await submitIncomingQualityCheck(f.tx, 41, sample('7.00'), 20, 'inspection-key-01');
    expect(replay.replayed).toBe(true); expect(replay.submission).toEqual(original.submission); expect(writes(f)).toEqual(before);
    expect(f.batch.qualityStatus).toBe('hold');
  });
  it('binds the same submit key to the original inspector and facts', async () => {
    const f = fixture(); await submitIncomingQualityCheck(f.tx, 41, sample(), 20, 'inspection-key-01'); const before = writes(f);
    await expect(submitIncomingQualityCheck(f.tx, 41, sample(), 22, 'inspection-key-01')).rejects.toThrow('KEY_CONFLICT');
    await expect(submitIncomingQualityCheck(f.tx, 41, sample('7.1'), 20, 'inspection-key-01')).rejects.toThrow('KEY_CONFLICT');
    expect(writes(f)).toEqual(before);
  });
  it('requires independent QA, latest revision and pass; rejects self-review and stale/failed releases without writes', async () => {
    const f = fixture(), first = await submitIncomingQualityCheck(f.tx, 41, sample(), 20, 'inspection-key-01');
    let before = writes(f); await expect(reviewIncomingQualityCheck(f.tx, first.inspection.id, decision(), 20)).rejects.toThrow('INDEPENDENT'); expect(writes(f)).toEqual(before);
    const second = await submitIncomingQualityCheck(f.tx, 41, sample('8'), 20, 'inspection-key-02'); before = writes(f);
    await expect(reviewIncomingQualityCheck(f.tx, first.inspection.id, decision(), 21)).rejects.toThrow('STALE');
    await expect(reviewIncomingQualityCheck(f.tx, second.inspection.id, decision(2), 21)).rejects.toThrow('FAILED'); expect(writes(f)).toEqual(before);
    expect(f.receipt.payableAmountBase.toFixed(2)).toBe('50.00'); expect(f.batch.stockQuantity).toBe(5);
  });
  it('replays an old release without releasing a newer QC hold, and refuses altered review facts/actor', async () => {
    const f = fixture(), first = await submitIncomingQualityCheck(f.tx, 41, sample(), 20, 'inspection-key-01');
    const released = await reviewIncomingQualityCheck(f.tx, first.inspection.id, decision(), 21);
    await submitIncomingQualityCheck(f.tx, 41, sample(), 20, 'inspection-key-02'); const before = writes(f);
    const replay = await reviewIncomingQualityCheck(f.tx, first.inspection.id, decision(), 21);
    expect(replay.replayed).toBe(true); expect(replay.review).toEqual(released.review); expect(f.batch.qualityStatus).toBe('hold');
    await expect(reviewIncomingQualityCheck(f.tx, first.inspection.id, { ...decision(), reason: 'Different reason' }, 21)).rejects.toThrow('DECISION_CONFLICT');
    await expect(reviewIncomingQualityCheck(f.tx, first.inspection.id, decision(), 22)).rejects.toThrow('DECISION_CONFLICT'); expect(writes(f)).toEqual(before);
  });
  it('only proven latest QA authorizes the read guard; arbitrary flag changes and legacy links do not', async () => {
    const f = fixture(); f.batch.qualityStatus = 'released';
    await expect(assertLatestIncomingQualityRelease(f.tx, 31)).rejects.toThrow('RELEASE_REQUIRED');
    const qc = await submitIncomingQualityCheck(f.tx, 41, sample(), 20, 'inspection-key-01');
    f.batch.qualityStatus = 'released'; await expect(assertLatestIncomingQualityRelease(f.tx, 31)).rejects.toThrow('RELEASE_REQUIRED');
    await reviewIncomingQualityCheck(f.tx, qc.inspection.id, decision(), 21);
    f.tx.$executeRaw.mockClear(); const before = writes(f), proof = await assertLatestIncomingQualityRelease(f.tx, 31);
    expect(proof.inspection.reviewedByUserId).toBe(21); expect(proof.inspection.revision).toBe(1); expect(f.tx.$executeRaw).not.toHaveBeenCalled(); expect(writes(f)).toEqual(before);
    f.receipt.batchId = null; await expect(assertLatestIncomingQualityRelease(f.tx, 31)).rejects.toThrow('HISTORY_UNRECONCILED');
  });
  it('rejects synchronized result/measurement/review tampering despite a forged released flag', async () => {
    const f = fixture(), qc = await submitIncomingQualityCheck(f.tx, 41, sample(), 20, 'inspection-key-01');
    await reviewIncomingQualityCheck(f.tx, qc.inspection.id, decision(), 21);
    const row = f.checks[0], altered = JSON.parse(row.submissionJson); altered.inspection.measurements[0].instrumentNo = 'REWRITTEN';
    row.measurementsJson = JSON.stringify(altered.inspection.measurements); row.submissionJson = JSON.stringify(altered);
    await expect(assertLatestIncomingQualityRelease(f.tx, 31)).rejects.toThrow();
  });
  it('rejects a QA CAS loser before audit/flag writes', async () => {
    const f = fixture(), qc = await submitIncomingQualityCheck(f.tx, 41, sample(), 20, 'inspection-key-01');
    const flagCalls = f.tx.productBatch.update.mock.calls.length, auditCalls = f.tx.auditLog.create.mock.calls.length;
    f.tx.incomingQualityCheck.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(reviewIncomingQualityCheck(f.tx, qc.inspection.id, decision(), 21)).rejects.toThrow('DECISION_CONFLICT');
    expect(f.tx.productBatch.update).toHaveBeenCalledTimes(flagCalls); expect(f.tx.auditLog.create).toHaveBeenCalledTimes(auditCalls);
  });
  it('propagates audit failure instead of returning a false committed ACK (mock is not a rollback proof)', async () => {
    const f = fixture(); f.tx.auditLog.create.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(submitIncomingQualityCheck(f.tx, 41, sample(), 20, 'inspection-key-01')).rejects.toThrow('audit unavailable');
    expect(f.tx.incomingQualityCheck.update).not.toHaveBeenCalled();
  });
  it('QC read-back has no commercial/AP price leak and verifies frozen facts without live PO rebind', async () => {
    const f = fixture(); await submitIncomingQualityCheck(f.tx, 41, sample(), 20, 'inspection-key-01');
    const bundle = await getIncomingQualityBundle(f.tx, 41), json = JSON.stringify(bundle);
    expect(bundle.plan.specificationRevision).toBe('R1'); expect(bundle.qualityChecks[0].measurements).toHaveLength(2);
    for (const word of ['payableAmount', 'amountNative', 'price', 'supplierPayableBasis', 'submissionKey', 'fingerprint']) expect(json).not.toContain(word);
    expect(f.tx.purchaseOrder.findUnique).not.toHaveBeenCalled();
  });
});
