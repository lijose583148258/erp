export type PaymentIntentFacts = { amount: number; date: string; method: string; isProxy: boolean; payerName: string; note: string };
export type PaymentIntent = { version: 'payment-intent/v1'; userId: string; orderId: string; key: string; facts: PaymentIntentFacts };
export type IntentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const paymentIntentStorageKey = (userId: string, orderId: string) => {
  if (!userId || !orderId) throw new Error('回款请求缺少登记主体或订单身份。');
  return `ailaoda.payment-intent/v1.${encodeURIComponent(userId)}.${encodeURIComponent(orderId)}`;
};
const canonical = (f: PaymentIntentFacts) => JSON.stringify({ amount: Number(f.amount), date: f.date, method: f.method,
  isProxy: f.isProxy, payerName: f.payerName.trim(), note: f.note.trim() });
export function readPaymentIntent(storage: IntentStorage, userId: string, orderId: string): PaymentIntent | null {
  const raw = storage.getItem(paymentIntentStorageKey(userId, orderId));
  if (raw === null) return null;
  let value: PaymentIntent;
  try { value = JSON.parse(raw); } catch { throw new Error('原回款请求身份损坏，请先核对记录，不能建立新请求。'); }
  if (!value || value.version !== 'payment-intent/v1' || value.userId !== userId || value.orderId !== orderId
    || typeof value.key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(value.key)
    || !value.facts || !Number.isFinite(value.facts.amount) || value.facts.amount <= 0
    || typeof value.facts.date !== 'string' || typeof value.facts.method !== 'string' || typeof value.facts.isProxy !== 'boolean'
    || typeof value.facts.payerName !== 'string' || typeof value.facts.note !== 'string') {
    throw new Error('原回款请求身份与当前主体不一致，请先核对记录。');
  }
  return value;
}
export function preparePaymentIntent(storage: IntentStorage, userId: string, orderId: string, facts: PaymentIntentFacts, makeKey: () => string): PaymentIntent {
  const existing = readPaymentIntent(storage, userId, orderId);
  if (existing) {
    if (canonical(existing.facts) !== canonical(facts)) throw new Error('原提交结果尚未确认；请保留原回款内容重试，不能改金额另建请求。');
    return existing;
  }
  const intent: PaymentIntent = { version: 'payment-intent/v1', userId, orderId, key: makeKey(), facts: JSON.parse(canonical(facts)) };
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(intent.key)) throw new Error('不能生成稳定的回款请求身份，未发送登记。');
  const slot = paymentIntentStorageKey(userId, orderId), serialized = JSON.stringify(intent);
  storage.setItem(slot, serialized);
  if (storage.getItem(slot) !== serialized) throw new Error('浏览器无法可靠保存回款请求身份，未发送登记。');
  return intent;
}
export function clearPaymentIntent(storage: IntentStorage, userId: string, orderId: string, expectedKey: string): void {
  const existing = readPaymentIntent(storage, userId, orderId);
  if (existing && existing.key !== expectedKey) throw new Error('不能清除另一笔尚未确认的登记请求。');
  storage.removeItem(paymentIntentStorageKey(userId, orderId));
  if (storage.getItem(paymentIntentStorageKey(userId, orderId)) !== null) throw new Error('原登记已确认，但请求身份无法清理；请恢复存储后再确认。');
}
export const isDefinitivePaymentRejection = (code?: string) => ['PAYMENT_SUBMISSION_INVALID', 'PAYMENT_SUBMISSION_KEY_REQUIRED',
  'PAYMENT_SUBMISSION_ORDER_CANCELLED', 'PAYMENT_SUBMISSION_ORDER_PAID', 'PAYMENT_SUBMISSION_OVER_BALANCE', 'PAYMENT_SUBMISSION_PENDING_CAPACITY'].includes(code || '');
