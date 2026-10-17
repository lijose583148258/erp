import { z } from 'zod';
import { incomingQualityInputSchema, incomingQualityReviewInputSchema, incomingQualityCheckSchema,
  incomingQualityKeySchema, incomingQualitySubmissionSchema, incomingQualityReviewSchema,
  type IncomingQualityInput, type IncomingQualityReviewInput, type IncomingQualityCheck,
  type IncomingQualityBundle, type IncomingQualitySubmission, type IncomingQualityReview } from '../../services/incomingQuality.service';

type IntentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const identity = z.string().regex(/^[1-9]\d*$/).refine(value => Number.isSafeInteger(Number(value)));
const base = { schema: z.literal('incoming-quality-intent/v1'), userId: identity, receiptId: identity };
const intentSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('inspection'), key: incomingQualityKeySchema, input: incomingQualityInputSchema }).strict(),
  z.object({ ...base, kind: z.literal('review'), check: incomingQualityCheckSchema, input: incomingQualityReviewInputSchema }).strict(),
]);
export type IncomingQualityIntent = z.infer<typeof intentSchema>;
export const incomingQualityIntentSlot = (userId: string, receiptId: string) =>
  `ailaoda.incoming-quality-intent/v1.${identity.parse(userId)}.${identity.parse(receiptId)}`;
const uncertain = () => Error('原检验/审核结果尚未确认，保留原事实继续确认，不能另建请求。');

// Compare exact decimal values without rounding measurement strings through Number.
export function exactIncomingDecimal(raw: string): string {
  const match = /^([+-]?)(\d+(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d+))?$/.exec(raw.trim());
  if (!match || !Number.isFinite(Number(raw))) throw Error('实测数值须为有限十进制数字');
  const [whole, fraction = ''] = match[2].split('.');
  let digits = `${whole}${fraction}`.replace(/^0+/, '');
  if (!digits) return '0';
  const before = digits.length;
  digits = digits.replace(/0+$/, '');
  const exponent = BigInt(match[3] || '0') - BigInt(fraction.length) + BigInt(before - digits.length);
  return `${match[1] === '-' ? '-' : ''}${digits}e${exponent}`;
}
const sameDecimal = (a: string | null, b: string | null) => a === null || b === null ? a === b : exactIncomingDecimal(a) === exactIncomingDecimal(b);
const sortedInput = (raw: IncomingQualityInput) => {
  const input = incomingQualityInputSchema.parse(raw);
  input.measurements.forEach(item => { if (item.measuredNumeric !== null) exactIncomingDecimal(item.measuredNumeric); });
  return { ...input, measurements: [...input.measurements].sort((a, b) => a.code < b.code ? -1 : a.code > b.code ? 1 : 0) };
};
export function readIncomingQualityIntent(storage: IntentStorage, userId: string, receiptId: string): IncomingQualityIntent | null {
  const raw = storage.getItem(incomingQualityIntentSlot(userId, receiptId));
  if (raw === null) return null;
  let intent: IncomingQualityIntent;
  try { intent = intentSchema.parse(JSON.parse(raw)); } catch { throw uncertain(); }
  if (intent.userId !== userId || intent.receiptId !== receiptId) throw uncertain();
  if (intent.kind === 'inspection') sortedInput(intent.input);
  else if (intent.check.purchaseReceiptId !== Number(receiptId) || intent.check.revision !== intent.input.expectedRevision
    || intent.check.inspectorUserId === Number(userId) || intent.check.status !== 'submitted'
    || (intent.input.decision === 'released' && intent.check.result !== 'pass')) throw uncertain();
  return intent;
}
function persist(storage: IntentStorage, next: IncomingQualityIntent) {
  const prior = readIncomingQualityIntent(storage, next.userId, next.receiptId);
  if (prior) {
    const comparable = (intent: IncomingQualityIntent) => JSON.stringify(intent.kind === 'inspection' ? { ...intent, key: '' } : intent);
    if (comparable(prior) !== comparable(next)) throw uncertain();
    return prior;
  }
  const slot = incomingQualityIntentSlot(next.userId, next.receiptId), serialized = JSON.stringify(next);
  storage.setItem(slot, serialized);
  if (storage.getItem(slot) !== serialized) throw Error('浏览器没有可靠保存原检验/审核请求，未发送。');
  return next;
}
export function prepareIncomingInspectionIntent(storage: IntentStorage, userId: string, receiptId: string,
  raw: IncomingQualityInput, makeKey: () => string): IncomingQualityIntent {
  const input = sortedInput(raw), prior = readIncomingQualityIntent(storage, userId, receiptId);
  // Do not invoke the key factory at all while recovering an uncertain request.
  return persist(storage, intentSchema.parse({ schema: 'incoming-quality-intent/v1', kind: 'inspection', userId, receiptId,
    key: prior?.kind === 'inspection' ? prior.key : makeKey(), input }));
}
export function prepareIncomingReviewIntent(storage: IntentStorage, userId: string, receiptId: string,
  check: IncomingQualityCheck, raw: IncomingQualityReviewInput): IncomingQualityIntent {
  const input = incomingQualityReviewInputSchema.parse(raw), original = incomingQualityCheckSchema.parse(check);
  if (original.purchaseReceiptId !== Number(receiptId) || original.revision !== input.expectedRevision
    || original.inspectorUserId === Number(userId) || original.status !== 'submitted'
    || (input.decision === 'released' && original.result !== 'pass')) throw Error('仅另一位授权 QA 可审核最新实测记录；不合格不得放行。');
  return persist(storage, intentSchema.parse({ schema: 'incoming-quality-intent/v1', kind: 'review', userId, receiptId, check: original, input }));
}
export function clearIncomingQualityIntent(storage: IntentStorage, intent: IncomingQualityIntent) {
  const prior = readIncomingQualityIntent(storage, intent.userId, intent.receiptId);
  if (prior && JSON.stringify(prior) !== JSON.stringify(intent)) throw uncertain();
  const slot = incomingQualityIntentSlot(intent.userId, intent.receiptId);
  storage.removeItem(slot);
  if (storage.getItem(slot) !== null) throw Error('回执已核对，但浏览器尚未清理原请求；请继续确认，不要重建。');
}
// Only these explicit command rejections prove no mutation was committed. A
// timeout, permissions change, identity conflict or invalid audit is not proof.
export function isDefinitiveIncomingQualityRejection(intent: IncomingQualityIntent, error: unknown) {
  const failure = error as { status?: number; errorCode?: string } | null;
  if (failure?.status !== 409) return false;
  return (intent.kind === 'review' ? [
    'INCOMING_QA_STALE_REVISION', 'INCOMING_QA_FAILED_INSPECTION', 'INCOMING_QA_INDEPENDENT_REVIEWER_REQUIRED',
  ] : [
    'INCOMING_QC_NUMERIC_VALUE_INVALID', 'INCOMING_QC_REQUIRED_MEASUREMENT_MISSING',
    'INCOMING_QC_CHARACTERISTIC_UNKNOWN', 'INCOMING_QC_MEASUREMENT_UNIT_MISMATCH', 'INCOMING_QC_MEASUREMENT_TYPE_MISMATCH',
  ]).includes(failure.errorCode || '');
}
const immutableCheck = (check: IncomingQualityCheck) => ({ id: check.id, checkNo: check.checkNo,
  purchaseReceiptId: check.purchaseReceiptId, revision: check.revision, sampleNo: check.sampleNo,
  measurements: check.measurements, note: check.note, inspectorUserId: check.inspectorUserId, checkedAt: check.checkedAt, result: check.result });

