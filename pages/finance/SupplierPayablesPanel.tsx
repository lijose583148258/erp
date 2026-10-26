import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppContext } from '../../app/AppContext';
import { useUnsavedForm } from '../../app/useUnsavedForm';
import { FormField, ReasonDialog } from '../../components/ui';
import { isCanceledApiError, type ApiClientError } from '../../utils/api';
import { supplierPaymentService, type SupplierPayableCandidate, type SupplierPayablePage, type SupplierPaymentBundle,
  type SupplierPaymentMethod, type SupplierPaymentRecord } from '../../services/supplierPayment.service';
import { clearSupplierPaymentDecision, clearSupplierPaymentIntent, confirmSupplierPaymentCancellation,
  confirmSupplierPaymentDecision, confirmSupplierPaymentSubmission, confirmSupplierPaymentVerification,
  confirmSupplierPaymentSubmissionReadBack, confirmSupplierPaymentDecisionReadBack,
  definitiveSupplierPaymentRegistrationRejection, confirmSupplierPaymentRegistrationRejected,
  prepareSupplierPaymentDecision, prepareSupplierPaymentIntent, readSupplierPaymentDecision, readSupplierPaymentIntent,
  supplierPaymentCents, supplierPaymentFormFacts, supplierPaymentInput, type SupplierPaymentDecisionIntent,
  type SupplierPaymentIntent } from './supplierPaymentIntent';

export type SupplierPayablesPanelProps = { canRecord: boolean; canVerify: boolean; currentUserId: string | number };
type Form = { amountNative: string; method: SupplierPaymentMethod; date: string; paymentAccountRef: string;
  externalTransactionRef: string; evidenceRef: string; note: string };
const emptyForm: Form = { amountNative: '', method: 'bank_transfer', date: '', paymentAccountRef: '',
  externalTransactionRef: '', evidenceRef: '', note: '' };
const button = 'rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700';
const panel = 'rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900';
const message = (error: unknown) => error instanceof Error ? error.message : '供应商应付读取或付款登记失败。';
const methodOptions = [
  { value: 'bank_transfer', label: '银行转账' }, { value: 'wire_transfer', label: '电汇' }, { value: 'cash', label: '现金' },
  { value: 'alipay', label: '支付宝' }, { value: 'wechat', label: '微信' }, { value: 'check', label: '支票' },
];

