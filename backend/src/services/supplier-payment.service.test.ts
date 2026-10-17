jest.mock('./purchase-receipt-evidence.service', () => ({ requireCommittedPurchaseReceipt: jest.fn(async () => ({})) }));
jest.mock('./procurement-source-confirmation.service', () => ({ resolveReceiptApprovedSources: jest.fn(async () => ({})) }));
jest.mock('./incoming-quality.service', () => ({ assertLatestIncomingQualityRelease: jest.fn(), assertHistoricalIncomingQualityRelease: jest.fn() }));
jest.mock('../utils/raw-sql-compat', () => ({ executeRawCompat: jest.fn((tx: any, sql: string, ...args: unknown[]) => tx.$executeRawUnsafe(sql, ...args)) }));
import { Prisma } from '@prisma/client';
import { AppError, ErrorCode } from '../middleware/errorHandler';
import { freezeSupplierPayableBasis } from '../domain/purchase-governance';
import { buildPurchaseReceiptPayable } from '../domain/purchase-payable';
import { supplierPaymentHash, supplierPaymentSubmissionAudit, supplierPaymentDecisionAudit } from '../domain/supplier-payment';
import { registerSupplierPaymentSchema, cancelSupplierPaymentSchema } from '../validators/supplier-payment';
import { registerDraft, verifySupplierPayment, cancelSupplierPayment, getSupplierPaymentBundle } from './supplier-payment.service';
import { assertLatestIncomingQualityRelease, assertHistoricalIncomingQualityRelease } from './incoming-quality.service';
import { requireCommittedPurchaseReceipt } from './purchase-receipt-evidence.service';
import { resolveReceiptApprovedSources } from './procurement-source-confirmation.service';

