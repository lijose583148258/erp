import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useAppContext } from '../../app/AppContext';
import { can, hasDataScope } from '../../app/permissions';
import { useDialogFocus } from '../../app/useDialogFocus';
import { collectionsService, type CollectionLedgerRecord, type PaymentReversalHistory, type PaymentReversalRequestRecord } from '../../src/services/collections.service';
import type { ApiClientError } from '../../utils/api';
import { formatDateTime, paymentStatusLabel } from './collectionCenter.helpers';
import { assertReversalAcknowledgment, assertReversalHistory, clearReversalIntent, isDefinitiveReversalRejection, mayReviewReversal,
  prepareLockedReversalIntent, readReversalIntent, type ReversalIntent, type ReversalRequestFacts, type ReversalReviewFacts } from './paymentReversalIntent';

const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800';
const actionClass = 'rounded-full bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900';
const errorText = (error: unknown) => error instanceof Error ? error.message : '未确认提交结果，请核对原记录。';
const makeKey = () => `reversal-${crypto.randomUUID()}`;
// Request/review identity is stored before any network write. This is intentionally
// strict storage, not safeStorage's best-effort fallback, for uncertain money writes.
const browserStorage = () => window.localStorage;
const money = (amount: number, currency: string) => `${currency} ${amount.toFixed(2)}`;

type Props = { payment: CollectionLedgerRecord; onClose: () => void; onChanged: () => Promise<void> };
type ReviewProps = { request: PaymentReversalRequestRecord; payment: CollectionLedgerRecord; userId: string; permitted: boolean;
  onChanged: () => Promise<void>; onBusyChange: (busy: boolean) => void };

function ReversalReviewForm({ request, payment, userId, permitted, onChanged, onBusyChange }: ReviewProps) {
  const [intent, setIntent] = useState<ReversalIntent | null>(null);
  const [decision, setDecision] = useState<ReversalReviewFacts['decision']>('approve');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [fatal, setFatal] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!permitted) return;
    try {
      const saved = readReversalIntent(browserStorage(), 'review', userId, request.id);
      // A matching durable history receipt independently resolves a lost response.
      if (saved && request.reviewReceipt?.reviewKey === saved.key) {
        assertReversalAcknowledgment({ replayed: true, request, receipt: request.reviewReceipt,
          currentOrder: { id: payment.orderId, currency: request.originalPayment.currency, paidAmount: request.reviewReceipt.afterPaidAmount,
            finalAmount: payment.finalAmount, receivableAdjustmentAmount: payment.receivableAdjustmentAmount ?? 0, paymentStatus: payment.paymentStatus } }, saved, payment.id, payment.orderId);
        clearReversalIntent(browserStorage(), saved);
        setIntent(null);
      } else {
        setIntent(saved);
        if (saved && 'decision' in saved.facts) { setDecision(saved.facts.decision); setNote(saved.facts.note); }
      }
    } catch (e) { setFatal(true); setError(errorText(e)); }
  }, [request, payment, userId, permitted]);

  const independent = Number(userId) !== request.requestedBy;
  const canAct = mayReviewReversal(userId, request, permitted) || Boolean(permitted && independent && intent);
  if (!permitted) return null;
  if (!independent && request.status === 'pending') return <p className="text-sm font-bold text-amber-700 dark:text-amber-300">申请人不能审批自己的申请，包括管理员；请由另一位获授权财务审批。</p>;
  if (!canAct && !fatal) return null;

  const submit = async () => {
    if (!canAct || fatal || busyRef.current) return;
    let active: ReversalIntent | null = null;
    busyRef.current = true; setBusy(true); onBusyChange(true); setError('');
    try {
      active = await prepareLockedReversalIntent(navigator.locks, browserStorage(), 'review', userId, request.id, { decision, note }, makeKey, intent?.key);
      setIntent(active);
      const facts = active.facts as ReversalReviewFacts;
      const result = await collectionsService.reviewPaymentReversal(request.id, { reviewKey: active.key, ...facts });
      assertReversalAcknowledgment(result, active, payment.id, payment.orderId);
      clearReversalIntent(browserStorage(), active); setIntent(null);
      await onChanged();
    } catch (e) {
      if (active && isDefinitiveReversalRejection((e as ApiClientError).errorCode)) {
        try { clearReversalIntent(browserStorage(), active); setIntent(null); } catch (clearError) { setFatal(true); setError(errorText(clearError)); return; }
      }
      setError(errorText(e));
    } finally { busyRef.current = false; setBusy(false); onBusyChange(false); }
  };

  return <div data-testid={`collection-reversal-review-form-${request.id}`} className="mt-3 space-y-3 border-t border-slate-200 pt-3 dark:border-slate-700">
    {intent ? <p role="status" className="break-all text-xs font-bold text-amber-700 dark:text-amber-300">原审批身份已保存：{intent.key}。结果未确认前，不修改决定或说明；关闭/刷新后仍可原身份重试。</p> : null}
    <label className="block space-y-1 text-sm font-bold">独立审批决定
      <select data-testid={`collection-reversal-decision-${request.id}`} className={inputClass} value={decision} disabled={busy || Boolean(intent) || fatal}
        onChange={e => setDecision(e.target.value as ReversalReviewFacts['decision'])}>
        <option value="approve">批准全额账务冲销</option><option value="reject">驳回（不改账）</option>
      </select>
    </label>
    <label className="block space-y-1 text-sm font-bold">审批说明（5–2000 字符）
      <textarea data-testid={`collection-reversal-review-note-${request.id}`} className={inputClass} rows={3} value={note} maxLength={2000}
        disabled={busy || Boolean(intent) || fatal} onChange={e => setNote(e.target.value)} />
    </label>
    {error ? <p role="alert" className="text-sm font-bold text-rose-700 dark:text-rose-300">{error}</p> : null}
    <button type="button" data-testid={`collection-reversal-review-submit-${request.id}`} className={actionClass} onClick={() => void submit()}
      disabled={busy || fatal || note.trim().length < 5}>{busy ? '提交中…' : intent ? '原审批身份重试' : '提交独立审批'}</button>
  </div>;
}

