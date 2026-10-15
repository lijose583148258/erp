import type { Shipment } from '../types';

export type ShipmentSubmissionFacts = { customerId: number; orderId: number | null; orderItemId: number | null; materialId: number | null;
  productName: string; quantity: number; unit: string; batchNo: string | null; packageType: string | null; carrier: string | null; trackingNo: string | null };
export type ShipmentSubmissionSnapshot = ShipmentSubmissionFacts & { id: number; shipmentNo: string; productBatchId: number | null;
  createdBy: number; createdAt: string; status: 'pending' };
export type ShipmentSubmissionAck = { schema: 'shipment-submission/v1'; key: string; fingerprint: string; actorId: number; auditId: number;
  facts: ShipmentSubmissionFacts; shipment: ShipmentSubmissionSnapshot };
export type ShipmentSubmissionResult = { shipment: Shipment; submission?: ShipmentSubmissionAck; replayed?: boolean };
export type ShipmentIntent = { schema: 'shipment-intent/v1'; userId: string; scope: string; key: string; facts: ShipmentSubmissionFacts };
type IntentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const validId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const validKey = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/.test(v);
const slot = (userId: string, scope: string) => {
  if (!validId(Number(userId)) || !scope) throw Error('发货请求缺少当前操作人或入口身份。');
  return `ailaoda.shipment-intent/v1.${encodeURIComponent(userId)}.${encodeURIComponent(scope)}`;
};
// Keep the recovery entry reachable even after the original request allocated the last unit.
export function hasShipmentIntent(userId: string, scope: string, getStorage: () => IntentStorage = () => localStorage) {
  try { return getStorage().getItem(slot(userId, scope)) !== null; }
  catch { return true; } // Opening the form explains the storage fault; it cannot submit.
}
export function shipmentIntentFacts(input: Partial<Shipment> & { packageType?: string }): ShipmentSubmissionFacts {
  const optionalId = (v: unknown) => v === undefined || v === null || v === '' ? null : Number(v);
  const optionalText = (v: unknown) => v === undefined || v === null ? null : String(v).trim() || null;
  const facts = { customerId: Number(input.customerId), orderId: optionalId(input.orderId), orderItemId: optionalId(input.orderItemId),
    materialId: optionalId(input.materialId), productName: String(input.productName || '').trim(), quantity: Number(input.quantity),
    unit: String(input.unit ?? '件').trim(), batchNo: optionalText(input.batchNo), packageType: optionalText(input.packageType),
    carrier: optionalText(input.carrier), trackingNo: optionalText(input.trackingNo) };
  if (!validId(facts.customerId) || [facts.orderId, facts.orderItemId, facts.materialId].some(v => v !== null && !validId(v))
    || !facts.productName || !facts.unit || !Number.isFinite(facts.quantity) || facts.quantity <= 0) throw Error('原发货内容无效，未发送建单。');
  return facts;
}
const payload = (facts: ShipmentSubmissionFacts): Partial<Shipment> & { packageType?: string } => ({ ...facts, customerId: String(facts.customerId),
  orderId: facts.orderId === null ? undefined : String(facts.orderId), orderItemId: facts.orderItemId === null ? undefined : String(facts.orderItemId),
  materialId: facts.materialId === null ? undefined : String(facts.materialId), batchNo: facts.batchNo ?? undefined,
  packageType: facts.packageType ?? undefined, carrier: facts.carrier ?? undefined, trackingNo: facts.trackingNo ?? undefined });