// ORM/control-flow tests only. Actual database uniqueness/rollback and two-node
// lock behavior are the enterprise chain's responsibility, not this fake store.
function fixture() {
  jest.clearAllMocks(); (requireCommittedPurchaseReceipt as jest.Mock).mockResolvedValue({});
  (resolveReceiptApprovedSources as jest.Mock).mockResolvedValue({});
  const binding = { revision: 1, supplierId: 2, materialId: 3, unit: 'kg', quantity: 1, price: 100, currency: 'USD', exchangeRate: 100 / 1.01 };
  const payable = buildPurchaseReceiptPayable({ purchaseOrderId: 4, receiptNo: 'PRC-5', supplierBatchNo: 'Supplier lot', batchNo: 'Internal lot', receivedBy: 8,
    binding, supplierPayableBasisJson: JSON.stringify(freezeSupplierPayableBasis(binding,
      { taxTreatment: 'none_or_third_party', supplierTaxAmount: 0, supplierChargesAmount: 0, evidenceRef: 'Actual supplier quote' })),
    sourceAuditId: 90, approvalAuditId: 91, receivedQuantity: 1, receivedQuantityBefore: 0, postedAmountNativeBefore: 0, postedAmountBaseBefore: 0 });
  const receipt = { id: 5, purchaseOrderId: 4, receiptNo: 'PRC-5', supplierBatchNo: 'Supplier lot', batchNo: 'Internal lot', receivedBy: 8,
    acceptedQuantity: 1, batchId: 6, incomingQualityPlanJson: 'QC source validated by mocked boundary',
    payableAmountNative: payable.payableAmountNative, payableAmountBase: payable.payableAmountBase, payableSnapshotJson: payable.payableSnapshotJson,
    submissionJson: 'Receipt commit validated by mocked boundary' };
  const rows: any[] = [], audits: any[] = [];
  const copy = (row: any) => row ? { ...row } : null;
  const matches = (row: any, where: any) => Object.entries(where).every(([key, value]: any) => value?.not ? row[key] !== value.not : row[key] === value);
  const tx = { $executeRawUnsafe: jest.fn(async (_sql: string, ..._values: unknown[]) => 1), purchaseReceipt: { findUnique: jest.fn(async () => receipt) },
    supplierPayment: {
      findFirst: jest.fn(async ({ where }: any) => copy(rows.find(row => matches(row, where)))),
      findUnique: jest.fn(async ({ where }: any) => copy(rows.find(row => row.id === where.id))),
      findMany: jest.fn(async ({ where }: any) => rows.filter(row => row.purchaseReceiptId === where.purchaseReceiptId).map(copy)),
      create: jest.fn(async ({ data }: any) => {
        const row = { ...data, id: rows.length + 1, amountNative: new Prisma.Decimal(data.amountNative), baseAmount: new Prisma.Decimal(data.baseAmount),
          createdAt: new Date('2026-10-14T00:00:00.000Z'), verifiedByUserId: null, verifiedAt: null, verificationJson: null };
        rows.push(row); return copy(row);
      }),
      update: jest.fn(async ({ where, data }: any) => { const row = rows.find(r => r.id === where.id); Object.assign(row, data); return copy(row); }),
      updateMany: jest.fn(async ({ where, data }: any) => { const row = rows.find(r => matches(r, where)); if (!row) return { count: 0 }; Object.assign(row, data); return { count: 1 }; }),
    }, auditLog: {
      create: jest.fn(async ({ data }: any) => { const row = { id: 1000 + audits.length, ...data }; audits.push(row); return copy(row); }),
      findUnique: jest.fn(async ({ where }: any) => copy(audits.find(a => a.id === where.id))),
    } };
  (assertLatestIncomingQualityRelease as jest.Mock).mockResolvedValue({ receipt, inspection: { id: 700, revision: 2, reviewedByUserId: 300 } });
  (assertHistoricalIncomingQualityRelease as jest.Mock).mockResolvedValue({ receipt, inspection: { id: 700, revision: 2, reviewedByUserId: 300 } });
  const facts = (amountNative = 100, transaction = 'Bank-Flow-A') => ({ amountNative, currency: 'USD', method: 'bank_transfer' as const,
    date: '2026-10-14', paymentAccountRef: 'Finance-account-A', externalTransactionRef: transaction, evidenceRef: 'Actual bank evidence', note: 'Supplier settlement' });
  return { tx, rows, audits, receipt, facts };
}
test('committed payment replay checks its original QA evidence, not a later hold or a substituted reviewer', async () => {
  const f = fixture(), draft = await registerDraft(f.tx as any, 5, f.facts(), 200, 'payment-original-qa');
  const original = await verifySupplierPayment(f.tx as any, draft.payment.id, 201);
  (assertLatestIncomingQualityRelease as jest.Mock).mockRejectedValue(new AppError('INCOMING_QA_RELEASE_REQUIRED', 409, ErrorCode.CONFLICT));
  expect((await verifySupplierPayment(f.tx as any, draft.payment.id, 201)).verification).toEqual(original.verification);
  expect(assertHistoricalIncomingQualityRelease).toHaveBeenCalledWith(f.tx, 700, 5);
  (assertHistoricalIncomingQualityRelease as jest.Mock).mockResolvedValue({ inspection: { revision: 2, reviewedByUserId: 999 } });
  await expect(getSupplierPaymentBundle(f.tx as any, 5)).rejects.toThrow('SUPPLIER_PAYMENT_HISTORY_UNRECONCILED');
  (assertHistoricalIncomingQualityRelease as jest.Mock).mockRejectedValue(new AppError('INCOMING_QUALITY_EVIDENCE_INVALID', 409, ErrorCode.CONFLICT));
  await expect(verifySupplierPayment(f.tx as any, draft.payment.id, 201)).rejects.toThrow('INCOMING_QUALITY_EVIDENCE_INVALID');
});