export default function CollectionPaymentReversalDialog({ payment, onClose, onChanged }: Props) {
  const { currentUser, notify } = useAppContext();
  const permittedRequest = can(currentUser, 'orders.payment.reversal.request') && hasDataScope(currentUser, 'finance_visible');
  const permittedReview = can(currentUser, 'orders.payment.reversal.review') && hasDataScope(currentUser, 'finance_visible');
  const [history, setHistory] = useState<PaymentReversalHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [intent, setIntent] = useState<ReversalIntent | null>(null);
  const [fatal, setFatal] = useState(false);
  const [reasonCategory, setReasonCategory] = useState<ReversalRequestFacts['reasonCategory']>('registration_error');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [reviewBusyCount, setReviewBusyCount] = useState(0);
  const reviewBusy = reviewBusyCount > 0;
  const busyRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(true, dialogRef, () => { if (!busy && !reviewBusy) onClose(); });

  const refreshHistory = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError('');
    try {
      const result = await collectionsService.getPaymentReversalHistory(payment.id, { signal });
      if (signal?.aborted) return;
      assertReversalHistory(result, payment.id, payment.orderId);
      if (permittedRequest) {
        const saved = readReversalIntent(browserStorage(), 'request', currentUser.id, String(payment.id));
        const matching = saved && result.requests.find(r => r.requestReceipt.requestKey === saved.key);
        if (saved && matching) {
          assertReversalAcknowledgment({ replayed: true, request: matching, receipt: matching.requestReceipt, currentOrder: result.currentOrder }, saved, payment.id, payment.orderId);
          clearReversalIntent(browserStorage(), saved); setIntent(null);
        } else {
          setIntent(saved);
          if (saved && 'reasonCategory' in saved.facts) { setReasonCategory(saved.facts.reasonCategory); setReason(saved.facts.reason); }
        }
      }
      setHistory(result);
    } catch (e) {
      if (signal?.aborted) return;
      setHistory(null); setError(errorText(e));
      // No cached eligibility survives a failed read; no default currency.
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [payment.id, payment.orderId, permittedRequest, currentUser.id]);

  useEffect(() => {
    const controller = new AbortController();
    if (permittedRequest) {
      try {
        const saved = readReversalIntent(browserStorage(), 'request', currentUser.id, String(payment.id));
        setIntent(saved);
        if (saved && 'reasonCategory' in saved.facts) { setReasonCategory(saved.facts.reasonCategory); setReason(saved.facts.reason); }
      } catch (e) { setFatal(true); setError(errorText(e)); }
    }
    void refreshHistory(controller.signal);
    return () => controller.abort();
  }, [refreshHistory, payment.id, permittedRequest, currentUser.id]);

  const changed = async () => {
    await refreshHistory();
    await onChanged();
  };
  const submitRequest = async () => {
    if (!permittedRequest || !history || (!history.eligibility.allowed && !intent) || fatal || busyRef.current || reviewBusy) return;
    let active: ReversalIntent | null = null;
    busyRef.current = true; setBusy(true); setError('');
    try {
      active = await prepareLockedReversalIntent(navigator.locks, browserStorage(), 'request', currentUser.id, String(payment.id), { reasonCategory, reason }, makeKey, intent?.key);
      setIntent(active);
      const facts = active.facts as ReversalRequestFacts;
      const result = await collectionsService.requestPaymentReversal(payment.id, { requestKey: active.key, ...facts });
      assertReversalAcknowledgment(result, active, payment.id, payment.orderId);
      clearReversalIntent(browserStorage(), active); setIntent(null);
      notify('success', result.replayed ? '已确认原冲销申请回执，未重复创建。' : '冲销申请已保存，原回款仍有效；等待另一位财务独立审批。');
      await changed();
    } catch (e) {
      if (active && isDefinitiveReversalRejection((e as ApiClientError).errorCode)) {
        try { clearReversalIntent(browserStorage(), active); setIntent(null); } catch (clearError) { setFatal(true); setError(errorText(clearError)); return; }
      }
      setError(errorText(e));
    } finally { busyRef.current = false; setBusy(false); }
  };
  return <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-900/60 p-3 backdrop-blur-sm">
    <div ref={dialogRef} role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby="collection-reversal-title" data-testid="collection-payment-reversal-dialog"
      className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[28px] bg-white p-5 text-slate-700 shadow-xl dark:bg-slate-900 dark:text-slate-200 sm:p-7">
      <div className="flex items-start justify-between gap-3">
        <div><h3 id="collection-reversal-title" className="text-xl font-black text-slate-900 dark:text-white">原回款凭证 / 全额冲销</h3><p className="mt-1 text-sm font-bold">订单 {payment.orderNo} · 原回款 #{payment.id}</p></div>
        <button type="button" data-autofocus aria-label="关闭原回款冲销" data-testid="collection-reversal-close" disabled={busy || reviewBusy} onClick={onClose} className="rounded-full p-2 disabled:opacity-50"><X size={20} /></button>
      </div>
      <p className="mt-4 rounded-2xl bg-amber-50 p-3 text-sm font-bold leading-6 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">仅支持 CNY 原币全额账务冲销。申请不改账，独立审批后新增唯一负冲销效果；原金额、日期、核销人及历史凭证保留。不执行银行退款，不包含部分退款、余额结转或汇兑。货抵回款通过原货抵流程冲回。</p>
      {error ? <p role="alert" className="mt-4 text-sm font-bold text-rose-700 dark:text-rose-300">{error}</p> : null}
      {loading ? <p role="status" className="mt-4 text-sm">正在读取原凭证、审批历史与最新订单累计…</p> : null}
      <button type="button" data-testid="collection-reversal-refresh" disabled={loading || busy || reviewBusy} onClick={() => void changed()} className="mt-3 rounded-full border border-slate-200 px-3 py-2 text-sm font-bold dark:border-slate-700">重新核对原记录</button>
      {history ? <>
        <div data-testid="collection-reversal-original" className="mt-4 rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
          <h4 className="font-black">原凭证（不改写）</h4>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div>原金额：<strong>{money(history.originalPayment.amount, history.originalPayment.currency)}</strong></div>
            <div>原状态：{paymentStatusLabel(history.paymentStatus)}</div>
            <div>原回款日期：{formatDateTime(history.originalPayment.date)}</div>
            <div>原核销人：{history.originalPayment.verifiedBy ? `#${history.originalPayment.verifiedBy}` : '历史记录未留存（不补造）'}</div>
            <div>原方式：{history.originalPayment.method}</div><div>付款方：{history.originalPayment.payerName || '未填写'}</div>
          </dl>
          {history.originalPayment.note ? <p className="mt-2 whitespace-pre-wrap break-words text-sm">原备注：{history.originalPayment.note}</p> : null}
          <p data-testid="collection-reversal-current-order" className="mt-3 font-black">最新订单累计已收：{money(history.currentOrder.paidAmount, history.currentOrder.currency)}</p>
        </div>
        {history.reversal ? <div data-testid="collection-reversal-effect" className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm dark:border-rose-900 dark:bg-rose-950/20">
          <h4 className="font-black">唯一全额负冲销效果：{money(history.reversal.amount, history.reversal.currency)}</h4>
          <p className="mt-2 break-all">冲销凭证 {history.reversal.id} · 审计 #{history.reversal.auditId} · 过账人 #{history.reversal.postedBy}</p>
          <p className="mt-1">{formatDateTime(history.reversal.postedAt)} · 原回款不再贡献已收，不能再核销。</p>
        </div> : null}
        <section className="mt-4 space-y-3" aria-label="冲销申请与独立审批历史">
          <h4 className="font-black">申请 / 独立审批历史</h4>
          {!history.requests.length ? <p className="text-sm text-slate-500 dark:text-slate-400">尚无冲销申请。</p> : history.requests.map(request => <div key={request.id} data-testid={`collection-reversal-request-${request.id}`} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-black"><span>{request.status === 'pending' ? '待独立审批（未改账）' : request.status === 'posted' ? '已全额冲销' : '已驳回（未改账）'}</span><span>申请人 #{request.requestedBy}</span></div>
            <p className="mt-2 text-sm">{request.reasonCategory === 'registration_error' ? '登记错误' : '银行退回'} · {formatDateTime(request.createdAt)}</p>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm">申请原因：{request.reason}</p>
            <p className="mt-2 break-all text-xs text-slate-500 dark:text-slate-400">申请 {request.id} · 审计 #{request.requestReceipt.auditId}</p>
            {request.reviewReceipt ? <div className="mt-3 text-sm"><p>独立审批人 #{request.reviewedBy} · {formatDateTime(request.reviewedAt)}</p><p className="whitespace-pre-wrap break-words">审批说明：{request.reviewNote}</p><p>审批原回执累计：{money(request.reviewReceipt.beforePaidAmount, request.reviewReceipt.currency)} → {money(request.reviewReceipt.afterPaidAmount, request.reviewReceipt.currency)}（非当前累计）</p></div> : null}
            <ReversalReviewForm request={request} payment={payment} userId={currentUser.id} permitted={permittedReview} onChanged={changed} onBusyChange={active => setReviewBusyCount(count => Math.max(0, count + (active ? 1 : -1)))} />
          </div>)}
        </section>
        {permittedRequest && (history.eligibility.allowed || intent) ? <section data-testid="collection-reversal-request-form" className="mt-5 space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700">
          <h4 className="font-black">{intent ? '恢复原申请身份' : '申请原币全额账务冲销'}</h4>
          {intent ? <p role="status" className="break-all text-xs font-bold text-amber-700 dark:text-amber-300">原申请身份已保存：{intent.key}。结果未确认前不能修改事实或另建申请，刷新后仍保留。</p> : null}
          <label className="block space-y-1 text-sm font-bold">原因分类<select data-testid="collection-reversal-reason-category" className={inputClass} value={reasonCategory} disabled={busy || Boolean(intent) || fatal} onChange={e => setReasonCategory(e.target.value as ReversalRequestFacts['reasonCategory'])}><option value="registration_error">登记错误</option><option value="bank_return">银行退回</option></select></label>
          <label className="block space-y-1 text-sm font-bold">具体原因（5–2000 字符）<textarea data-testid="collection-reversal-reason" rows={3} maxLength={2000} className={inputClass} value={reason} disabled={busy || Boolean(intent) || fatal} onChange={e => setReason(e.target.value)} /></label>
          <button type="button" data-testid="collection-reversal-request-submit" className={actionClass} disabled={loading || busy || reviewBusy || fatal || reason.trim().length < 5} onClick={() => void submitRequest()}>{busy ? '提交中…' : intent ? '原申请身份重试' : '提交全额冲销申请（不改账）'}</button>
        </section> : null}
        {permittedRequest && !history.eligibility.allowed && !intent ? <p className="mt-4 text-sm font-bold text-slate-500 dark:text-slate-400">{history.eligibility.message || '此原回款当前不能新建冲销申请，请核对历史。'}</p> : null}
        {!permittedRequest && !permittedReview ? <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">当前角色只读原凭证与冲销历史，无申请或审批权限。</p> : null}
      </> : null}
    </div>
  </div>;
}
