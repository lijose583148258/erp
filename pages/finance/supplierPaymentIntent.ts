import type { RegisterSupplierPaymentInput, SupplierPaymentMethod, SupplierPaymentRecord, SupplierPaymentSubmission,
  SupplierPaymentVerification, SupplierPaymentCancellation, SupplierPaymentBundle } from '../../services/supplierPayment.service';

type IntentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type SupplierPaymentFacts = { amountNative: string; currency: string; method: SupplierPaymentMethod; date: string;
  paymentAccountRef: string; externalTransactionRef: string; evidenceRef: string; note: string | null };
export type SupplierPaymentIntent = { schema: 'supplier-payment-intent/v1'; userId: string; receiptId: string;
  key: string; facts: SupplierPaymentFacts };
export type SupplierPaymentDecisionIntent = { schema: 'supplier-payment-decision-intent/v1'; userId: string; receiptId: string;
  kind: 'verify' | 'cancel'; paymentId: number; draftAuditId: number; submissionKey: string; fingerprint: string; reason: string | null };
const validId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const validKey = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/.test(value);
const validHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const timestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const actualDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && timestamp(`${value}T00:00:00.000Z`);
export function supplierPaymentCents(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.\d{2}$/.test(value)) throw Error('金额必须为明确的两位小数字符串。');
  const cents = BigInt(value.replace('.', ''));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('金额超过安全记账精度。');
  return cents;
}
const numericAmount = (fixed: string) => {
  const value = Number(fixed), text = JSON.stringify(value);
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(text);
  // JSON sends Number.toString(), not toFixed(): very large values may lose a cent even when toFixed looks equal.
  if (!match || `${match[1]}.${(match[2] || '').padEnd(2, '0')}` !== fixed) throw Error('该金额不能无损传输，请核对金额精度。');
  return value;
};
const reference = (value: unknown, min: number, max: number): value is string => typeof value === 'string'
  && value === value.trim() && value.length >= min && value.length <= max;