export const shipmentIntentPayload = (intent: ShipmentIntent) => payload(intent.facts);
export function readShipmentIntent(storage: IntentStorage, userId: string, scope: string): ShipmentIntent | null {
  const raw = storage.getItem(slot(userId, scope)); if (raw === null) return null;
  let intent: ShipmentIntent; try { intent = JSON.parse(raw); } catch { throw Error('原发货请求身份损坏，请先核对发货台账。'); }
  if (!intent || intent.schema !== 'shipment-intent/v1' || intent.userId !== userId || intent.scope !== scope || !validKey(intent.key)
    || !intent.facts || JSON.stringify(shipmentIntentFacts(payload(intent.facts))) !== JSON.stringify(intent.facts)) throw Error('原发货请求内容损坏，禁止另建请求。');
  return intent;
}
export function prepareShipmentIntent(storage: IntentStorage, userId: string, scope: string, input: Partial<Shipment>, makeKey: () => string = () => crypto.randomUUID()): ShipmentIntent {
  const facts = shipmentIntentFacts(input), prior = readShipmentIntent(storage, userId, scope);
  if (prior) {
    if (JSON.stringify(prior.facts) !== JSON.stringify(facts)) throw Error('上一笔发货结果尚未确认，不能修改内容后另建发货单。');
    return prior;
  }
  const intent: ShipmentIntent = { schema: 'shipment-intent/v1', userId, scope, key: makeKey(), facts };
  if (!validKey(intent.key)) throw Error('无法建立稳定发货请求身份，未发送建单。');
  const saved = JSON.stringify(intent); storage.setItem(slot(userId, scope), saved);
  if (storage.getItem(slot(userId, scope)) !== saved) throw Error('浏览器未可靠保存原发货内容，未发送建单。');
  return intent;
}
export async function confirmShipmentSubmission(intent: ShipmentIntent, result: ShipmentSubmissionResult) {
  const s = result.submission, r = s?.shipment;
    const nullableId = (v: unknown) => v === undefined || v === null || v === '' ? null : Number(v);
  if (!s || s.schema !== 'shipment-submission/v1' || s.key !== intent.key || String(s.actorId) !== intent.userId || !validId(s.auditId)
    || JSON.stringify(s.facts) !== JSON.stringify(intent.facts) || !r || !validId(r.id) || !r.shipmentNo || r.status !== 'pending'
    || r.createdBy !== s.actorId || !Number.isFinite(Date.parse(r.createdAt)) || r.quantity !== intent.facts.quantity
    || r.customerId !== intent.facts.customerId || (intent.facts.orderId !== null && r.orderId !== intent.facts.orderId)
    || (intent.facts.orderItemId !== null && r.orderItemId !== intent.facts.orderItemId)
    || (intent.facts.materialId !== null && r.materialId !== intent.facts.materialId) || r.unit !== intent.facts.unit
    || r.batchNo !== intent.facts.batchNo || r.packageType !== intent.facts.packageType || r.carrier !== intent.facts.carrier
    || r.trackingNo !== intent.facts.trackingNo || String(result.shipment.id) !== String(r.id) || result.shipment.shipmentNo !== r.shipmentNo
    || result.shipment.quantity !== r.quantity || result.shipment.unit !== r.unit || result.shipment.status !== 'pending'
    || result.shipment.productName !== r.productName || (result.shipment.batchNo || null) !== r.batchNo
    || Number(result.shipment.customerId) !== r.customerId || nullableId(result.shipment.materialId) !== r.materialId
    || nullableId(result.shipment.orderId) !== r.orderId || nullableId(result.shipment.orderItemId) !== r.orderItemId
    || nullableId(result.shipment.productBatchId) !== r.productBatchId) {
    throw Error('发货回执不能证明原请求已创建，保留原内容继续确认。');
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ actorId: s.actorId, facts: intent.facts })));
  if (Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('') !== s.fingerprint) throw Error('发货回执指纹不一致，禁止清除原请求。');
}
export function clearShipmentIntent(storage: IntentStorage, intent: ShipmentIntent) {
  const prior = readShipmentIntent(storage, intent.userId, intent.scope);
  if (!prior || prior.key !== intent.key) throw Error('不能清除另一笔发货请求。');
  storage.removeItem(slot(intent.userId, intent.scope));
  if (storage.getItem(slot(intent.userId, intent.scope)) !== null) throw Error('原请求未能清理，请恢复浏览器存储后确认。');
}
// Only the first, never-ambiguous POST may use this to unlock corrected input.
// Recovery retries must keep their original identity even after a negative response.
export async function isConfirmedShipmentRejection(intent: ShipmentIntent, error: unknown): Promise<boolean> {
  const failure = error as { status?: number; errorCode?: string; details?: { rejectedSubmission?: {
    schema?: string; key?: string; actorId?: number; fingerprint?: string; code?: string } } };
  const r = failure?.details?.rejectedSubmission;
  if (![404, 409].includes(failure?.status || 0) || !r || r.schema !== 'shipment-rejection/v1' || r.key !== intent.key
    || String(r.actorId) !== intent.userId || !r.code || r.code !== failure.errorCode) return false;
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ actorId: Number(intent.userId), facts: intent.facts })));
    return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('') === r.fingerprint;
  } catch { return false; }
}
