import type { PaymentReversalDecision, PaymentReversalHistory, PaymentReversalReason, PaymentReversalRequestRecord, PaymentReversalResult } from '../../src/services/collections.service';

export type ReversalRequestFacts = { reasonCategory: PaymentReversalReason; reason: string };
export type ReversalReviewFacts = { decision: PaymentReversalDecision; note: string };
export type ReversalIntent = { version: 'payment-reversal-intent/v1'; kind: 'request' | 'review'; userId: string; targetId: string; key: string;
  facts: ReversalRequestFacts | ReversalReviewFacts };
export type ReversalIntentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const validKey = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(value);
const positiveId = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const isoTimestamp = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
};
const sameReceipt = (received: object, stored: object | null | undefined): boolean => Boolean(stored
  && Object.keys(received).length === Object.keys(stored).length
  && Object.entries(received).every(([field, fact]) => stored[field as keyof typeof stored] === fact));
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length >= 5 && value.length <= 2000;
const validFacts = (kind: ReversalIntent['kind'], value: ReversalIntent['facts']): boolean => Boolean(value && typeof value === 'object'
  && (kind === 'request' ? 'reasonCategory' in value && ['registration_error', 'bank_return'].includes(value.reasonCategory) && text(value.reason)
    : 'decision' in value && ['approve', 'reject'].includes(value.decision) && text(value.note)));
const canonical = (kind: ReversalIntent['kind'], facts: ReversalIntent['facts']): string => {
  if (!validFacts(kind, facts)) throw new Error('冲销原因或审批说明须为 5–2000 字符，且分类/决定有效。');
  return kind === 'request' && 'reasonCategory' in facts ? JSON.stringify({ reasonCategory: facts.reasonCategory, reason: facts.reason.trim() })
    : 'decision' in facts ? JSON.stringify({ decision: facts.decision, note: facts.note.trim() }) : '';
};
export const reversalIntentStorageKey = (kind: ReversalIntent['kind'], userId: string, targetId: string) => {
  if (!['request', 'review'].includes(kind) || !/^[1-9][0-9]*$/.test(userId) || !positiveId(Number(userId)) || !targetId) throw new Error('冲销请求缺少可确认的当前主体或原凭证身份。');
  return `ailaoda.payment-reversal-intent/v1.${kind}.${encodeURIComponent(userId)}.${encodeURIComponent(targetId)}`;
};
export function readReversalIntent(storage: ReversalIntentStorage, kind: ReversalIntent['kind'], userId: string, targetId: string): ReversalIntent | null {
  const raw = storage.getItem(reversalIntentStorageKey(kind, userId, targetId));
  if (raw === null) return null;
  let value: ReversalIntent;
  try { value = JSON.parse(raw); } catch { throw new Error('原冲销请求身份损坏，请核对凭证，不能创建新请求。'); }
  if (!value || value.version !== 'payment-reversal-intent/v1' || value.kind !== kind || value.userId !== userId || value.targetId !== targetId
    || !validKey(value.key) || !validFacts(kind, value.facts)) throw new Error('原冲销身份与当前主体、目标或事实不一致，不能另建请求。');
  return value;
}
export function prepareReversalIntent(storage: ReversalIntentStorage, kind: ReversalIntent['kind'], userId: string, targetId: string,
  facts: ReversalIntent['facts'], makeKey: () => string, expectedKey?: string): ReversalIntent {
  const normalized = canonical(kind, facts), existing = readReversalIntent(storage, kind, userId, targetId);
  if (expectedKey && existing?.key !== expectedKey) throw new Error('另一浏览器上下文已改变原冲销身份；须核对原回执，不能改用新身份重试。');
  if (existing) {
    if (canonical(kind, existing.facts) !== normalized) throw new Error('原提交结果尚未确认；须保留原原因/审批决定和原身份重试，不能修改事实重新提交。');
    return existing;
  }
  const intent: ReversalIntent = { version: 'payment-reversal-intent/v1', kind, userId, targetId, key: makeKey(), facts: JSON.parse(normalized) };
  if (!validKey(intent.key)) throw new Error('不能生成稳定的冲销请求身份，未发送提交。');
  const slot = reversalIntentStorageKey(kind, userId, targetId), serialized = JSON.stringify(intent);
  storage.setItem(slot, serialized);
  if (storage.getItem(slot) !== serialized) throw new Error('浏览器不能可靠保存冲销身份，未发送提交。');
  return intent;
}
export async function prepareLockedReversalIntent(locks: Pick<LockManager, 'request'> | undefined, storage: ReversalIntentStorage,
  kind: ReversalIntent['kind'], userId: string, targetId: string, facts: ReversalIntent['facts'], makeKey: () => string, expectedKey?: string): Promise<ReversalIntent> {
  if (!locks?.request) throw new Error('浏览器不能可靠协调多标签冲销身份，未发送提交。请使用支持安全上下文和 Web Locks 的浏览器。');
  return locks.request(reversalIntentStorageKey(kind, userId, targetId), () => prepareReversalIntent(storage, kind, userId, targetId, facts, makeKey, expectedKey));
}
export function clearReversalIntent(storage: ReversalIntentStorage, intent: ReversalIntent): void {
  const existing = readReversalIntent(storage, intent.kind, intent.userId, intent.targetId);
  if (existing && existing.key !== intent.key) throw new Error('不能清除另一笔尚未确认的冲销身份。');
  const slot = reversalIntentStorageKey(intent.kind, intent.userId, intent.targetId);
  storage.removeItem(slot);
  if (storage.getItem(slot) !== null) throw new Error('原提交已确认，但冲销身份未能清理；请恢复浏览器存储后核对。');
}
export const isDefinitiveReversalRejection = (code?: string) => ['PAYMENT_REVERSAL_INVALID', 'PAYMENT_REVERSAL_KEY_REQUIRED'].includes(code || '');
export const mayReviewReversal = (userId: string, request: Pick<PaymentReversalRequestRecord, 'requestedBy' | 'status'>, permitted: boolean) =>
  permitted && positiveId(Number(userId)) && positiveId(request.requestedBy) && Number(userId) !== request.requestedBy && request.status === 'pending';
