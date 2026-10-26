import { evaluateIncomingQualityMeasurements, incomingQualityFingerprint, normalizeIncomingQualityInput, incomingQualityInspectionHash,
  incomingQualitySubmissionAudit, readIncomingQualitySubmission, incomingQualityReviewAudit, readIncomingQualityReview } from './incoming-quality';

const plan = { specificationRef: 'Signed supplier incoming specification', specificationRevision: 'R1', characteristics: [{
  code: 'PH', name: 'pH', valueType: 'numeric' as const, unit: 'pH', lowerLimit: '6.500000000000001', upperLimit: '7.500000000000001',
  targetText: null, testMethod: 'Calibrated meter', required: true, sortOrder: 0,
}, { code: 'APPEARANCE', name: 'Appearance', valueType: 'text' as const, unit: null, lowerLimit: null, upperLimit: null,
  targetText: 'clear|transparent', testMethod: 'Visual inspection', required: true, sortOrder: 1 }] };
const input = () => normalizeIncomingQualityInput({ sampleNo: 'ACTUAL-SAMPLE-1', note: null, measurements: [
  { code: 'PH', unit: 'pH', measuredNumeric: '6.500000000000002', measuredText: null, instrumentNo: 'CALIBRATED-METER-1' },
  { code: 'APPEARANCE', unit: null, measuredNumeric: null, measuredText: 'Clear', instrumentNo: 'VISUAL-STATION-1' },
] });
test('derives pass/fail from exact frozen limits and actual measurements, not a caller flag', () => {
  const sample = input(); expect(evaluateIncomingQualityMeasurements(plan, sample).result).toBe('pass');
  const low = { ...sample, measurements: sample.measurements.map(row => row.code === 'PH' ? { ...row, measuredNumeric: '6.500000000000000' } : row) };
  expect(evaluateIncomingQualityMeasurements(plan, low).result).toBe('fail');
  expect(() => normalizeIncomingQualityInput({ ...sample, result: 'pass' })).toThrow();
});
test.each(['missing', 'wrong-unit', 'unknown-code', 'wrong-type', 'duplicate', 'no-instrument', 'not-a-number'])('rejects incomplete/mismatched inspection %s', change => {
  const sample = input();
  if (change === 'missing') sample.measurements = sample.measurements.filter(row => row.code !== 'PH');
  if (change === 'wrong-unit') sample.measurements.find(row => row.code === 'PH')!.unit = '%';
  if (change === 'unknown-code') sample.measurements[0].code = 'UNKNOWN';
  if (change === 'wrong-type') { sample.measurements[0].measuredNumeric = '7'; sample.measurements[0].measuredText = null; }
  if (change === 'duplicate') sample.measurements.push(sample.measurements[0]);
  if (change === 'no-instrument') sample.measurements[0].instrumentNo = '';
  if (change === 'not-a-number') sample.measurements.find(row => row.code === 'PH')!.measuredNumeric = 'Infinity';
  expect(() => evaluateIncomingQualityMeasurements(plan, normalizeIncomingQualityInput(sample))).toThrow();
});
test('canonical ordering and decimal spelling preserve intent, while inspector identity is part of the fingerprint', () => {
  const a = input(), b = normalizeIncomingQualityInput({ ...a, measurements: [...a.measurements].reverse().map(row => row.code === 'PH' ? { ...row, measuredNumeric: '6.5000000000000020' } : row) });
  expect(incomingQualityFingerprint(41, 8, a)).toBe(incomingQualityFingerprint(41, 8, b));
  expect(incomingQualityFingerprint(41, 9, a)).not.toBe(incomingQualityFingerprint(41, 8, a));
});
function recorded() {
  const measured = evaluateIncomingQualityMeasurements(plan, input());
  const inspection = { id: 51, checkNo: 'IQC-51', purchaseReceiptId: 41, revision: 1, sampleNo: 'ACTUAL-SAMPLE-1',
    measurements: measured.measurements, note: null, inspectorUserId: 8, checkedAt: '2026-10-14T01:00:00.000Z', result: measured.result, planHash: 'a'.repeat(64) };
  const key = 'incoming-check-51', fingerprint = incomingQualityFingerprint(41, 8, input());
  const ack = { schema: 'incoming-quality-submission/v1', key, fingerprint, auditId: 61, inspection };
  const audit = { id: 61, userId: 8, action: 'CREATE_INCOMING_QC', resource: 'incoming_quality', resourceId: 51,
    details: JSON.stringify(incomingQualitySubmissionAudit(key, fingerprint, inspection)) };
  return { inspection, key, fingerprint, ack, audit, stored: { requestKey: key, fingerprint, submissionJson: JSON.stringify(ack) } };
}
test('immutable inspection replay is bound to exact instrument/measurements and the original audit, not current batch status', () => {
  const f = recorded(); expect(readIncomingQualitySubmission(f.stored, f.inspection, f.key, f.fingerprint, f.audit)).toEqual(f.ack);
  const inspection = { ...f.inspection, measurements: f.inspection.measurements.map(row => ({ ...row, instrumentNo: 'REWRITTEN' })) };
  expect(() => readIncomingQualitySubmission({ ...f.stored, submissionJson: JSON.stringify({ ...f.ack, inspection }) }, inspection, f.key, f.fingerprint, f.audit)).toThrow('EVIDENCE_INVALID');
});
test('review acknowledgement binds the original measurement hash, decision, reviewer and reason', () => {
  const f = recorded(), review = { schema: 'incoming-quality-review/v1' as const, checkId: 51, purchaseReceiptId: 41, revision: 1,
    decision: 'released' as const, reviewedByUserId: 9, reviewedAt: '2026-10-14T02:00:00.000Z', reason: 'Independent QA review of actual measurements',
    inspectionHash: incomingQualityInspectionHash(f.inspection) };
  const ack = { auditId: 62, ...review }, audit = { id: 62, userId: 9, action: 'REVIEW_INCOMING_QC', resource: 'incoming_quality', resourceId: 51,
    details: JSON.stringify(incomingQualityReviewAudit(review)) };
  expect(readIncomingQualityReview(JSON.stringify(ack), review, audit)).toEqual(ack);
  expect(() => readIncomingQualityReview(JSON.stringify({ ...ack, reason: 'changed' }), { ...review, reason: 'changed' }, audit)).toThrow('EVIDENCE_INVALID');
});
