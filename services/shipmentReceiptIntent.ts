import type { ReceiptDiscrepancyType } from './receiptDiscrepancy.service';
import type { ShipmentReceiptBundle } from './shipping.service';

export type ReceiptInput = { quantity: number; acceptedQuantity: number; rejectedQuantity: number;
  discrepancyType?: ReceiptDiscrepancyType; discrepancyReason?: string; note?: string; file?: File | null };
export type ReceiptFacts = { quantity: number; acceptedQuantity: number; rejectedQuantity: number;
  discrepancyType: ReceiptDiscrepancyType; discrepancyReason: string | null; note: string | null;
  file: { name: string; mimeType: string; sha256: string } | null };
export type ReceiptIntent = { schema: 'shipment-receipt-intent/v1'; actorId: string; shipmentId: string; key: string; facts: ReceiptFacts };
type ReceiptSnapshot = { id: number; receiptNo: string; shipmentId: number; quantity: number; acceptedQuantity: number;
  rejectedQuantity: number; unit: string; signedReceiptUrl: string | null; discrepancyReason: string | null; note: string | null;
  receivedBy: number; receivedAt: string; createdAt: string };
export type ReceiptSubmissionAck = { schema: 'shipment-receipt-submission/v1'; key: string; actorId: number; shipmentId: number;
  fingerprint: string; auditId: number; facts: ReceiptFacts; receipt: ReceiptSnapshot };