const validFacts = (f: SupplierPaymentFacts) => {
  try { return !!f && supplierPaymentCents(f.amountNative) > 0n && /^[A-Z]{3}$/.test(f.currency)
    && ['bank_transfer', 'cash', 'alipay', 'wechat', 'check', 'wire_transfer'].includes(f.method) && actualDate(f.date)
    && reference(f.paymentAccountRef, 1, 200) && reference(f.externalTransactionRef, 1, 200)
    && reference(f.evidenceRef, 3, 500) && (f.note === null || reference(f.note, 1, 2000)); } catch { return false; }
};
const canonical = (facts: SupplierPaymentFacts) => {
  if (!validFacts(facts)) throw Error('请填写安全的原币金额、真实日期、备案账户、外部流水和付款凭据；尚未发送。');
  numericAmount(facts.amountNative);
  return JSON.stringify({ amountNative: facts.amountNative, currency: facts.currency, method: facts.method, date: facts.date,
    paymentAccountRef: facts.paymentAccountRef, externalTransactionRef: facts.externalTransactionRef, evidenceRef: facts.evidenceRef, note: facts.note });
};
export function supplierPaymentFormFacts(form: { amountNative: string; currency: string; method: SupplierPaymentMethod; date: string;
  paymentAccountRef: string; externalTransactionRef: string; evidenceRef: string; note: string }): SupplierPaymentFacts {
  const amount = form.amountNative.trim();
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(amount)) throw Error('原币金额必须大于零，最多两位小数。');
  const [whole, fraction = ''] = amount.split('.');
  const facts = { amountNative: `${whole}.${fraction.padEnd(2, '0')}`, currency: form.currency.trim().toUpperCase(), method: form.method,
    date: form.date, paymentAccountRef: form.paymentAccountRef.trim(), externalTransactionRef: form.externalTransactionRef.trim(),
    evidenceRef: form.evidenceRef.trim(), note: form.note.trim() || null };
  canonical(facts);
  return facts;
}
export function supplierPaymentInput(facts: SupplierPaymentFacts): RegisterSupplierPaymentInput {
  canonical(facts);
  return { ...facts, amountNative: numericAmount(facts.amountNative), ...(facts.note === null ? { note: undefined } : { note: facts.note }) };
}
export const supplierPaymentIntentSlot = (userId: string, receiptId: string, decision = false) => {
  if (!/^[1-9]\d*$/.test(userId) || !validId(Number(userId)) || !/^[1-9]\d*$/.test(receiptId) || !validId(Number(receiptId))) {
    throw Error('付款请求缺少当前主体或实收回执身份。');
  }
  return `ailaoda.supplier-payment-${decision ? 'decision-' : ''}intent/v1.${userId}.${receiptId}`;
};
export function readSupplierPaymentIntent(storage: IntentStorage, userId: string, receiptId: string): SupplierPaymentIntent | null {
  const raw = storage.getItem(supplierPaymentIntentSlot(userId, receiptId));
  if (raw === null) return null;
  let intent: SupplierPaymentIntent;
  try { intent = JSON.parse(raw); } catch { throw Error('原付款请求身份损坏，不能另建请求。'); }
  if (!intent || intent.schema !== 'supplier-payment-intent/v1' || intent.userId !== userId || intent.receiptId !== receiptId
    || !validKey(intent.key) || !validFacts(intent.facts)) throw Error('原付款身份与当前主体、实收回执或事实不一致。');
  return intent;
}
const persist = (storage: IntentStorage, slot: string, value: unknown) => {
  const raw = JSON.stringify(value);
  storage.setItem(slot, raw);
  if (storage.getItem(slot) !== raw) throw Error('浏览器未可靠保存原付款请求，未发送。');
};
export function prepareSupplierPaymentIntent(storage: IntentStorage, userId: string, receiptId: string,
  facts: SupplierPaymentFacts, makeKey: () => string): SupplierPaymentIntent {
  const serialized = canonical(facts), prior = readSupplierPaymentIntent(storage, userId, receiptId);
  if (prior) {
    if (canonical(prior.facts) !== serialized) throw Error('原付款结果尚未确认，不能改金额或流水另建请求。');
    return prior;
  }
  const intent: SupplierPaymentIntent = { schema: 'supplier-payment-intent/v1', userId, receiptId, key: makeKey(), facts: JSON.parse(serialized) };
  if (!validKey(intent.key)) throw Error('不能建立稳定付款请求身份，未发送。');
  persist(storage, supplierPaymentIntentSlot(userId, receiptId), intent);
  return intent;
}
export function clearSupplierPaymentIntent(storage: IntentStorage, intent: SupplierPaymentIntent) {
  const prior = readSupplierPaymentIntent(storage, intent.userId, intent.receiptId);
  if (prior && (prior.key !== intent.key || canonical(prior.facts) !== canonical(intent.facts))) throw Error('不能清除另一笔付款请求。');
  const slot = supplierPaymentIntentSlot(intent.userId, intent.receiptId);
  storage.removeItem(slot);
  if (storage.getItem(slot) !== null) throw Error('付款已确认，但原请求身份未能清理；请恢复浏览器存储后回读。');
}
export async function confirmSupplierPaymentSubmission(intent: SupplierPaymentIntent, submission: SupplierPaymentSubmission) {
  const p = submission?.payment, f = intent.facts, b = submission?.allocationBasis;
  if (!submission || submission.schema !== 'supplier-payment-submission/v1' || submission.key !== intent.key || !validHash(submission.fingerprint)
    || !validId(submission.auditId) || submission.status !== 'draft' || !p || !validId(p.id) || !p.paymentNo
    || String(p.purchaseReceiptId) !== intent.receiptId || String(p.submittedByUserId) !== intent.userId
    || p.amountNative !== f.amountNative || p.currency !== f.currency || p.method !== f.method || p.date !== `${f.date}T00:00:00.000Z`
    || p.paymentAccountRef !== f.paymentAccountRef || p.externalTransactionRef !== f.externalTransactionRef || p.evidenceRef !== f.evidenceRef
    || p.note !== f.note || !timestamp(p.createdAt) || !b || !validHash(b.receiptSubmissionHash) || !b.payableSnapshotJson) {
    throw Error('付款回执不能证明原请求已登记，保留原事实继续确认。');
  }
  supplierPaymentCents(p.baseAmount); supplierPaymentCents(b.paidAmountNativeBefore); supplierPaymentCents(b.paidAmountBaseBefore);
  let ap: Record<string, unknown>;
  try { ap = JSON.parse(b.payableSnapshotJson); } catch { throw Error('付款冻结应付来源损坏，保留原请求。'); }
  const allocation = ap.allocation as Record<string, unknown> | undefined;
  if (ap.schema !== 'purchase-receipt-payable/v1' || ap.currency !== f.currency || ap.baseCurrency !== 'CNY'
    || !allocation || supplierPaymentCents(allocation.amountNative) < supplierPaymentCents(f.amountNative) + supplierPaymentCents(b.paidAmountNativeBefore)
    || supplierPaymentCents(allocation.amountBase) < supplierPaymentCents(p.baseAmount) + supplierPaymentCents(b.paidAmountBaseBefore)) {
    throw Error('付款金额与原冻结应付不一致，保留原请求。');
  }
  const facts = { purchaseReceiptId: Number(intent.receiptId), submittedByUserId: Number(intent.userId), amountNative: f.amountNative,
    currency: f.currency, method: f.method, date: `${f.date}T00:00:00.000Z`, paymentAccountRef: f.paymentAccountRef,
    externalTransactionRef: f.externalTransactionRef, evidenceRef: f.evidenceRef, note: f.note };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ schema: 'supplier-payment-facts/v1', ...facts })));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== submission.fingerprint) throw Error('原付款事实与回执指纹不一致，保留原请求。');
}
export async function confirmSupplierPaymentSubmissionReadBack(intent: SupplierPaymentIntent,
  submission: SupplierPaymentSubmission, readBack: SupplierPaymentBundle): Promise<SupplierPaymentRecord> {
  await confirmSupplierPaymentSubmission(intent, submission);
  if (String(readBack.purchaseReceiptId) !== intent.receiptId || readBack.currency !== intent.facts.currency) {
    throw Error('独立回读不是原实收应付，保留原请求。');
  }
  const row = readBack.payments.find(item => item.id === submission.payment.id && item.submission.key === intent.key);
  if (!row) throw Error('原付款登记尚未独立回读，不能清除原请求。');
  await confirmSupplierPaymentSubmission(intent, row.submission);
  if (JSON.stringify(row.submission) !== JSON.stringify(submission)) throw Error('独立回读不是原付款登记回执。');
  return row;
}
export function definitiveSupplierPaymentRegistrationRejection(errorCode: unknown): boolean {
  return typeof errorCode === 'string' && ['SUPPLIER_PAYMENT_BANK_TRANSACTION_DUPLICATE',
    'SUPPLIER_PAYMENT_EXCEEDS_PAYABLE', 'SUPPLIER_PAYMENT_DRAFT_PENDING'].includes(errorCode);
}
export function confirmSupplierPaymentRegistrationRejected(intent: SupplierPaymentIntent, errorCode: unknown,
  readBack: SupplierPaymentBundle) {
  if (!definitiveSupplierPaymentRegistrationRejection(errorCode) || String(readBack.purchaseReceiptId) !== intent.receiptId
    || readBack.currency !== intent.facts.currency || readBack.payments.some(row => row.submission.key === intent.key)) {
    throw Error('不能证明该登记请求未提交，保留原身份继续回读。');
  }
}
export function confirmSupplierPaymentVerification(payment: SupplierPaymentRecord, ack: SupplierPaymentVerification) {
  const p = payment.submission.payment, b = payment.submission.allocationBasis;
  if (!ack || ack.schema !== 'supplier-payment-verification/v1' || payment.status !== 'verified' || !payment.verification
    || JSON.stringify(ack) !== JSON.stringify(payment.verification) || ack.paymentId !== p.id || ack.purchaseReceiptId !== p.purchaseReceiptId
    || ack.draftAuditId !== payment.submission.auditId || !validId(ack.auditId) || ack.auditId <= ack.draftAuditId
    || ack.amountNative !== p.amountNative || ack.baseAmount !== p.baseAmount || ack.currency !== p.currency
    || ack.submittedByUserId !== p.submittedByUserId || !validId(ack.verifiedByUserId) || ack.verifiedByUserId === p.submittedByUserId
    || payment.verifiedByUserId !== ack.verifiedByUserId || payment.verifiedAt !== ack.verifiedAt || !timestamp(ack.verifiedAt)
    || ![ack.qualityCheckId, ack.qualityRevision, ack.qualityReviewerUserId].every(validId)
    || ack.paidAmountNativeBefore !== b.paidAmountNativeBefore || ack.paidAmountBaseBefore !== b.paidAmountBaseBefore
    || supplierPaymentCents(ack.paidAmountNativeBefore) + supplierPaymentCents(ack.amountNative) !== supplierPaymentCents(ack.paidAmountNativeAfter)
    || supplierPaymentCents(ack.paidAmountBaseBefore) + supplierPaymentCents(ack.baseAmount) !== supplierPaymentCents(ack.paidAmountBaseAfter)) {
    throw Error('独立核验回执与原付款事实不一致，保留原操作继续回读。');
  }
}
export function confirmSupplierPaymentCancellation(payment: SupplierPaymentRecord, ack: SupplierPaymentCancellation) {
  const p = payment.submission.payment;
  if (!ack || ack.schema !== 'supplier-payment-cancellation/v1' || payment.status !== 'cancelled' || !payment.cancellation
    || JSON.stringify(ack) !== JSON.stringify(payment.cancellation) || ack.paymentId !== p.id || ack.purchaseReceiptId !== p.purchaseReceiptId
    || ack.draftAuditId !== payment.submission.auditId || !validId(ack.auditId) || ack.auditId <= ack.draftAuditId
    || ack.cancelledByUserId !== p.submittedByUserId || !timestamp(ack.cancelledAt) || !reference(ack.reason, 3, 1000)
    || payment.verifiedByUserId !== null || payment.verifiedAt !== null) throw Error('取消回执与本人原草稿不一致，保留原操作继续回读。');
}
export function readSupplierPaymentDecision(storage: IntentStorage, userId: string, receiptId: string): SupplierPaymentDecisionIntent | null {
  const raw = storage.getItem(supplierPaymentIntentSlot(userId, receiptId, true));
  if (raw === null) return null;
  let intent: SupplierPaymentDecisionIntent;
  try { intent = JSON.parse(raw); } catch { throw Error('原付款核验或取消身份损坏，请回读原凭据。'); }
  if (!intent || intent.schema !== 'supplier-payment-decision-intent/v1' || intent.userId !== userId || intent.receiptId !== receiptId
    || !['verify', 'cancel'].includes(intent.kind) || !validId(intent.paymentId) || !validId(intent.draftAuditId)
    || !validKey(intent.submissionKey) || !validHash(intent.fingerprint)
    || (intent.kind === 'verify' ? intent.reason !== null : !reference(intent.reason, 3, 1000))) throw Error('原付款操作与主体、回执或事实不一致。');
  return intent;
}
export function prepareSupplierPaymentDecision(storage: IntentStorage, userId: string, receiptId: string,
  kind: SupplierPaymentDecisionIntent['kind'], payment: SupplierPaymentRecord, reason?: string): SupplierPaymentDecisionIntent {
  supplierPaymentIntentSlot(userId, receiptId, true);
  if (String(payment.purchaseReceiptId) !== receiptId || payment.status !== 'draft'
    || (kind === 'verify' ? String(payment.submittedByUserId) === userId : String(payment.submittedByUserId) !== userId)) {
    throw Error('只允许独立财务核验，或本人取消尚未核验的草稿。');
  }
  const intent: SupplierPaymentDecisionIntent = { schema: 'supplier-payment-decision-intent/v1', userId, receiptId, kind,
    paymentId: payment.id, draftAuditId: payment.submission.auditId, submissionKey: payment.submission.key,
    fingerprint: payment.submission.fingerprint, reason: kind === 'cancel' ? (reason || '').trim() : null };
  if (kind === 'cancel' && !reference(intent.reason, 3, 1000)) throw Error('取消原因须为3–1000字符。');
  const prior = readSupplierPaymentDecision(storage, userId, receiptId);
  if (prior && JSON.stringify(prior) !== JSON.stringify(intent)) throw Error('原核验或取消结果尚未确认，不能改变操作事实。');
  if (!prior) persist(storage, supplierPaymentIntentSlot(userId, receiptId, true), intent);
  return prior || intent;
}
export function confirmSupplierPaymentDecision(intent: SupplierPaymentDecisionIntent, payment: SupplierPaymentRecord): 'verified' | 'cancelled' {
  if (payment.id !== intent.paymentId || String(payment.purchaseReceiptId) !== intent.receiptId
    || payment.submission.auditId !== intent.draftAuditId || payment.submission.key !== intent.submissionKey
    || payment.submission.fingerprint !== intent.fingerprint) throw Error('回读不是原付款凭据，保留原操作。');
  if (payment.status === 'verified') {
    confirmSupplierPaymentVerification(payment, payment.verification!);
    return 'verified'; // An immutable winning verification may belong to another independent verifier.
  }
  confirmSupplierPaymentCancellation(payment, payment.cancellation!);
  if (intent.kind === 'cancel' && (String(payment.cancellation!.cancelledByUserId) !== intent.userId || payment.cancellation!.reason !== intent.reason)) {
    throw Error('取消回执与原取消人或原因不同，不能清除原请求。');
  }
  return 'cancelled';
}
export function confirmSupplierPaymentDecisionReadBack(intent: SupplierPaymentDecisionIntent,
  responsePayment: SupplierPaymentRecord, readBack: SupplierPaymentBundle): SupplierPaymentRecord {
  confirmSupplierPaymentDecision(intent, responsePayment);
  const row = readBack.payments.find(item => item.id === intent.paymentId);
  if (String(readBack.purchaseReceiptId) !== intent.receiptId || !row) throw Error('原付款决定尚未独立回读，不能清除原操作。');
  confirmSupplierPaymentDecision(intent, row);
  if (JSON.stringify(row.verification || row.cancellation) !== JSON.stringify(responsePayment.verification || responsePayment.cancellation)) {
    throw Error('独立回读与原付款核验或取消回执不一致。');
  }
  return row;
}
export function clearSupplierPaymentDecision(storage: IntentStorage, intent: SupplierPaymentDecisionIntent) {
  const prior = readSupplierPaymentDecision(storage, intent.userId, intent.receiptId);
  if (prior && JSON.stringify(prior) !== JSON.stringify(intent)) throw Error('不能清除另一笔未确认付款操作。');
  const slot = supplierPaymentIntentSlot(intent.userId, intent.receiptId, true);
  storage.removeItem(slot);
  if (storage.getItem(slot) !== null) throw Error('付款操作已确认，但请求身份未能清理，请继续回读。');
}
