import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import React from 'react';
import { JSDOM } from 'jsdom';
import { AppContext } from '../../app/AppContext';
import { incomingQualityBundleSchema, incomingQualityListRowSchema, type IncomingQualityBundle,
  type IncomingQualityInput, type IncomingQualityReview, type IncomingQualitySubmission } from '../../services/incomingQuality.service';
import { exactIncomingDecimal, incomingQualityIntentSlot, prepareIncomingInspectionIntent, prepareIncomingReviewIntent,
  readIncomingQualityIntent, clearIncomingQualityIntent, confirmIncomingInspection, confirmIncomingReview,
  isDefinitiveIncomingQualityRejection } from './incomingQualityIntent';
import { incomingQualityService } from '../../services/incomingQuality.service';

function storage() { const items = new Map<string, string>(); return {
  getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); },
  removeItem: (key: string) => { items.delete(key); },
}; }
const key = () => 'incoming-quality-stable-123';
const input: IncomingQualityInput = { sampleNo: 'SAMPLE-1', note: 'actual sample', measurements: [
  { code: 'PH', unit: null, measuredNumeric: '6.5000000000000020', measuredText: null, instrumentNo: 'PH-METER-12' },
  { code: 'COLOR', unit: null, measuredNumeric: null, measuredText: 'Clear', instrumentNo: 'VISUAL-12' },
] };
const date = '2026-10-14T00:00:00.000Z';
function fixture() {
  const s = storage(), intent = prepareIncomingInspectionIntent(s, '9', '7', input, key);
  assert.equal(intent.kind, 'inspection');
  if (intent.kind !== 'inspection') throw Error('fixture');
  const characteristics: IncomingQualityBundle['plan']['characteristics'] = [
    { code: 'PH', name: 'pH', valueType: 'numeric', unit: null, lowerLimit: '6.5', upperLimit: '7.5',
      targetText: null, testMethod: 'PH meter', required: true, sortOrder: 0 },
    { code: 'COLOR', name: '颜色', valueType: 'text', unit: null, lowerLimit: null, upperLimit: null,
      targetText: 'clear', testMethod: 'Visual', required: true, sortOrder: 1 },
  ];
  const measurements = characteristics.map(({ sortOrder: _sort, ...item }) => {
    const requested = intent.input.measurements.find(value => value.code === item.code)!;
    return { ...item, measuredNumeric: requested.measuredNumeric === null ? null : '6.500000000000002',
      measuredText: requested.measuredText, instrumentNo: requested.instrumentNo, result: 'pass' as const };
  });
  const inspection: IncomingQualitySubmission['inspection'] = { id: 11, checkNo: 'IQC-11', purchaseReceiptId: 7,
    revision: 1, sampleNo: input.sampleNo, measurements, note: input.note, inspectorUserId: 9,
    checkedAt: date, result: 'pass', planHash: 'a'.repeat(64) };
  const normalized = intent.input.measurements.map(item => ({ ...item,
    measuredNumeric: item.measuredNumeric === null ? null : '6.500000000000002' }));
  const ack: IncomingQualitySubmission = { schema: 'incoming-quality-submission/v1', key: intent.key, auditId: 13,
    fingerprint: createHash('sha256').update(JSON.stringify({ schema: 'incoming-quality-facts/v1', purchaseReceiptId: 7,
      inspectorUserId: 9, sampleNo: input.sampleNo, measurements: normalized, note: input.note })).digest('hex'), inspection };
  const { planHash: _planHash, ...publicInspection } = inspection;
  const bundle: IncomingQualityBundle = { receipt: { id: 7, receiptNo: 'PRC-7', purchaseOrderId: 2, quantity: 10, acceptedQuantity: 10,
    rejectedQuantity: 0, unit: 'kg', supplierBatchNo: 'SUP-LOT-7', batchNo: 'PO-2-RCV-PRC-7', batchId: 3,
    productName: '原料', receivedBy: 6, receivedAt: date, qualityStatus: 'hold' },
  plan: { specificationRef: 'SPEC-RAW', specificationRevision: 'r1', characteristics }, qualityChecks: [{ ...publicInspection,
    status: 'submitted', reviewedByUserId: null, reviewedAt: null, reviewNote: null, decision: null }] };
  return { s, intent, ack, bundle };
}
test('exact numeric comparisons preserve precision, signs, exponents and zero without Number rewriting', () => {
  for (const values of [['7.00', '+7e0'], ['.0000010', '1e-6'], ['-0', '0e123'], ['-12.300', '-123e-1'],
    ['6.5000000000000020', '6.500000000000002']]) assert.equal(exactIncomingDecimal(values[0]), exactIncomingDecimal(values[1]));
  assert.notEqual(exactIncomingDecimal('6.500000000000002'), exactIncomingDecimal('6.500000000000001'));
  for (const invalid of ['NaN', 'Infinity', '0x10', '', '1e999']) assert.throws(() => exactIncomingDecimal(invalid));
});
test('unknown ACK survives refresh with exact strings; retries never invoke another key factory', () => {
  const { s, intent } = fixture();
  assert.deepEqual(readIncomingQualityIntent(s, '9', '7'), intent);
  assert.deepEqual(prepareIncomingInspectionIntent(s, '9', '7', input, () => { throw Error('must not rotate'); }), intent);
  assert.equal(intent.kind === 'inspection' && intent.input.measurements.find(item => item.code === 'PH')?.measuredNumeric, '6.5000000000000020');
  assert.equal(readIncomingQualityIntent(s, '10', '7'), null); assert.equal(readIncomingQualityIntent(s, '9', '8'), null);
});
for (const patch of [{ sampleNo: 'OTHER' }, { note: 'OTHER' }, { measurements: input.measurements.map(item => ({ ...item, instrumentNo: 'OTHER' })) },
  { measurements: input.measurements.map(item => ({ ...item, measuredNumeric: item.code === 'PH' ? '6.5' : null })) }]) {
  test(`pending inspection facts cannot change: ${Object.keys(patch)[0]} ${JSON.stringify(patch).length}`, () => {
    const { s, intent } = fixture(); assert.throws(() => prepareIncomingInspectionIntent(s, '9', '7', { ...input, ...patch }, key));
    assert.deepEqual(readIncomingQualityIntent(s, '9', '7'), intent);
  });
}
test('corrupt, cross-actor and dropped local persistence fails before a new mutation', () => {
  const { s, intent } = fixture();
  s.setItem(incomingQualityIntentSlot('10', '7'), JSON.stringify(intent));
  assert.throws(() => readIncomingQualityIntent(s, '10', '7'));
  s.setItem(incomingQualityIntentSlot('9', '7'), '{}');
  assert.throws(() => prepareIncomingInspectionIntent(s, '9', '7', input, key));
  assert.throws(() => prepareIncomingInspectionIntent({ ...storage(), setItem: () => undefined }, '9', '7', input, key));
});
test('invalid or client-provided result facts never enter a durable identity', () => {
  const s = storage();
  assert.throws(() => prepareIncomingInspectionIntent(s, '9', '7', { ...input, result: 'pass' } as IncomingQualityInput, key));
  assert.throws(() => prepareIncomingInspectionIntent(s, '9', '7', { ...input,
    measurements: input.measurements.map(item => ({ ...item, measuredNumeric: 'NaN' })) }, key));
  assert.equal(readIncomingQualityIntent(s, '9', '7'), null);
});
test('original ACK fingerprint, frozen measurements and real original revision read-back are required', async () => {
  const { intent, ack, bundle } = fixture();
  await confirmIncomingInspection(intent, ack, bundle);
  for (const patch of [{ key: 'wrong-key-123' }, { fingerprint: 'b'.repeat(64) }, { auditId: 0 },
    { inspection: { ...ack.inspection, inspectorUserId: 10 } }, { inspection: { ...ack.inspection, revision: 2 } },
    { inspection: { ...ack.inspection, note: 'different' } },
    { inspection: { ...ack.inspection, measurements: ack.inspection.measurements.map(item => ({ ...item, testMethod: 'different' })) } },
    { inspection: { ...ack.inspection, measurements: ack.inspection.measurements.map(item => ({ ...item, measuredNumeric: item.code === 'PH' ? '6.500000000000001' : null })) } }]) {
    await assert.rejects(() => confirmIncomingInspection(intent, { ...ack, ...patch }, bundle));
  }
  await assert.rejects(() => confirmIncomingInspection(intent, ack, { ...bundle, qualityChecks: [] }));
  await assert.rejects(() => confirmIncomingInspection(intent, ack, { ...bundle, receipt: { ...bundle.receipt, id: 8 } }));
});
test('QC replay can confirm the old immutable check after QA or a newer hold; it does not claim a latest release', async () => {
  const { intent, ack, bundle } = fixture(), first = bundle.qualityChecks[0];
  const newer = { ...first, id: 12, checkNo: 'IQC-12', revision: 2 };
  const next: IncomingQualityBundle = { ...bundle, qualityChecks: [newer, { ...first, status: 'released', decision: 'released',
    reviewedByUserId: 10, reviewedAt: date, reviewNote: 'QA pass' }] };
  const confirmed = await confirmIncomingInspection(intent, ack, next);
  assert.equal(confirmed.id, 11); assert.equal(next.receipt.qualityStatus, 'hold'); assert.equal(next.qualityChecks[0].status, 'submitted');
});
test('independent QA, expected revision and pass-only release are checked before persisting', () => {
  const { bundle } = fixture(), check = bundle.qualityChecks[0], raw = { expectedRevision: 1, decision: 'released' as const, reason: 'QA pass' };
  const failed = { ...check, result: 'fail' as const,
    measurements: check.measurements.map(item => item.code === 'PH' ? { ...item, result: 'fail' as const, measuredNumeric: '8' } : item) };
  assert.throws(() => prepareIncomingReviewIntent(storage(), '9', '7', check, raw));
  assert.throws(() => prepareIncomingReviewIntent(storage(), '10', '7', check, { ...raw, expectedRevision: 2 }));
  assert.throws(() => prepareIncomingReviewIntent(storage(), '10', '7', failed, raw));
  assert.equal(prepareIncomingReviewIntent(storage(), '10', '7', failed, { ...raw, decision: 'rejected' }).kind, 'review');
});
function reviewFixture() {
  const { bundle } = fixture(), s = storage();
  const intent = prepareIncomingReviewIntent(s, '10', '7', bundle.qualityChecks[0], { expectedRevision: 1, decision: 'released', reason: 'Original QA reason' });
  const ack: IncomingQualityReview = { schema: 'incoming-quality-review/v1', auditId: 14, checkId: 11, purchaseReceiptId: 7,
    revision: 1, decision: 'released', reviewedByUserId: 10, reviewedAt: date, reason: 'Original QA reason', inspectionHash: 'b'.repeat(64) };
  const next: IncomingQualityBundle = { ...bundle, qualityChecks: [{ ...bundle.qualityChecks[0], status: 'released', decision: 'released',
    reviewedByUserId: 10, reviewedAt: date, reviewNote: ack.reason }] };
  return { s, intent, ack, next };
}
test('QA pending original revision/decision/reason survives refresh, cannot become a different request', () => {
  const { s, intent } = reviewFixture();
  assert.deepEqual(readIncomingQualityIntent(s, '10', '7'), intent);
  assert.throws(() => prepareIncomingInspectionIntent(s, '10', '7', input, key));
  if (intent.kind === 'review') assert.throws(() => clearIncomingQualityIntent(s, { ...intent, input: { ...intent.input, reason: 'Changed reason' } }));
});
test('QA ACK requires original actor, revision, facts and reviewed read-back, not the current batch flag', () => {
  const { intent, ack, next } = reviewFixture();
  confirmIncomingReview(intent, ack, next);
  for (const patch of [{ checkId: 12 }, { revision: 2 }, { reviewedByUserId: 11 }, { reason: 'other reason' }, { decision: 'rejected' as const }]) {
    assert.throws(() => confirmIncomingReview(intent, { ...ack, ...patch }, next));
  }
  assert.throws(() => confirmIncomingReview(intent, ack, { ...next, qualityChecks: [] }));
  assert.throws(() => confirmIncomingReview(intent, ack, { ...next, qualityChecks: next.qualityChecks.map(check => ({ ...check, reviewedByUserId: 11 })) }));
  const newer = { ...next.qualityChecks[0], id: 12, revision: 2, checkNo: 'IQC-12', status: 'submitted' as const,
    decision: null, reviewedByUserId: null, reviewedAt: null, reviewNote: null };
  const held = { ...next, qualityChecks: [newer, ...next.qualityChecks] };
  assert.equal(confirmIncomingReview(intent, ack, held).id, 11);
  assert.equal(held.receipt.qualityStatus, 'hold');
});
test('clear removes only the exact confirmed intent; a different key cannot clear another request', () => {
  const { s, intent } = fixture();
  assert.equal(intent.kind, 'inspection');
  if (intent.kind !== 'inspection') return;
  assert.throws(() => clearIncomingQualityIntent(s, { ...intent, key: 'different-key-123' }));
  clearIncomingQualityIntent(s, intent); assert.equal(readIncomingQualityIntent(s, '9', '7'), null);
});
test('QC DTO rejects financial leakage and mismatched receipt/revision rather than defaulting unknown data', () => {
  const { bundle } = fixture(); incomingQualityBundleSchema.parse(bundle);
  assert.throws(() => incomingQualityBundleSchema.parse({ ...bundle, receipt: { ...bundle.receipt, payableAmountNative: '99.00' } }));
  assert.throws(() => incomingQualityBundleSchema.parse({ ...bundle, plan: { ...bundle.plan, binding: { price: 100 } } }));
  assert.throws(() => incomingQualityBundleSchema.parse({ ...bundle, qualityChecks: [{ ...bundle.qualityChecks[0], purchaseReceiptId: 8 }] }));
  assert.throws(() => incomingQualityBundleSchema.parse({ ...bundle, qualityChecks: [bundle.qualityChecks[0], bundle.qualityChecks[0]] }));
  assert.throws(() => incomingQualityListRowSchema.parse({ id: 7, receiptNo: 'PRC-7', purchaseOrderId: 2, productName: 'raw',
    acceptedQuantity: 10, unit: 'kg', receivedAt: date, supplierBatchNo: 'S7', batchNo: 'B7', historyUnreconciled: false, price: 100 }));
});
test('DTO rejects false release, self-review, contradictory result and invalid actor/date identities', () => {
  const { bundle } = fixture(), check = bundle.qualityChecks[0];
  for (const patch of [{ status: 'released' }, { inspectorUserId: Number.MAX_SAFE_INTEGER + 1 }, { checkedAt: 'not-a-date' },
    { result: 'fail' }, { measurements: [check.measurements[0], check.measurements[0]] },
    { status: 'released', decision: 'released', reviewedByUserId: check.inspectorUserId, reviewedAt: date, reviewNote: 'self QA' }]) {
    assert.throws(() => incomingQualityBundleSchema.parse({ ...bundle, qualityChecks: [{ ...check, ...patch }] }));
  }
});
test('only explicit zero-write command rejections may unlock an original identity', () => {
  const { intent: inspection } = fixture(), { intent: review } = reviewFixture();
  for (const code of ['INCOMING_QC_NUMERIC_VALUE_INVALID', 'INCOMING_QC_REQUIRED_MEASUREMENT_MISSING',
    'INCOMING_QC_CHARACTERISTIC_UNKNOWN', 'INCOMING_QC_MEASUREMENT_UNIT_MISMATCH', 'INCOMING_QC_MEASUREMENT_TYPE_MISMATCH']) {
    assert.equal(isDefinitiveIncomingQualityRejection(inspection, { status: 409, errorCode: code }), true);
    assert.equal(isDefinitiveIncomingQualityRejection(review, { status: 409, errorCode: code }), false);
  }
  for (const code of ['INCOMING_QA_STALE_REVISION', 'INCOMING_QA_FAILED_INSPECTION', 'INCOMING_QA_INDEPENDENT_REVIEWER_REQUIRED']) {
    assert.equal(isDefinitiveIncomingQualityRejection(review, { status: 409, errorCode: code }), true);
    assert.equal(isDefinitiveIncomingQualityRejection(inspection, { status: 409, errorCode: code }), false);
  }
  for (const error of [null, Error('timeout'), { status: 500, errorCode: 'INCOMING_QA_STALE_REVISION' },
    { status: 409, errorCode: 'INCOMING_QC_KEY_CONFLICT' }, { status: 409, errorCode: 'INCOMING_QUALITY_EVIDENCE_INVALID' },
    { status: 409, errorCode: 'INCOMING_HISTORY_UNRECONCILED' }, { status: 403, errorCode: 'INCOMING_QUALITY_SCOPE_REQUIRED' },
    { status: 409, errorCode: 'INCOMING_QA_DECISION_CONFLICT' }]) {
    assert.equal(isDefinitiveIncomingQualityRejection(inspection, error), false);
    assert.equal(isDefinitiveIncomingQualityRejection(review, error), false);
  }
});
test('stored QA intent cannot be tampered into a released or failed self-approval request', () => {
  const { s, intent } = reviewFixture();
  if (intent.kind !== 'review') throw Error('fixture');
  const slot = incomingQualityIntentSlot('10', '7');
  for (const check of [{ ...intent.check, status: 'released', decision: 'released', reviewedByUserId: 12, reviewedAt: date, reviewNote: 'already reviewed' },
    { ...intent.check, result: 'fail', measurements: intent.check.measurements.map(item => ({ ...item, result: 'fail' })) }]) {
    s.setItem(slot, JSON.stringify({ ...intent, check }));
    assert.throws(() => readIncomingQualityIntent(s, '10', '7'));
  }
});