test('pre-QA proposal freezes native/base facts and an audit, without paid effect or QA gate', async () => {
  const f = fixture(); (assertLatestIncomingQualityRelease as jest.Mock).mockRejectedValue(new AppError('INCOMING_QA_RELEASE_REQUIRED', 409));
  const draft = await registerDraft(f.tx as any, 5, f.facts(), 10, 'request-key-one');
  expect(draft.replayed).toBe(false); expect(draft.payment.status).toBe('draft'); expect(draft.payment.baseAmount).toBe('1.01');
  expect(assertLatestIncomingQualityRelease).not.toHaveBeenCalled(); expect(f.audits.map(a => a.action)).toEqual(['SUPPLIER_PAYMENT_DRAFTED']);
  const read = await getSupplierPaymentBundle(f.tx as any, 5);
  expect(read.paidAmountNative).toBe('0.00'); expect(read.outstandingAmountNative).toBe('100.00');
  expect(read.paymentEligibility).toEqual({ eligible: false, reason: 'INCOMING_QA_RELEASE_REQUIRED' });
});
test('same actor/key/facts replay does not take a write lock or generate another payment/audit', async () => {
  const f = fixture(), first = await registerDraft(f.tx as any, 5, f.facts(), 10, 'request-key-one'); f.tx.$executeRawUnsafe.mockClear();
  expect((await registerDraft(f.tx as any, 5, f.facts(), 10, 'request-key-one')).submission).toEqual(first.submission);
  expect(f.tx.$executeRawUnsafe).not.toHaveBeenCalled(); expect(f.rows).toHaveLength(1); expect(f.audits).toHaveLength(1);
  await expect(registerDraft(f.tx as any, 5, f.facts(99), 10, 'request-key-one')).rejects.toThrow('KEY_CONFLICT');
  await expect(registerDraft(f.tx as any, 5, f.facts(), 11, 'request-key-one')).rejects.toThrow('KEY_CONFLICT');
});
test('same-key owner is rechecked after PO lock, not inserted again after a raced first read', async () => {
  const f = fixture(), first = await registerDraft(f.tx as any, 5, f.facts(), 10, 'request-key-one');
  const original = f.tx.supplierPayment.findFirst.getMockImplementation()!;
  f.tx.supplierPayment.findFirst.mockResolvedValueOnce(null).mockImplementation(original);
  expect((await registerDraft(f.tx as any, 5, f.facts(), 10, 'request-key-one')).submission).toEqual(first.submission);
  expect(f.rows).toHaveLength(1); expect(f.audits).toHaveLength(1);
});
test('independent verification takes PO then batch locks and only one payment effect', async () => {
  const f = fixture(), draft = await registerDraft(f.tx as any, 5, f.facts(), 10, 'request-key-one'); f.tx.$executeRawUnsafe.mockClear();
  await expect(verifySupplierPayment(f.tx as any, draft.payment.id, 10)).rejects.toThrow('SELF_VERIFY');
  const verified = await verifySupplierPayment(f.tx as any, draft.payment.id, 11);
  expect(verified.verification.qualityCheckId).toBe(700); expect(verified.verification.qualityRevision).toBe(2);
  expect(f.tx.$executeRawUnsafe.mock.calls.map(call => call[0])).toEqual(['UPDATE purchase_orders SET id=id WHERE id=?', 'UPDATE product_batches SET id=id WHERE id=?']);
  expect(f.audits.map(a => a.action)).toEqual(['SUPPLIER_PAYMENT_DRAFTED', 'SUPPLIER_PAYMENT_VERIFIED']);
  (assertLatestIncomingQualityRelease as jest.Mock).mockClear().mockRejectedValue(new AppError('INCOMING_QA_RELEASE_REQUIRED', 409)); f.tx.$executeRawUnsafe.mockClear();
  const replay = await verifySupplierPayment(f.tx as any, draft.payment.id, 12);
  expect(replay.replayed).toBe(true); expect(replay.verification).toEqual(verified.verification);
  expect(assertLatestIncomingQualityRelease).not.toHaveBeenCalled(); expect(f.tx.$executeRawUnsafe).not.toHaveBeenCalled();
  const read = await getSupplierPaymentBundle(f.tx as any, 5); expect(read.paidAmountNative).toBe('100.00'); expect(read.paidAmountBase).toBe('1.01');
  expect(read.outstandingAmountNative).toBe('0.00'); expect(read.paymentEligibility.eligible).toBe(false);
});
test('QA hold prevents a fresh verification before payment/audit effects', async () => {
  const f = fixture(), draft = await registerDraft(f.tx as any, 5, f.facts(), 10, 'request-key-one');
  (assertLatestIncomingQualityRelease as jest.Mock).mockRejectedValue(new AppError('INCOMING_QA_RELEASE_REQUIRED', 409));
  await expect(verifySupplierPayment(f.tx as any, draft.payment.id, 11)).rejects.toThrow('QA_RELEASE_REQUIRED');
  expect(f.rows[0].status).toBe('draft'); expect(f.tx.supplierPayment.updateMany).not.toHaveBeenCalled(); expect(f.audits).toHaveLength(1);
});
test('partial payments close both currencies using actual preceding verified amounts', async () => {
  const f = fixture(), amounts = [33.33, 33.33, 33.34], bases = [];
  for (let n = 0; n < amounts.length; n++) {
    const draft = await registerDraft(f.tx as any, 5, f.facts(amounts[n], `Flow-${n}`), 10, `request-key-${n}`); bases.push(draft.payment.baseAmount);
    await verifySupplierPayment(f.tx as any, draft.payment.id, 11);
  }
  expect(bases).toEqual(['0.34', '0.33', '0.34']);
  const read = await getSupplierPaymentBundle(f.tx as any, 5);
  expect([read.paidAmountNative, read.paidAmountBase, read.outstandingAmountNative, read.outstandingAmountBase]).toEqual(['100.00', '1.01', '0.00', '0.00']);
  await expect(registerDraft(f.tx as any, 5, f.facts(0.01, 'Other-flow'), 10, 'request-key-final')).rejects.toThrow('EXCEEDS_PAYABLE');
});
test('one unresolved proposal and active external transaction uniqueness are separate guards', async () => {
  const f = fixture(); await registerDraft(f.tx as any, 5, f.facts(50), 10, 'request-key-one');
  await expect(registerDraft(f.tx as any, 5, f.facts(25), 10, 'request-key-two')).rejects.toThrow('BANK_TRANSACTION_DUPLICATE');
  await expect(registerDraft(f.tx as any, 5, f.facts(25, 'Other-flow'), 10, 'request-key-two')).rejects.toThrow('DRAFT_PENDING');
  expect(f.rows).toHaveLength(1); expect(f.audits).toHaveLength(1);
});
test('own proposal cancellation preserves original submission and releases active reference without a refund', async () => {
  const f = fixture(), draft = await registerDraft(f.tx as any, 5, f.facts(), 10, 'request-key-one');
  await expect(cancelSupplierPayment(f.tx as any, draft.payment.id, 11, 'Incorrect proposal')).rejects.toThrow('CANCEL_SCOPE_DENIED');
  const cancelled = await cancelSupplierPayment(f.tx as any, draft.payment.id, 10, 'Incorrect proposal');
  expect(cancelled.payment.submission).toEqual(draft.submission); expect(cancelled.payment.status).toBe('cancelled');
  const replay = await cancelSupplierPayment(f.tx as any, draft.payment.id, 10, 'Incorrect proposal'); expect(replay.cancellation).toEqual(cancelled.cancellation);
  await expect(cancelSupplierPayment(f.tx as any, draft.payment.id, 10, 'Different reason')).rejects.toThrow('CANCEL_CONFLICT');
  await expect(verifySupplierPayment(f.tx as any, draft.payment.id, 11)).rejects.toThrow('CANCELLED');
  expect((await registerDraft(f.tx as any, 5, f.facts(), 10, 'request-key-two')).payment.id).toBe(2);
  expect((await getSupplierPaymentBundle(f.tx as any, 5)).paidAmountNative).toBe('0.00');
  expect(f.rows[0].submissionJson).toBe(JSON.stringify(draft.submission)); expect(f.audits.map(a => a.action)).toEqual(['SUPPLIER_PAYMENT_DRAFTED', 'SUPPLIER_PAYMENT_CANCELLED', 'SUPPLIER_PAYMENT_DRAFTED']);
});
test('verified payment cannot be cancelled or silently rewritten', async () => {
  const f = fixture(), draft = await registerDraft(f.tx as any, 5, f.facts(), 10, 'request-key-one'); await verifySupplierPayment(f.tx as any, draft.payment.id, 11);
  await expect(cancelSupplierPayment(f.tx as any, draft.payment.id, 10, 'Incorrect proposal')).rejects.toThrow('VERIFIED_CANNOT_CANCEL');
  expect(f.audits).toHaveLength(2); expect(f.rows[0].status).toBe('verified');
});
test.each(['typed amount', 'immutable JSON', 'audit receipt', 'unknown AP'])('rejects corrupt %s rather than recomputing or zero-filling', async field => {
  const f = fixture(); await registerDraft(f.tx as any, 5, f.facts(), 10, 'request-key-one');
  if (field === 'typed amount') f.rows[0].amountNative = new Prisma.Decimal(99);
  if (field === 'immutable JSON') f.rows[0].submissionJson = '{}';
  if (field === 'audit receipt') f.audits[0].details = '{}';
  if (field === 'unknown AP') f.receipt.payableSnapshotJson = null as any;
  await expect(getSupplierPaymentBundle(f.tx as any, 5)).rejects.toThrow();
  expect(f.rows).toHaveLength(1); expect(f.audits).toHaveLength(1);
});
test.each(['verifier actor', 'verified time', 'verification JSON', 'verification audit', 'reported prior payment', 'self-reported base allocation'])('rejects corrupt verified %s without zeroing paid history', async field => {
  const f = fixture(), draft = await registerDraft(f.tx as any, 5, f.facts(), 10, 'request-key-one'); await verifySupplierPayment(f.tx as any, draft.payment.id, 11);
  if (field === 'verifier actor') f.rows[0].verifiedByUserId = 10;
  if (field === 'verified time') f.rows[0].verifiedAt = new Date('2026-10-15T00:00:00.000Z');
  if (field === 'verification JSON') f.rows[0].verificationJson = '{}';
  if (field === 'verification audit') f.audits[1].details = '{}';
  if (field === 'reported prior payment') {
    const ack = JSON.parse(f.rows[0].verificationJson); ack.paidAmountNativeBefore = '1.00'; ack.paidAmountNativeAfter = '101.00';
    f.rows[0].verificationJson = JSON.stringify(ack); f.audits[1].details = JSON.stringify(supplierPaymentDecisionAudit(ack));
  }
  if (field === 'self-reported base allocation') {
    const ack = JSON.parse(f.rows[0].submissionJson); ack.payment.baseAmount = '2.02'; f.rows[0].baseAmount = new Prisma.Decimal('2.02');
    f.rows[0].submissionJson = JSON.stringify(ack); f.audits[0].details = JSON.stringify(supplierPaymentSubmissionAudit(ack));
    expect(supplierPaymentHash(ack.payment)).toHaveLength(64); // A matching self-reported hash does not prove the derived monetary basis.
  }
  await expect(getSupplierPaymentBundle(f.tx as any, 5)).rejects.toThrow();
  expect(f.rows[0].status).toBe('verified'); expect(f.audits).toHaveLength(2);
});
test('audit and global database uniqueness failures propagate, never caught inside an aborted transaction', async () => {
  for (const which of ['create', 'audit']) {
    const f = fixture(), error = Object.assign(new Error('Injected failure'), { code: which === 'create' ? 'P2002' : 'AUDIT_FAILURE' });
    if (which === 'create') f.tx.supplierPayment.create.mockRejectedValue(error);
    else f.tx.auditLog.create.mockRejectedValue(error);
    await expect(registerDraft(f.tx as any, 5, f.facts(), 10, 'request-key-one')).rejects.toBe(error);
    expect(f.tx.supplierPayment.update).not.toHaveBeenCalled();
  }
});
test('read-only eligibility propagates unexpected database failures instead of hiding them as QA hold', async () => {
  for (const error of [new Error('Database unavailable'), new AppError('DATABASE_FAILED', 500, ErrorCode.DATABASE_ERROR),
    new AppError('UNKNOWN_CONFLICT', 409, ErrorCode.CONFLICT)]) {
    const f = fixture(); (assertLatestIncomingQualityRelease as jest.Mock).mockRejectedValue(error);
    await expect(getSupplierPaymentBundle(f.tx as any, 5)).rejects.toBe(error); expect(f.tx.$executeRawUnsafe).not.toHaveBeenCalled();
  }
});
test('receipt commit and frozen independent source evidence are mandatory before payment creation', async () => {
  for (const helper of [requireCommittedPurchaseReceipt, resolveReceiptApprovedSources]) {
    const f = fixture(), error = new AppError('PURCHASE_SOURCE_HISTORY_UNRECONCILED', 409, ErrorCode.CONFLICT);
    (helper as jest.Mock).mockRejectedValue(error);
    await expect(registerDraft(f.tx as any, 5, f.facts(), 10, 'request-key-one')).rejects.toBe(error);
    expect(f.tx.supplierPayment.create).not.toHaveBeenCalled(); expect(f.tx.auditLog.create).not.toHaveBeenCalled();
  }
});
test('proposal currency and cents cannot be silently reinterpreted against receipt AP', async () => {
  const f = fixture(); await expect(registerDraft(f.tx as any, 5, { ...f.facts(), currency: 'CNY' }, 10, 'request-key-one')).rejects.toThrow('CURRENCY_MISMATCH');
  await expect(registerDraft(f.tx as any, 5, f.facts(), 10, null)).rejects.toThrow('KEY_REQUIRED');
  expect(f.rows).toHaveLength(0); expect(f.audits).toHaveLength(0);
});
test('zero-count verification claim rejects rather than returning an invented verified acknowledgment', async () => {
  const f = fixture(), draft = await registerDraft(f.tx as any, 5, f.facts(), 10, 'request-key-one');
  f.tx.supplierPayment.updateMany.mockResolvedValue({ count: 0 });
  await expect(verifySupplierPayment(f.tx as any, draft.payment.id, 11)).rejects.toThrow('STATE_CHANGED');
  expect(f.rows[0].status).toBe('draft'); // Fake store does not emulate audit rollback.
});
test('bank evidence is opaque and case-preserving; strict DTO excludes invented monetary effects', () => {
  const f = fixture(), facts = f.facts(); expect(registerSupplierPaymentSchema.parse({ ...facts, paymentAccountRef: ' Account-a ', externalTransactionRef: ' Txn-a ' }))
    .toMatchObject({ paymentAccountRef: 'Account-a', externalTransactionRef: 'Txn-a' });
  for (const patch of [{ baseAmount: 1 }, { status: 'verified' }, { amountNative: 0 }, { amountNative: NaN }, { amountNative: 1.001 },
    { currency: 'badCurrency' }, { date: '2026-02-30' }, { method: 'invented' }, { paymentAccountRef: '' }, { evidenceRef: '' }]) {
    expect(registerSupplierPaymentSchema.safeParse({ ...facts, ...patch }).success).toBe(false);
  }
  expect(cancelSupplierPaymentSchema.safeParse({ reason: 'Cancel own proposal', refundAmount: 100 }).success).toBe(false);
});
