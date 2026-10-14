import type { PurchaseReceiptSubmission } from '../../services/procurement.service';

export type PurchaseReceiptIntentFacts = { quantity: number; acceptedQuantity: number; rejectedQuantity: number;
  batchNo: string; discrepancyReason: string; note: string };
export type PurchaseReceiptIntent = { schema: 'purchase-receipt-intent/v1'; userId: string; orderId: string;
  key: string; facts: PurchaseReceiptIntentFacts };
type IntentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const keyValid = (key: string) => /^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/.test(key);
const representable = (n: number) => Number.isFinite(n) && Number.isSafeInteger(Math.round(n * 1000000))
  && Number(n.toFixed(6)) === n;
export const purchaseReceiptIntentSlot = (userId: string, orderId: string) => {
  if (!userId || !orderId) throw Error('收货请求缺少当前操作人或采购单身份。');
  return `ailaoda.purchase-receipt-intent/v1.${encodeURIComponent(userId)}.${encodeURIComponent(orderId)}`;
};
const canonical = (f: PurchaseReceiptIntentFacts) => JSON.stringify({ quantity: f.quantity, acceptedQuantity: f.acceptedQuantity,
  rejectedQuantity: f.rejectedQuantity, batchNo: f.batchNo.trim(), discrepancyReason: f.discrepancyReason.trim(), note: f.note.trim() });
export function readPurchaseReceiptIntent(storage: IntentStorage, userId: string, orderId: string): PurchaseReceiptIntent | null {
  const raw = storage.getItem(purchaseReceiptIntentSlot(userId, orderId));
  if (raw === null) return null;
  let intent: PurchaseReceiptIntent;
  try { intent = JSON.parse(raw); } catch { throw Error('原收货请求身份损坏，请先核对收货记录。'); }
  const f = intent?.facts;
  if (!intent || intent.schema !== 'purchase-receipt-intent/v1' || intent.userId !== userId || intent.orderId !== orderId
    || typeof intent.key !== 'string' || !keyValid(intent.key) || !f || !representable(f.quantity) || f.quantity <= 0
    || !representable(f.acceptedQuantity) || f.acceptedQuantity < 0 || !representable(f.rejectedQuantity) || f.rejectedQuantity < 0
    || Math.abs(f.quantity - f.acceptedQuantity - f.rejectedQuantity) > 0.000001
    || typeof f.batchNo !== 'string' || typeof f.discrepancyReason !== 'string' || typeof f.note !== 'string') {
    throw Error('原收货请求与操作人或收货事实不一致，不能另建请求。');
  }
  return intent;
}
export function preparePurchaseReceiptIntent(storage: IntentStorage, userId: string, orderId: string,
  facts: PurchaseReceiptIntentFacts, makeKey: () => string): PurchaseReceiptIntent {
  if (![facts.quantity, facts.acceptedQuantity, facts.rejectedQuantity].every(representable)
    || facts.quantity <= 0 || facts.acceptedQuantity < 0 || facts.rejectedQuantity < 0
    || Math.abs(facts.quantity - facts.acceptedQuantity - facts.rejectedQuantity) > 0.000001) {
    throw Error('收货数量须在库存六位小数精度内且实收与差异合计一致，未发送入库。');
  }
  const prior = readPurchaseReceiptIntent(storage, userId, orderId);
  if (prior) {
    if (canonical(prior.facts) !== canonical(facts)) throw Error('原收货结果尚未确认，不能改数量或批次另建请求。');
    return prior;
  }
  const intent: PurchaseReceiptIntent = { schema: 'purchase-receipt-intent/v1', userId, orderId, key: makeKey(), facts: JSON.parse(canonical(facts)) };
  if (!keyValid(intent.key)) throw Error('不能建立稳定收货请求身份，未发送入库。');
  const slot = purchaseReceiptIntentSlot(userId, orderId), serialized = JSON.stringify(intent);
  storage.setItem(slot, serialized);
  if (storage.getItem(slot) !== serialized) throw Error('浏览器未可靠保存原收货请求，未发送入库。');
  return intent;
}
export function clearPurchaseReceiptIntent(storage: IntentStorage, userId: string, orderId: string, expectedKey: string) {
  const prior = readPurchaseReceiptIntent(storage, userId, orderId);
  if (prior && prior.key !== expectedKey) throw Error('不能清除另一笔未确认的收货请求。');
  const slot = purchaseReceiptIntentSlot(userId, orderId);
  storage.removeItem(slot);
  if (storage.getItem(slot) !== null) throw Error('收货已确认，但原请求身份未能清理，请恢复浏览器存储后确认。');
}
export async function confirmPurchaseReceiptSubmission(intent: PurchaseReceiptIntent, submission?: PurchaseReceiptSubmission) {
  const r = submission?.receipt, f = intent.facts;
  if (!submission || submission.schema !== 'purchase-receipt-submission/v1' || submission.key !== intent.key
    || !/^[a-f0-9]{64}$/.test(submission.fingerprint) || !Number.isSafeInteger(submission.auditId) || submission.auditId <= 0
    || !r || !Number.isSafeInteger(r.id) || r.id <= 0 || !r.receiptNo || !r.unit
    || String(r.purchaseOrderId) !== intent.orderId || String(r.receivedBy) !== intent.userId
    || r.quantity !== f.quantity || r.acceptedQuantity !== f.acceptedQuantity || r.rejectedQuantity !== f.rejectedQuantity
    || !r.batchNo || (f.batchNo && r.batchNo !== f.batchNo) || (r.note || '') !== f.note || (r.discrepancyReason || '') !== f.discrepancyReason
    || !Number.isFinite(Date.parse(r.receivedAt)) || !Number.isFinite(Date.parse(r.createdAt))
    || (r.acceptedQuantity > 0 ? !r.stockEntryRef : r.stockEntryRef !== null)) {
    throw Error('收货回执不能证明原请求已入账，保留原内容继续确认，不能新建入库。');
  }
  const input = JSON.stringify({ schema: 'purchase-receipt-facts/v1', purchaseOrderId: Number(intent.orderId), receivedBy: Number(intent.userId),
    quantity: f.quantity, acceptedQuantity: f.acceptedQuantity, rejectedQuantity: f.rejectedQuantity, batchNo: f.batchNo || null,
    receivedAt: null, discrepancyReason: f.discrepancyReason || null, discrepancyType: 'short_shipped', note: f.note || null });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (fingerprint !== submission.fingerprint) throw Error('原收货请求与回执指纹不一致，保留原请求，不能重新入库。');
}
export const definitivePurchaseReceiptRejection = (code?: string) => ['PURCHASE_RECEIPT_KEY_REQUIRED', 'PURCHASE_RECEIPT_ACTOR_REQUIRED',
  'PURCHASE_RECEIPT_INVALID_QUANTITY', 'PURCHASE_RECEIPT_QUANTITY_MISMATCH', 'PURCHASE_RECEIPT_INVALID_DATE', 'PURCHASE_RECEIPT_INVALID_TEXT',
  'PURCHASE_ORDER_NOT_FOUND', 'PURCHASE_ORDER_CANCELLED', 'PURCHASE_ORDER_NOT_APPROVED', 'PURCHASE_ORDER_ALREADY_FULLY_RECEIVED',
  'PURCHASE_RECEIPT_EXCEEDS_REMAINING', 'RECEIPT_DISCREPANCY_BLOCKED_BY_TOLERANCE'].includes(code || '');