const cents = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && Number.isSafeInteger(Math.round(v * 100))
  && Math.abs(v * 100 - Math.round(v * 100)) < 0.000001 ? Math.round(v * 100) : null;
export function assertReversalHistory(value: PaymentReversalHistory, paymentId: number, orderId: number): void {
  if (!value || value.paymentId !== paymentId || value.originalPayment?.version !== 'original-payment-facts/v1'
    || value.originalPayment.id !== paymentId || value.originalPayment.orderId !== orderId || value.currentOrder?.id !== orderId
    || typeof value.originalPayment.currency !== 'string' || cents(value.originalPayment.amount) === null || value.originalPayment.amount <= 0
    || cents(value.currentOrder.paidAmount) === null || value.currentOrder.paidAmount < 0 || typeof value.eligibility?.allowed !== 'boolean' || !Array.isArray(value.requests))
    throw new Error('冲销历史或原凭证读回不完整，不能提交。请重新核对。');
  let active = 0, posted = 0;
  const ids = new Set<string>();
  for (const r of value.requests) {
    if (!r || !r.id || ids.has(r.id) || r.paymentId !== paymentId || !positiveId(r.requestedBy) || !['pending', 'posted', 'rejected'].includes(r.status)
      || r.originalPayment?.id !== paymentId || r.originalPayment.orderId !== orderId
      || Object.entries(value.originalPayment).some(([field, fact]) => r.originalPayment[field as keyof typeof r.originalPayment] !== fact)
      || r.requestReceipt?.version !== 'payment-reversal-request/v1' || r.requestReceipt.status !== 'pending'
      || !positiveId(r.requestReceipt.auditId) || r.requestReceipt.requestedAt !== r.createdAt || r.requestReceipt.orderId !== orderId
      || r.requestReceipt.requestId !== r.id || r.requestReceipt.paymentId !== paymentId
      || r.requestReceipt.requestedBy !== r.requestedBy || r.requestReceipt.reason !== r.reason || r.requestReceipt.reasonCategory !== r.reasonCategory
      || !validKey(r.requestReceipt.requestKey) || r.requestReceipt.currency !== r.originalPayment.currency || r.requestReceipt.amount !== r.originalPayment.amount)
      throw new Error('冲销历史与原回款身份不一致，不能提交。');
    ids.add(r.id);
    if (r.status === 'pending') { active++; if (r.reviewReceipt !== null) throw new Error('待审批申请已有异常审批回执。'); }
    else {
      const receipt = r.reviewReceipt;
      if (!receipt || receipt.version !== 'payment-reversal-review/v1' || receipt.requestId !== r.id || receipt.status !== r.status
        || receipt.paymentId !== paymentId || receipt.orderId !== orderId || receipt.requestedBy !== r.requestedBy || receipt.reviewedBy !== r.reviewedBy
        || r.reviewedBy === r.requestedBy || !positiveId(r.reviewedBy) || !validKey(receipt.reviewKey) || receipt.currency !== r.originalPayment.currency
        || !positiveId(receipt.auditId) || receipt.reviewedAt !== r.reviewedAt
        || cents(receipt.beforePaidAmount) === null || cents(receipt.afterPaidAmount) === null
        || receipt.amount !== (r.status === 'posted' ? -r.originalPayment.amount : 0)
        || receipt.beforePaidAmount < 0 || receipt.afterPaidAmount < 0 || cents(receipt.beforePaidAmount)! + cents(receipt.amount)! !== cents(receipt.afterPaidAmount)
        || (r.status === 'posted' ? !receipt.reversalId : receipt.reversalId !== null)) throw new Error('冲销审批回执不一致，不能提交。');
      if (r.status === 'posted') posted++;
    }
  }
  if (active > 1 || posted > 1 || (posted > 0) !== Boolean(value.reversal) || (value.reversal && (value.reversal.amount !== -value.originalPayment.amount
    || value.reversal.currency !== value.originalPayment.currency || !value.requests.some(r => r.status === 'posted' && r.id === value.reversal!.requestId
      && r.reviewReceipt?.reversalId === value.reversal!.id && r.reviewReceipt.auditId === value.reversal!.auditId
      && r.reviewedBy === value.reversal!.postedBy && r.reviewedAt === value.reversal!.postedAt
      && Object.entries(r.reviewReceipt).every(([field, fact]) => value.reversal!.receipt?.[field as keyof typeof r.reviewReceipt] === fact)))))
    throw new Error('原回款冲销效果与审批历史不一致，不能提交。');
  if (value.eligibility.allowed && (value.paymentStatus !== 'verified' || active || posted || value.originalPayment.currency !== 'CNY'
    || value.currentOrder.currency !== 'CNY' || value.originalPayment.exchangeRate !== 1)) throw new Error('原回款冲销资格与当前状态不一致。');
}
export function assertReversalAcknowledgment(result: PaymentReversalResult, intent: ReversalIntent, paymentId: number, orderId: number): void {
  const r = result?.request, receipt = result?.receipt;
  if (!r || !receipt || typeof result.replayed !== 'boolean' || r.paymentId !== paymentId || result.currentOrder?.id !== orderId
    || r.originalPayment?.id !== paymentId || r.originalPayment.orderId !== orderId || receipt.paymentId !== paymentId || receipt.orderId !== orderId
    || receipt.requestId !== r.id || !positiveId(r.requestedBy) || !positiveId(receipt.requestedBy)
    || receipt.requestedBy !== r.requestedBy || cents(result.currentOrder.paidAmount) === null || result.currentOrder.paidAmount < 0) throw new Error('服务器未返回匹配原凭证的冲销回执；原身份保留，请核对历史后原身份重试。');
  if (intent.kind === 'request' && 'reasonCategory' in intent.facts) {
    if (receipt.version !== 'payment-reversal-request/v1' || receipt.status !== 'pending' || receipt.requestKey !== intent.key || r.requestedBy !== Number(intent.userId)
      || receipt.requestedBy !== r.requestedBy || receipt.auditId !== r.requestReceipt?.auditId || !positiveId(receipt.auditId)
      || !sameReceipt(receipt, r.requestReceipt) || r.requestReceipt.requestKey !== intent.key || !isoTimestamp(receipt.requestedAt)
      || receipt.requestedAt !== r.createdAt || r.requestReceipt.requestedAt !== receipt.requestedAt
      || receipt.amount !== r.originalPayment.amount || receipt.currency !== r.originalPayment.currency || receipt.reasonCategory !== intent.facts.reasonCategory
      || receipt.reason !== intent.facts.reason || r.reasonCategory !== intent.facts.reasonCategory || r.reason !== intent.facts.reason)
      throw new Error('申请回执与原提交身份或事实不符；原身份保留，不能新建请求。');
  } else if (intent.kind === 'review' && 'decision' in intent.facts) {
    const posted = intent.facts.decision === 'approve';
    if (receipt.version !== 'payment-reversal-review/v1' || receipt.reviewKey !== intent.key || r.id !== intent.targetId || r.reviewedBy !== Number(intent.userId)
      || !positiveId(receipt.reviewedBy) || receipt.reviewedBy !== r.reviewedBy || !positiveId(receipt.auditId) || receipt.auditId !== r.reviewReceipt?.auditId
      || !sameReceipt(receipt, r.reviewReceipt) || r.reviewReceipt.reviewKey !== intent.key || !isoTimestamp(receipt.reviewedAt)
      || receipt.reviewedAt !== r.reviewedAt || receipt.reviewedAt !== r.reviewReceipt.reviewedAt
      || r.reviewNote !== intent.facts.note || r.requestedBy === r.reviewedBy || receipt.status !== (posted ? 'posted' : 'rejected') || r.status !== receipt.status
      || receipt.amount !== (posted ? -r.originalPayment.amount : 0) || receipt.currency !== r.originalPayment.currency
      || cents(receipt.beforePaidAmount) === null || cents(receipt.afterPaidAmount) === null
      || receipt.beforePaidAmount < 0 || receipt.afterPaidAmount < 0 || cents(receipt.beforePaidAmount)! + cents(receipt.amount)! !== cents(receipt.afterPaidAmount)
      || (posted ? !receipt.reversalId : receipt.reversalId !== null)) throw new Error('审批回执与原身份、决定或冲销金额不符；原身份保留，不能重新入账。');
  } else throw new Error('冲销身份事实无效。');
}