const SupplierPayablesPanel: React.FC<SupplierPayablesPanelProps> = ({ canRecord, canVerify, currentUserId }) => {
  const { notify } = useAppContext();
  const userId = String(currentUserId);
  const [page, setPage] = useState(1);
  const [list, setList] = useState<SupplierPayablePage | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [selected, setSelected] = useState<SupplierPayableCandidate | null>(null);
  const [bundle, setBundle] = useState<SupplierPaymentBundle | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [storageError, setStorageError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm);
  const [intent, setIntent] = useState<SupplierPaymentIntent | null>(null);
  const [decision, setDecision] = useState<SupplierPaymentDecisionIntent | null>(null);
  const [cancelTarget, setCancelTarget] = useState<SupplierPaymentRecord | null>(null);
  const [formRevision, setFormRevision] = useState(0);
  const [listRevision, setListRevision] = useState(0);
  const detailRequest = useRef<AbortController | null>(null);
  const active = useRef({ userId, receiptId: selected?.purchaseReceiptId ?? null });
  active.current = { userId, receiptId: selected?.purchaseReceiptId ?? null };
  const sameView = useCallback((actor: string, receiptId: number) => active.current.userId === actor && active.current.receiptId === receiptId, []);
  const { requestClose } = useUnsavedForm({ sourceId: 'supplier-payment-form', label: '外部供应商付款登记',
    open: selected !== null, enabled: canRecord && bundle !== null && !intent, value: form,
    resetKey: `${userId}/${selected?.purchaseReceiptId ?? ''}/${formRevision}` });

  useEffect(() => {
    detailRequest.current?.abort(); setSelected(null); setBundle(null); setForm(emptyForm);
    setIntent(null); setDecision(null); setCancelTarget(null); setStorageError(''); setDetailError(''); setPage(1);
    setBusy(false); setDetailLoading(false);
  }, [userId]);
  useEffect(() => {
    const controller = new AbortController();
    setListLoading(true); setListError(''); setList(null);
    void supplierPaymentService.getPayables(page, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setList(data);
    }).catch(error => {
      if (!isCanceledApiError(error) && !controller.signal.aborted) setListError(message(error));
    }).finally(() => { if (!controller.signal.aborted) setListLoading(false); });
    return () => controller.abort();
  }, [page, userId, listRevision]);
  useEffect(() => () => detailRequest.current?.abort(), []);

  const loadReceipt = useCallback(async (receiptId: number, actor: string) => {
    detailRequest.current?.abort();
    const controller = new AbortController(); detailRequest.current = controller;
    setDetailLoading(true); setDetailError(''); setStorageError(''); setBundle(null);
    try {
      const fresh = await supplierPaymentService.getPayments(receiptId, { signal: controller.signal });
      if (controller.signal.aborted || !sameView(actor, receiptId)) return;
      setBundle(fresh);
      let pending: SupplierPaymentIntent | null = null, pendingDecision: SupplierPaymentDecisionIntent | null = null;
      try {
        // Native localStorage is required: an in-memory fallback cannot survive a lost ACK plus refresh.
        pending = readSupplierPaymentIntent(window.localStorage, actor, String(receiptId));
        if (pending) {
          const committed = fresh.payments.find(row => row.submission.key === pending!.key);
          if (committed) {
            await confirmSupplierPaymentSubmission(pending, committed.submission);
            clearSupplierPaymentIntent(window.localStorage, pending); pending = null;
          }
        }
        pendingDecision = readSupplierPaymentDecision(window.localStorage, actor, String(receiptId));
        if (pendingDecision) {
          const committed = fresh.payments.find(row => row.id === pendingDecision!.paymentId);
          if (!committed) throw Error('原付款凭据尚未回读，不能清除原核验或取消操作。');
          if (committed.status !== 'draft') {
            confirmSupplierPaymentDecision(pendingDecision, committed);
            clearSupplierPaymentDecision(window.localStorage, pendingDecision); pendingDecision = null;
          }
        }
      } catch (error) {
        if (!controller.signal.aborted && sameView(actor, receiptId)) setStorageError(message(error));
      }
      if (controller.signal.aborted || !sameView(actor, receiptId)) return;
      setIntent(pending); setDecision(pendingDecision);
      setForm(pending ? { ...pending.facts, note: pending.facts.note || '' } : emptyForm);
      setFormRevision(value => value + 1);
    } catch (error) {
      if (!isCanceledApiError(error) && !controller.signal.aborted && sameView(actor, receiptId)) setDetailError(message(error));
    } finally {
      if (!controller.signal.aborted && sameView(actor, receiptId)) setDetailLoading(false);
    }
  }, [sameView]);

  const selectedReceiptId = selected?.purchaseReceiptId;
  useEffect(() => {
    if (!selectedReceiptId) return;
    setIntent(null); setDecision(null); setForm(emptyForm); setCancelTarget(null);
    void loadReceipt(selectedReceiptId, userId);
  }, [selectedReceiptId, userId, loadReceipt]);

  const refresh = () => {
    if (busy || detailLoading) return;
    requestClose(() => {
      setListRevision(value => value + 1);
      if (selected) void loadReceipt(selected.purchaseReceiptId, userId);
    });
  };
  const finished = async (receiptId: number, actor: string) => {
    if (!sameView(actor, receiptId)) return;
    setListRevision(value => value + 1);
    await loadReceipt(receiptId, actor);
  };
  const register = async () => {
    if (!canRecord || busy || detailLoading || !selected || !bundle || storageError || decision) return;
    const receiptId = selected.purchaseReceiptId, actor = userId;
    let pending: SupplierPaymentIntent | null = null;
    let failedPost = false;
    try {
      const facts = intent?.facts || supplierPaymentFormFacts({ ...form, currency: bundle.currency });
      if (!intent && (bundle.payments.some(row => row.status === 'draft')
        || supplierPaymentCents(facts.amountNative) > supplierPaymentCents(bundle.outstandingAmountNative))) {
        throw Error('先确认或取消现有未核验草稿；本次原币金额不能超过真实剩余应付。');
      }
      pending = prepareSupplierPaymentIntent(window.localStorage, actor, String(receiptId), facts, () => `sp-${crypto.randomUUID()}`);
      setIntent(pending); setBusy(true); setDetailError('');
      const response = await supplierPaymentService.register(receiptId, supplierPaymentInput(pending.facts), pending.key)
        .catch(error => { failedPost = true; throw error; });
      // A POST response is not a read-back: independently fetch the committed journal before clearing its key.
      if (JSON.stringify(response.payment.submission) !== JSON.stringify(response.submission)) throw Error('付款登记返回的原回执不一致。');
      const fresh = await supplierPaymentService.getPayments(receiptId);
      await confirmSupplierPaymentSubmissionReadBack(pending, response.submission, fresh);
      clearSupplierPaymentIntent(window.localStorage, pending);
      if (sameView(actor, receiptId)) {
        setIntent(null); notify('success', '原外部付款申请已确认登记；尚未核验的申请不减少应付。');
      }
      await finished(receiptId, actor);
    } catch (error) {
      const failure = error as ApiClientError | null;
      if (pending && failedPost && failure?.status === 409 && definitiveSupplierPaymentRegistrationRejection(failure.errorCode)) {
        try {
          // Only explicit no-effect POST rejections may be released, and only after an independent journal read proves this key absent.
          const fresh = await supplierPaymentService.getPayments(receiptId);
          confirmSupplierPaymentRegistrationRejected(pending, failure.errorCode, fresh);
          clearSupplierPaymentIntent(window.localStorage, pending);
          if (sameView(actor, receiptId)) {
            setIntent(null); setBundle(fresh); setListRevision(value => value + 1);
            setDetailError(`${message(error)} 已独立回读确认本次原key未登记，表单保留，可以修正后再申请。`);
          }
          return;
        } catch { /* Read failure, conflicting key or storage failure remains uncertain; preserve the original intent below. */ }
      }
      if (sameView(actor, receiptId)) {
        setDetailError(`${message(error)}${pending ? ' 原key和凭据已保留，请回读或确认原请求。' : ''}`);
        if (pending) setIntent(pending);
      }
    } finally { if (active.current.userId === actor) setBusy(false); }
  };
  const runDecision = async (kind: 'verify' | 'cancel', row: SupplierPaymentRecord, reason?: string) => {
    if (!selected || !bundle || busy || detailLoading || storageError || intent || (kind === 'verify' ? !canVerify : !canRecord)) return;
    const receiptId = selected.purchaseReceiptId, actor = userId;
    try {
      // A previously pending verification remains retryable even if later QA becomes held: the server decides replay vs fresh.
      if (kind === 'verify' && !decision && !bundle.paymentEligibility.eligible) throw Error(`QA尚未放行，付款核验被冻结：${bundle.paymentEligibility.reason}`);
      const pending = prepareSupplierPaymentDecision(window.localStorage, actor, String(receiptId), kind, row, reason);
      setDecision(pending); setBusy(true); setDetailError(''); setCancelTarget(null);
      const result = kind === 'verify' ? await supplierPaymentService.verify(row.id) : await supplierPaymentService.cancel(row.id, pending.reason!);
      if ('verification' in result) confirmSupplierPaymentVerification(result.payment, result.verification);
      else confirmSupplierPaymentCancellation(result.payment, result.cancellation);
      const fresh = await supplierPaymentService.getPayments(receiptId);
      const committed = confirmSupplierPaymentDecisionReadBack(pending, result.payment, fresh);
      const outcome = committed.status;
      clearSupplierPaymentDecision(window.localStorage, pending);
      if (sameView(actor, receiptId)) {
        setDecision(null); notify('success', outcome === 'verified' ? `已回读独立核验凭据，核验人 #${committed.verifiedByUserId}。`
          : '原草稿已由申请人取消；原凭据保留，不是退款或冲销。');
      }
      await finished(receiptId, actor);
    } catch (error) {
      if (sameView(actor, receiptId)) setDetailError(`${message(error)} 请回读原付款凭据；未确认操作不另行提交。`);
    } finally { if (active.current.userId === actor) setBusy(false); }
  };
  const retryDecision = () => {
    const row = bundle?.payments.find(item => item.id === decision?.paymentId);
    if (row && decision) void runDecision(decision.kind, row, decision.reason || undefined);
  };
  const update = <K extends keyof Form>(name: K, value: Form[K]) => setForm(before => ({ ...before, [name]: value }));
  const hasDraft = !!bundle?.payments.some(row => row.status === 'draft');
  const frozen = busy || detailLoading || !!intent || !!decision || !!storageError || !canRecord || !bundle || hasDraft;
  const registerDisabled = busy || detailLoading || !canRecord || !bundle || !!storageError || !!decision
    || (!intent && (hasDraft || supplierPaymentCents(bundle.outstandingAmountNative) === 0n));

  return <section data-testid="supplier-payables-panel" className={panel}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-base font-black text-slate-900 dark:text-white">供应商实收应付 / 外部付款登记</h3>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500 dark:text-slate-300">实收形成应付，QA放行前冻结付款核验。这里只登记实际外部付款凭据，不执行银行转账，也不重复记入销售应收现金流水。</p>
      </div>
      <button type="button" className={button} data-testid="supplier-payables-refresh" onClick={refresh} disabled={busy || listLoading || detailLoading}>刷新 / 回读原请求</button>
    </div>
    {listError && <p role="alert" className="mt-3 text-sm text-rose-600">{listError}</p>}
    {listLoading && <p role="status" className="mt-3 text-sm text-slate-500">正在读取实际实收应付…</p>}
    {list && <>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-xs">
          <caption className="sr-only">逐实收回执应付，不对不同币种合计</caption>
          <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-700"><tr>
            <th className="px-2 py-2">供应商 / 实收回执</th><th>实收 / 供应商批号</th><th>原币应付 / CNY账面</th><th>已核验 / 剩余原币</th><th>付款资格</th><th>操作</th>
          </tr></thead>
          <tbody>{list.items.map(row => <tr key={row.purchaseReceiptId} data-testid={`supplier-payable-row-${row.purchaseReceiptId}`}
            className={`border-b border-slate-100 dark:border-slate-800 ${selected?.purchaseReceiptId === row.purchaseReceiptId ? 'bg-blue-50 dark:bg-blue-950/30' : ''}`}>
            <td className="px-2 py-3"><p className="font-bold">{row.supplierName}</p><p>{row.receiptNo} · PO #{row.purchaseOrderId}</p></td>
            <td>{row.receivedQuantity} {row.unit}<br />{row.supplierBatchNo || '历史来源未确认'}</td>
            <td>{row.state === 'reconciled' ? <>{row.payableAmountNative} {row.currency}<br />{row.payableAmountBase} CNY</> : '历史来源未核对（非0应付）'}</td>
            <td>{row.state === 'reconciled' ? <>{row.paidAmountNative} / {row.outstandingAmountNative} {row.currency}</> : '未确认'}</td>
            <td>{row.paymentEligibility.eligible ? '最新QA已放行' : <span className="text-amber-700 dark:text-amber-300">核验冻结<br />{row.paymentEligibility.reason}</span>}</td>
            <td><button type="button" data-testid={`supplier-payable-open-${row.purchaseReceiptId}`} className={button}
              disabled={busy || detailLoading || row.state !== 'reconciled'} onClick={() => requestClose(() => setSelected(row))}>查看 / 登记</button></td>
          </tr>)}</tbody>
        </table>
        {list.items.length === 0 && <p className="py-6 text-center text-xs text-slate-500">暂无实际实收回执。</p>}
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
        <span>第 {list.page} 页 · {list.total} 张实收回执 · 不跨币种合计</span>
        <div className="flex gap-2"><button type="button" className={button} disabled={busy || listLoading || page <= 1} onClick={() => setPage(value => value - 1)}>上一页</button>
          <button type="button" className={button} disabled={busy || listLoading || page >= list.totalPages} onClick={() => setPage(value => value + 1)}>下一页</button></div>
      </div>
    </>}
    {selected && <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-700" data-testid="supplier-payment-detail">
      <div className="flex items-center justify-between"><h4 className="text-sm font-black">{selected.supplierName} · {selected.receiptNo}</h4>
        <button type="button" className={button} disabled={busy || detailLoading} onClick={() => requestClose(() => setSelected(null))}>收起</button></div>
      {(detailError || storageError) && <p data-testid="supplier-payment-error" role="alert" className="mt-3 text-sm text-rose-600">{storageError || detailError}</p>}
      {detailLoading && <p role="status" className="mt-3 text-sm text-slate-500">正在核对原实收、应付及付款凭据…</p>}
      {intent && <p data-testid="supplier-payment-unconfirmed" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">原登记结果尚未确认，原币金额、日期、账户、流水及凭据已冻结保存。请确认原请求或回读，不能另建请求。</p>}
      {decision && <div data-testid="supplier-payment-decision-unconfirmed" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
        原{decision.kind === 'verify' ? '核验' : '取消'}结果尚未确认。{decision.reason && `原取消原因：${decision.reason}`}
        <button type="button" className={`${button} ml-3`} data-testid="supplier-payment-decision-retry" disabled={busy || detailLoading || !!storageError
          || (decision.kind === 'verify' ? !canVerify : !canRecord)} onClick={retryDecision}>确认原操作</button>
      </div>}
      {bundle && <>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3" data-testid="supplier-payment-amounts">
          {[['实收应付', bundle.payableAmountNative, bundle.payableAmountBase], ['已核实外部付款', bundle.paidAmountNative, bundle.paidAmountBase],
            ['未核销应付', bundle.outstandingAmountNative, bundle.outstandingAmountBase]].map(([label, native, base]) => <div key={label} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
            <dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 font-data font-bold">{native} {bundle.currency}<br /><span className="font-normal text-slate-500">{base} CNY账面</span></dd>
          </div>)}
        </dl>
        <p data-testid="supplier-payment-eligibility" className={`mt-3 text-xs ${bundle.paymentEligibility.eligible ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
          {bundle.paymentEligibility.eligible ? '最新独立QA放行证据已确认；仍须另一财务人员核验付款。' : `付款核验冻结：${bundle.paymentEligibility.reason}。应付仍保留；可先登记待核验申请。`}</p>
        {canRecord && <form className="mt-4 rounded-xl border border-slate-200 p-3 dark:border-slate-700" onSubmit={event => { event.preventDefault(); void register(); }}>
          <h5 className="mb-3 text-sm font-bold">外部付款申请（登记不等于已付款）</h5>
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField dataTestId="supplier-payment-amount" label={`实际原币金额 (${bundle.currency})`} value={form.amountNative} onChange={value => update('amountNative', value)} disabled={frozen} required />
            <FormField dataTestId="supplier-payment-date" label="实际付款日期" type="date" value={form.date} onChange={value => update('date', value)} disabled={frozen} required />
            <FormField dataTestId="supplier-payment-method" label="外部付款方式" as="select" options={methodOptions} value={form.method} onChange={value => update('method', value as SupplierPaymentMethod)} disabled={frozen} />
            <FormField dataTestId="supplier-payment-account" label="财务备案账户编号" value={form.paymentAccountRef} onChange={value => update('paymentAccountRef', value)} disabled={frozen} maxLength={200} required hint="按原始标识登记，大小写不改写" />
            <FormField dataTestId="supplier-payment-transaction" label="实际外部流水号" value={form.externalTransactionRef} onChange={value => update('externalTransactionRef', value)} disabled={frozen} maxLength={200} required />
            <FormField dataTestId="supplier-payment-evidence" label="付款凭据引用" value={form.evidenceRef} onChange={value => update('evidenceRef', value)} disabled={frozen} maxLength={500} required hint="可核对的财务凭据编号或归档位置" />
          </div>
          <FormField dataTestId="supplier-payment-note" className="mt-3" label="备注" as="textarea" rows={2} value={form.note} onChange={value => update('note', value)} disabled={frozen} maxLength={2000} />
          <button type="submit" className={`${button} mt-3 bg-blue-600 text-white`} data-testid="supplier-payment-register" disabled={registerDisabled} aria-busy={busy}>
            {busy ? '正在确认…' : intent ? '确认原付款登记请求' : '登记待核验申请'}</button>
          {hasDraft && !intent && <p className="mt-2 text-xs text-slate-500">该实收回执已有未核验申请；先核验或由申请人取消，再登记下一笔。</p>}
        </form>}
        <div className="mt-4 space-y-3" data-testid="supplier-payment-history">
          <h5 className="text-sm font-bold">原始付款凭据</h5>
          {bundle.payments.length === 0 && <p className="text-xs text-slate-500">尚无付款申请；已核实外部付款为账面显示的实际金额。</p>}
          {bundle.payments.map(row => <article key={row.id} className={panel} data-testid={`supplier-payment-${row.id}`}>
            <div className="flex flex-wrap justify-between gap-2"><p className="text-sm font-bold">{row.paymentNo} · {row.amountNative} {row.currency} / {row.baseAmount} CNY</p>
              <span className="text-xs font-bold">{row.status === 'draft' ? '待独立核验（未计已付款）' : row.status === 'verified' ? '已核实外部付款' : '草稿已取消（非退款）'}</span></div>
            <p className="mt-2 break-all text-xs leading-5 text-slate-500">申请人 #{row.submittedByUserId} · 原始登记审计 #{row.submission.auditId}<br />
              {row.date.slice(0, 10)} · 账户 {row.paymentAccountRef} · 流水 {row.externalTransactionRef}<br />凭据 {row.evidenceRef}{row.note && ` · ${row.note}`}</p>
            {row.verification && <p className="mt-2 text-xs">独立核验人 #{row.verification.verifiedByUserId} · {row.verification.verifiedAt} · 核验审计 #{row.verification.auditId} · QA #{row.verification.qualityCheckId} / v{row.verification.qualityRevision}</p>}
            {row.cancellation && <p className="mt-2 text-xs">本人取消：{row.cancellation.reason} · {row.cancellation.cancelledAt} · 取消审计 #{row.cancellation.auditId}。原事实不可覆盖。</p>}
            {row.status === 'draft' && <div className="mt-3 flex flex-wrap gap-2">
              {canVerify && <button type="button" className={button} data-testid={`supplier-payment-verify-${row.id}`} disabled={busy || detailLoading || !!intent || !!decision || !!storageError
                || String(row.submittedByUserId) === userId || !bundle.paymentEligibility.eligible} onClick={() => void runDecision('verify', row)}>独立核验实际付款</button>}
              {canRecord && String(row.submittedByUserId) === userId && <button type="button" className={button} data-testid={`supplier-payment-cancel-${row.id}`}
                disabled={busy || detailLoading || !!intent || !!decision || !!storageError} onClick={() => setCancelTarget(row)}>取消本人未核验草稿</button>}
              {canVerify && String(row.submittedByUserId) === userId && <span className="self-center text-xs text-amber-700">不能核验本人申请</span>}
            </div>}
          </article>)}
        </div>
      </>}
    </div>}
    <ReasonDialog open={cancelTarget !== null} title="取消本人未核验付款草稿" description="只取消待核验申请，保留原凭据与审计，并释放该草稿占用的外部流水标识；不退款、不冲销已核验付款。"
      confirmLabel="确认取消草稿" testId="supplier-payment-cancel-dialog" loading={busy} required
      onCancel={() => setCancelTarget(null)} onConfirm={reason => { if (cancelTarget) return runDecision('cancel', cancelTarget, reason); }} />
  </section>;
};

export default SupplierPayablesPanel;