export type ReceiptSubmissionResult = ShipmentReceiptBundle & { submission?: ReceiptSubmissionAck; replayed?: boolean };
type IntentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const types = ['short_shipped', 'quality_rejected', 'damaged', 'wrong_item', 'over_received', 'late_delivery', 'document_mismatch', 'customer_short_signed', 'customer_damaged', 'other'];
const validId = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const validKey = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/.test(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const slot = (actorId: string, shipmentId: string) => {
  if (!validId(Number(actorId)) || !validId(Number(shipmentId))) throw Error('签收请求缺少当前操作人或发货单身份。');
  return `ailaoda.shipment-receipt-intent/v1.${encodeURIComponent(actorId)}.${encodeURIComponent(shipmentId)}`;
};
const digest = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
// Mirrors the backend receipt comparison: exact representable micros first,
// machine noise only for finer legacy quantities. Contract tests keep parity.
export function sameReceiptQuantity(left: number, right: number): boolean {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  const scaled = (value: number) => {
    const integer = Math.round(value * 1_000_000);
    return Number.isSafeInteger(integer) && Math.abs(value - integer / 1_000_000) <= Math.abs(value) * Number.EPSILON * 8 ? integer : null;
  };
  const a = scaled(left), b = scaled(right);
  if (a !== null && b !== null) return a === b;
  return Math.abs(left - right) <= Math.max(Math.abs(left), Math.abs(right)) * Number.EPSILON * 8;
}
const fileTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
async function receiptFileFacts(file: File): Promise<NonNullable<ReceiptFacts['file']>> {
  const name = file.name.trim(), mimeType = file.type;
  if (!name || name.length > 160 || !fileTypes.includes(mimeType) || file.size <= 0 || file.size > 5 * 1024 * 1024) throw Error('签收凭证须为5 MiB以内的JPEG、PNG、WebP或PDF文件，未发送签收。');
  const bytes = await file.arrayBuffer(), view = new Uint8Array(bytes);
  const prefix = (expected: number[], offset = 0) => expected.every((n, i) => view[offset + i] === n);
  const signature = mimeType === 'image/jpeg' ? prefix([0xff, 0xd8, 0xff]) : mimeType === 'image/png' ? prefix([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    : mimeType === 'image/webp' ? prefix([0x52, 0x49, 0x46, 0x46]) && prefix([0x57, 0x45, 0x42, 0x50], 8) : prefix([0x25, 0x50, 0x44, 0x46, 0x2d]);
  const dataUrlLength = `data:${mimeType};base64,`.length + Math.ceil(bytes.byteLength / 3) * 4;
  if (bytes.byteLength !== file.size || !signature || dataUrlLength < 32) throw Error('签收凭证文件内容与类型不符，未保存请求身份，请更换真实凭证。');
  return { name, mimeType, sha256: await digest(bytes) };
}
export async function receiptIntentFacts(input: ReceiptInput): Promise<ReceiptFacts> {
  const facts: ReceiptFacts = { quantity: input.quantity, acceptedQuantity: input.acceptedQuantity, rejectedQuantity: input.rejectedQuantity,
    discrepancyType: input.discrepancyType || 'customer_short_signed', discrepancyReason: input.discrepancyReason?.trim() || null,
    note: input.note?.trim() || null, file: input.file ? await receiptFileFacts(input.file) : null };
  validateFacts(facts); return facts;
}
function validateFacts(facts: ReceiptFacts) {
  if (!facts || !Number.isFinite(facts.quantity) || facts.quantity <= 0 || !Number.isFinite(facts.acceptedQuantity) || facts.acceptedQuantity < 0
    || !Number.isFinite(facts.rejectedQuantity) || facts.rejectedQuantity < 0 || !sameReceiptQuantity(facts.acceptedQuantity + facts.rejectedQuantity, facts.quantity)
    || !types.includes(facts.discrepancyType) || ![facts.discrepancyReason, facts.note].every(v => v === null || (typeof v === 'string' && v.trim() === v && v.length > 0))
    || (facts.file !== null && (!facts.file || typeof facts.file.name !== 'string' || !facts.file.name || facts.file.name.trim() !== facts.file.name
      || facts.file.name.length > 160 || typeof facts.file.mimeType !== 'string' || !fileTypes.includes(facts.file.mimeType)
      || !/^[a-f0-9]{64}$/.test(facts.file.sha256)))) throw Error('原签收内容无效，未发送签收。');
  const canonical = { quantity: facts.quantity, acceptedQuantity: facts.acceptedQuantity, rejectedQuantity: facts.rejectedQuantity,
    discrepancyType: facts.discrepancyType, discrepancyReason: facts.discrepancyReason, note: facts.note,
    file: facts.file ? { name: facts.file.name, mimeType: facts.file.mimeType, sha256: facts.file.sha256 } : null };
  if (!same(facts, canonical)) throw Error('原签收内容损坏，禁止另建请求。');
}
export function readReceiptIntent(storage: IntentStorage, actorId: string, shipmentId: string): ReceiptIntent | null {
  const raw = storage.getItem(slot(actorId, shipmentId)); if (raw === null) return null;
  let intent: ReceiptIntent;
  try { intent = JSON.parse(raw); } catch { throw Error('原签收请求身份损坏，请先核对签收台账。'); }
  if (!intent || intent.schema !== 'shipment-receipt-intent/v1' || intent.actorId !== actorId || intent.shipmentId !== shipmentId || !validKey(intent.key)) throw Error('原签收请求身份损坏，禁止另建请求。');
  validateFacts(intent.facts); return intent;
}
// Persist only canonical facts and a file digest, never the user's file bytes.
export function prepareReceiptIntent(storage: IntentStorage, actorId: string, shipmentId: string, facts: ReceiptFacts,
  makeKey: () => string = () => crypto.randomUUID()): ReceiptIntent {
  validateFacts(facts);
  const prior = readReceiptIntent(storage, actorId, shipmentId);
  if (prior) { if (!same(prior.facts, facts)) throw Error('原签收结果尚未确认，不能更换内容或另建请求。'); return prior; }
  const intent: ReceiptIntent = { schema: 'shipment-receipt-intent/v1', actorId, shipmentId, key: makeKey(), facts };
  if (!validKey(intent.key)) throw Error('无法建立稳定签收请求身份，未发送签收。');
  const raw = JSON.stringify(intent); storage.setItem(slot(actorId, shipmentId), raw);
  if (storage.getItem(slot(actorId, shipmentId)) !== raw) throw Error('浏览器未可靠保存原签收内容，未发送签收。');
  return intent;
}
export async function receiptIntentPayload(intent: ReceiptIntent, file: File | null): Promise<ReceiptInput> {
  const input: ReceiptInput = { quantity: intent.facts.quantity, acceptedQuantity: intent.facts.acceptedQuantity, rejectedQuantity: intent.facts.rejectedQuantity,
    discrepancyType: intent.facts.discrepancyType, discrepancyReason: intent.facts.discrepancyReason ?? undefined, note: intent.facts.note ?? undefined, file };
  if (!same(await receiptIntentFacts(input), intent.facts)) throw Error('请重新选择与原签收完全一致的凭证文件，不能省略或替换原文件。');
  return input;
}
export async function confirmReceiptSubmission(intent: ReceiptIntent, result: ReceiptSubmissionResult): Promise<void> {
  const ack = result.submission, r = ack?.receipt;
  if (!ack || ack.schema !== 'shipment-receipt-submission/v1' || ack.key !== intent.key || String(ack.actorId) !== intent.actorId
    || String(ack.shipmentId) !== intent.shipmentId || !validId(ack.auditId) || !same(ack.facts, intent.facts) || !r || !validId(r.id)
    || !r.receiptNo || r.shipmentId !== ack.shipmentId || r.receivedBy !== ack.actorId || !r.unit || !Number.isFinite(Date.parse(r.receivedAt))
    || !Number.isFinite(Date.parse(r.createdAt)) || r.quantity !== intent.facts.quantity || r.acceptedQuantity !== intent.facts.acceptedQuantity
    || r.rejectedQuantity !== intent.facts.rejectedQuantity || r.discrepancyReason !== intent.facts.discrepancyReason || r.note !== intent.facts.note
    || Boolean(r.signedReceiptUrl) !== Boolean(intent.facts.file) || String(result.shipment.id) !== intent.shipmentId || result.shipment.unit !== r.unit) throw Error('签收回执不能证明原请求，保留原内容继续确认。');
  const expected = await digest(new TextEncoder().encode(JSON.stringify({ shipmentId: ack.shipmentId, actorId: ack.actorId, facts: intent.facts })).buffer);
  const rows = result.receipts.filter(row => String(row.id) === String(r.id)), row = rows[0], s = result.receiptSummary;
  const near = sameReceiptQuantity;
  if (ack.fingerprint !== expected || rows.length !== 1 || !row || String(row.shipmentId) !== intent.shipmentId || row.receiptNo !== r.receiptNo
    || row.quantity !== r.quantity || row.acceptedQuantity !== r.acceptedQuantity || row.rejectedQuantity !== r.rejectedQuantity || row.unit !== r.unit
    || row.signedReceiptUrl !== r.signedReceiptUrl || row.discrepancyReason !== r.discrepancyReason || row.note !== r.note
    || row.receivedBy !== r.receivedBy || row.receivedAt !== r.receivedAt || row.createdAt !== r.createdAt
    || !near(s.shipmentQuantity, Number(result.shipment.quantity)) || s.receiptCount !== result.receipts.length
    || !near(s.processedQuantity, result.receipts.reduce((sum, item) => sum + item.quantity, 0))
    || !near(s.acceptedQuantity, result.receipts.reduce((sum, item) => sum + item.acceptedQuantity, 0))
    || !near(s.rejectedQuantity, result.receipts.reduce((sum, item) => sum + item.rejectedQuantity, 0))
    || !near(s.remainingQuantity, Math.max(0, s.shipmentQuantity - s.processedQuantity))) throw Error('签收回执或累计数量不一致，禁止清除原请求。');
}
export function clearReceiptIntent(storage: IntentStorage, intent: ReceiptIntent) {
  const prior = readReceiptIntent(storage, intent.actorId, intent.shipmentId);
  if (!prior || !same(prior, intent)) throw Error('不能清除另一笔签收请求。');
  storage.removeItem(slot(intent.actorId, intent.shipmentId));
  if (storage.getItem(slot(intent.actorId, intent.shipmentId)) !== null) throw Error('原签收请求未能清理，请恢复浏览器存储后确认。');
}
// A durable, actor-bound refusal tombstones this key on the server. Generic
// errors and unknown outcomes never authorize throwing away the original key.
export async function isConfirmedReceiptRejection(intent: ReceiptIntent, error: unknown): Promise<boolean> {
  const failure = error as { status?: number; errorCode?: string; details?: { rejectedSubmission?: {
    schema?: string; key?: string; actorId?: number; shipmentId?: number; fingerprint?: string; auditId?: number; code?: string } } };
  const r = failure?.details?.rejectedSubmission;
  if (failure?.status !== 409 || !r || r.schema !== 'shipment-receipt-rejection/v1' || r.key !== intent.key
    || !validId(r.actorId) || String(r.actorId) !== intent.actorId || !validId(r.shipmentId) || String(r.shipmentId) !== intent.shipmentId
    || !validId(r.auditId) || r.code !== failure.errorCode || !['SHIPMENT_MUST_BE_DISPATCHED_FIRST', 'SHIPMENT_ALREADY_DELIVERED',
      'SHIPMENT_ALREADY_FULLY_RECEIVED', 'SHIPMENT_RECEIPT_EXCEEDS_REMAINING', 'SHIPMENT_STATUS_NOT_RECEIVABLE', 'RECEIPT_DISCREPANCY_BLOCKED_BY_TOLERANCE'].includes(r.code || '')) return false;
  try {
    validateFacts(intent.facts);
    return r.fingerprint === await digest(new TextEncoder().encode(JSON.stringify({ shipmentId: Number(intent.shipmentId), actorId: Number(intent.actorId), facts: intent.facts })).buffer);
  } catch { return false; }
}