async function withQualityWorkspace(actor: string, saved: ReturnType<typeof prepareIncomingInspectionIntent>,
  setup: (original: typeof incomingQualityService) => void,
  verify: (document: Document, click: (testId: string) => Promise<void>, local: Storage) => Promise<void>) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
  const values = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true };
  const originals = Object.keys(values).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  for (const [name, value] of Object.entries(values)) Object.defineProperty(globalThis, name, { value, configurable: true });
  const originalService = { ...incomingQualityService };
  const { createRoot } = await import('react-dom/client');
  const { IncomingQualityWorkspace } = await import('./IncomingQualityWorkspace');
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    setup(originalService);
    dom.window.localStorage.setItem(incomingQualityIntentSlot(actor, '7'), JSON.stringify(saved));
    // This is a DOM unit test using a mocked SDK, not an actual browser/API business acceptance.
    const context = { registerUnsavedChanges: () => undefined, confirmDiscardChanges: () => false } as unknown as React.ContextType<typeof AppContext>;
    await React.act(async () => {
      root.render(React.createElement(AppContext.Provider, { value: context }, React.createElement(IncomingQualityWorkspace,
        { canInspect: actor === '9', canRelease: actor !== '9', currentUserId: actor })));
    });
    const click = async (testId: string) => {
      const target = dom.window.document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
      assert.ok(target, testId); assert.equal(target.disabled, false, testId);
      await React.act(async () => { target.click(); await new Promise(resolve => setTimeout(resolve, 0)); });
    };
    await click('incoming-quality-select-7');
    await verify(dom.window.document, click, dom.window.localStorage);
  } finally {
    await React.act(async () => root.unmount()); Object.assign(incomingQualityService, originalService); dom.window.close();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
    }
  }
}
const qualityList = () => Promise.resolve({ rows: [{ id: 7, receiptNo: 'PRC-7', purchaseOrderId: 2, productName: '原料',
  acceptedQuantity: 10, unit: 'kg', receivedAt: date, supplierBatchNo: 'SUP-LOT-7', batchNo: 'PO-2-RCV-PRC-7', historyUnreconciled: false }],
meta: { page: 1, pageSize: 50 as const, total: 1, totalPages: 1 } });
test('DOM recovery freezes exact QC facts; a post-commit read-back conflict never discards the original key', async () => {
  const { intent, ack, bundle } = fixture(); let reads = 0, writes = 0;
  await withQualityWorkspace('9', intent, () => {
    incomingQualityService.list = qualityList;
    incomingQualityService.get = async () => {
      reads++;
      if (reads === 2) throw Object.assign(Error('read-back corrupted'), { status: 409, errorCode: 'INCOMING_QC_REQUIRED_MEASUREMENT_MISSING' });
      return bundle;
    };
    incomingQualityService.submit = async (receiptId, request, requestedKey) => {
      assert.equal(receiptId, 7); assert.deepEqual(request, intent.kind === 'inspection' ? intent.input : null);
      assert.equal(requestedKey, ack.key); writes++; return { submission: ack, replayed: true };
    };
  }, async (document, click, local) => {
    assert.equal(document.querySelector<HTMLInputElement>('[data-testid="incoming-quality-value-PH"]')?.value, '6.5000000000000020');
    assert.equal(document.querySelector<HTMLInputElement>('[data-testid="incoming-quality-value-PH"]')?.disabled, true);
    await click('incoming-quality-retry');
    assert.equal(readIncomingQualityIntent(local, '9', '7')?.kind, 'inspection');
    assert.ok(document.querySelector('[data-testid="incoming-quality-pending"]'));
    assert.equal(document.querySelector<HTMLInputElement>('[data-testid="incoming-quality-value-PH"]')?.disabled, true);
    await click('incoming-quality-retry');
    assert.equal(writes, 2); assert.equal(readIncomingQualityIntent(local, '9', '7'), null);
    assert.equal(document.querySelector<HTMLInputElement>('[data-testid="incoming-quality-value-PH"]')?.disabled, false);
  });
});
test('DOM old QA lost-ACK recovery reads the original review while a newer QC hold remains visible', async () => {
  const { intent, ack, next } = reviewFixture(), original = next.qualityChecks[0];
  const held: IncomingQualityBundle = { ...next, receipt: { ...next.receipt, qualityStatus: 'hold' }, qualityChecks: [
    { ...original, id: 12, revision: 2, checkNo: 'IQC-12', status: 'submitted', decision: null,
      reviewedByUserId: null, reviewedAt: null, reviewNote: null }, original,
  ] };
  await withQualityWorkspace('10', intent, () => {
    incomingQualityService.list = qualityList; incomingQualityService.get = async () => held;
    incomingQualityService.review = async (id, request) => {
      assert.equal(id, 11); assert.deepEqual(request, intent.input); return { review: ack, replayed: true };
    };
  }, async (document, click, local) => {
    await click('incoming-quality-retry');
    assert.equal(readIncomingQualityIntent(local, '10', '7'), null);
    assert.ok(document.body.textContent?.includes('待检 / 复检冻结'));
    assert.equal(document.body.textContent?.includes('最新检验已独立 QA 放行'), false);
    assert.ok(document.querySelector('[data-testid="incoming-quality-check-12"]'));
    assert.ok(document.body.textContent?.includes('独立 QA · 最新 r2'));
  });
});