export async function confirmIncomingInspection(intent: IncomingQualityIntent, raw: IncomingQualitySubmission, bundle: IncomingQualityBundle) {
  if (intent.kind !== 'inspection') throw uncertain();
  const ack = incomingQualitySubmissionSchema.parse(raw), inspection = ack.inspection;
  if (ack.key !== intent.key || inspection.purchaseReceiptId !== Number(intent.receiptId)
    || inspection.inspectorUserId !== Number(intent.userId) || inspection.sampleNo !== intent.input.sampleNo
    || inspection.note !== intent.input.note || bundle.receipt.id !== inspection.purchaseReceiptId
    || inspection.measurements.length !== intent.input.measurements.length) throw uncertain();
  const normalized = intent.input.measurements.map(item => {
    const measured = inspection.measurements.find(value => value.code === item.code);
    const frozen = bundle.plan.characteristics.find(value => value.code.toUpperCase() === item.code);
    if (!measured || !frozen || measured.unit !== item.unit || !sameDecimal(measured.measuredNumeric, item.measuredNumeric)
      || measured.measuredText !== item.measuredText || measured.instrumentNo !== item.instrumentNo
      || measured.name !== frozen.name || measured.valueType !== frozen.valueType || measured.unit !== frozen.unit
      || !sameDecimal(measured.lowerLimit, frozen.lowerLimit) || !sameDecimal(measured.upperLimit, frozen.upperLimit)
      || measured.targetText !== frozen.targetText || measured.testMethod !== frozen.testMethod || measured.required !== frozen.required) throw uncertain();
    return { code: item.code, unit: item.unit, measuredNumeric: measured.measuredNumeric,
      measuredText: item.measuredText, instrumentNo: item.instrumentNo };
  });
  const facts = JSON.stringify({ schema: 'incoming-quality-facts/v1', purchaseReceiptId: inspection.purchaseReceiptId,
    inspectorUserId: inspection.inspectorUserId, sampleNo: intent.input.sampleNo, measurements: normalized, note: intent.input.note });
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(facts));
  const fingerprint = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  const original = bundle.qualityChecks.find(check => check.id === inspection.id && check.revision === inspection.revision);
  const { planHash: _planHash, ...immutable } = inspection;
  if (fingerprint !== ack.fingerprint || !original || JSON.stringify(immutableCheck(original)) !== JSON.stringify(immutable)) throw uncertain();
  return original;
}
export function confirmIncomingReview(intent: IncomingQualityIntent, raw: IncomingQualityReview, bundle: IncomingQualityBundle) {
  if (intent.kind !== 'review') throw uncertain();
  const ack = incomingQualityReviewSchema.parse(raw), original = bundle.qualityChecks.find(check => check.id === intent.check.id);
  if (ack.checkId !== intent.check.id || ack.purchaseReceiptId !== Number(intent.receiptId) || bundle.receipt.id !== ack.purchaseReceiptId
    || ack.revision !== intent.input.expectedRevision || ack.decision !== intent.input.decision || ack.reason !== intent.input.reason
    || ack.reviewedByUserId !== Number(intent.userId) || !original
    || JSON.stringify(immutableCheck(original)) !== JSON.stringify(immutableCheck(intent.check))
    || original.status !== ack.decision || original.decision !== ack.decision || original.reviewedByUserId !== ack.reviewedByUserId
    || original.reviewedAt !== ack.reviewedAt || original.reviewNote !== ack.reason) throw uncertain();
  // Deliberately validate the original revision, not a batch flag: a newer QC
  // hold may already exist, and replaying this old decision must not release it.
  return original;
}
