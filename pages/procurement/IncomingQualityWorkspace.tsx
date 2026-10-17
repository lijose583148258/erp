import { useEffect, useRef, useState } from 'react';
import { FormField, StatusBadge } from '../../components/ui';
import { useUnsavedForm } from '../../app/useUnsavedForm';
import { incomingQualityService, type IncomingQualityBundle, type IncomingQualityList,
  type IncomingQualityInput } from '../../services/incomingQuality.service';
import { readIncomingQualityIntent, prepareIncomingInspectionIntent, prepareIncomingReviewIntent,
  clearIncomingQualityIntent, confirmIncomingInspection, confirmIncomingReview,
  isDefinitiveIncomingQualityRejection,
  type IncomingQualityIntent } from './incomingQualityIntent';

export type IncomingQualityWorkspaceProps = { canInspect: boolean; canRelease: boolean; currentUserId: string | number };
type MeasurementDraft = { value: string; instrumentNo: string };
const button = 'rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700';
const errorText = (error: unknown) => error instanceof Error ? error.message : '来料检验请求失败';
class RejectedQualityCommand extends Error {}
const statusLabel: Record<string, string> = { submitted: '待独立 QA 审核', released: '已放行', rejected: '已隔离', hold: '待检 / 复检冻结', quarantine: '隔离' };
const when = (value: string) => value.replace('T', ' ').replace(/\.\d+Z$/, ' UTC').replace(/Z$/, ' UTC');

export function IncomingQualityWorkspace({ canInspect, canRelease, currentUserId }: IncomingQualityWorkspaceProps) {
  const actor = String(currentUserId), canRead = canInspect || canRelease;
  const [page, setPage] = useState(1), [list, setList] = useState<IncomingQualityList | null>(null);
  const [listLoading, setListLoading] = useState(false), [listError, setListError] = useState('');
  const [receiptId, setReceiptId] = useState<number | null>(null), [bundle, setBundle] = useState<IncomingQualityBundle | null>(null);
  const [pending, setPending] = useState<IncomingQualityIntent | null>(null), [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0), [sampleNo, setSampleNo] = useState(''), [note, setNote] = useState('');
  const [reason, setReason] = useState(''), [drafts, setDrafts] = useState<Record<string, MeasurementDraft>>({});
  const [formRevision, setFormRevision] = useState(0);
  const [rejectedUnsubmitted, setRejectedUnsubmitted] = useState(false);
  const flight = useRef(false), current = useRef({ actor, receiptId });
  current.current = { actor, receiptId };
  const { requestClose } = useUnsavedForm({ sourceId: 'incoming-quality-form', label: '实际来料测量 / QA 审核依据',
    open: receiptId !== null, enabled: canRead && !!bundle && !loading, touched: !pending,
    value: { sampleNo, note, reason, drafts, rejectedUnsubmitted }, resetKey: `${actor}/${receiptId ?? ''}/${formRevision}` });

  useEffect(() => {
    if (!canRead) { setList(null); return; }
    const controller = new AbortController();
    setListLoading(true); setListError(''); setList(null);
    incomingQualityService.list(page, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setList(result);
    }).catch(cause => { if (!controller.signal.aborted) setListError(errorText(cause)); })
      .finally(() => { if (!controller.signal.aborted) setListLoading(false); });
    return () => controller.abort();
  }, [actor, canRead, page, reload]);

  useEffect(() => {
    setBundle(null); setPending(null); setError(''); setNotice(''); setSampleNo(''); setNote(''); setReason(''); setDrafts({}); setRejectedUnsubmitted(false);
    if (!canRead || receiptId === null) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    (async () => {
      // A corrupt/unavailable identity store must fail closed BEFORE enabling a form.
      const saved = readIncomingQualityIntent(localStorage, actor, String(receiptId));
      if (!controller.signal.aborted) setPending(saved);
      const next = await incomingQualityService.get(receiptId, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const inputs = saved?.kind === 'inspection' ? saved.input : null;
      setSampleNo(inputs?.sampleNo || ''); setNote(inputs?.note || '');
      setReason(saved?.kind === 'review' ? saved.input.reason : '');
      setDrafts(Object.fromEntries(next.plan.characteristics.map(item => {
        const measured = inputs?.measurements.find(value => value.code === item.code.toUpperCase());
        return [item.code, { value: measured?.measuredNumeric ?? measured?.measuredText ?? '', instrumentNo: measured?.instrumentNo || '' }];
      })));
      setBundle(next);
    })().catch(cause => { if (!controller.signal.aborted) setError(errorText(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [actor, canRead, receiptId, reload]);

  const latest = bundle?.qualityChecks[0];
  const locked = busy || loading || !!pending || !bundle;
  const independent = latest && latest.inspectorUserId !== Number(actor);
  const canReviewLatest = canRelease && independent && latest?.status === 'submitted' && !locked;
  const provenRelease = !!latest && latest.status === 'released' && latest.result === 'pass'
    && latest.decision === 'released' && latest.reviewedByUserId !== null && latest.reviewedByUserId !== latest.inspectorUserId
    && !!latest.reviewedAt && bundle?.receipt.qualityStatus === 'released';
  const changeMeasurement = (code: string, patch: Partial<MeasurementDraft>) =>
    setDrafts(previous => ({ ...previous, [code]: { ...previous[code], ...patch } }));

  async function execute(intent: IncomingQualityIntent) {
    const selected = { actor, receiptId };
    if (Number(intent.receiptId) !== receiptId || intent.userId !== actor) throw Error('当前请求与操作人或实收批次不一致');
    if (intent.kind === 'inspection' ? !canInspect : !canRelease) throw Error('当前角色没有原操作权限');
    const result = await (async () => {
      try {
        return intent.kind === 'inspection'
          ? await incomingQualityService.submit(Number(intent.receiptId), intent.input, intent.key)
          : await incomingQualityService.review(intent.check.id, intent.input);
      } catch (cause) {
        if (isDefinitiveIncomingQualityRejection(intent, cause)) throw new RejectedQualityCommand(errorText(cause));
        throw cause;
      }
    })();
    // The ACK alone is not a pass. Reload the authoritative original revision.
    const next = await incomingQualityService.get(Number(intent.receiptId));
    if ('submission' in result) await confirmIncomingInspection(intent, result.submission, next);
    else confirmIncomingReview(intent, result.review, next);
    clearIncomingQualityIntent(localStorage, intent);
    if (current.current.actor === selected.actor && current.current.receiptId === selected.receiptId) {
      setBundle(next); setPending(null); setSampleNo(''); setNote(''); setReason(''); setRejectedUnsubmitted(false);
      setDrafts(Object.fromEntries(next.plan.characteristics.map(item => [item.code, { value: '', instrumentNo: '' }])));
      setFormRevision(value => value + 1);
      setNotice(result.replayed ? '原请求回执及原版本已核对；当前批次状态以下方最新记录为准。' : '实际回执及原版本已核对，记录已保存。');
    }
  }
  async function act(kind: 'inspection' | 'released' | 'rejected' | 'retry') {
    if (flight.current || !bundle || receiptId === null || loading) return;
    flight.current = true; setBusy(true); setError(''); setNotice('');
    let intent: IncomingQualityIntent | null = null;
    try {
      const saved = readIncomingQualityIntent(localStorage, actor, String(receiptId));
      if (kind === 'retry') {
        if (!saved) throw Error('没有需要确认的原请求');
        intent = saved;
      } else {
        if (saved) throw Error('先确认原请求，不能改实测值或审核结论重新提交');
        if (kind === 'inspection') {
          if (!canInspect) throw Error('当前角色没有检验权限');
          const measurements: IncomingQualityInput['measurements'] = [];
          for (const item of bundle.plan.characteristics) {
            const draft = drafts[item.code], value = draft?.value.trim() || '';
            if (!item.required && !value && !draft?.instrumentNo.trim()) continue;
            if (!value || !draft?.instrumentNo.trim()) throw Error(`${item.name}须填写实际测量值和仪器/方法记录编号`);
            measurements.push({ code: item.code, unit: item.unit, measuredNumeric: item.valueType === 'numeric' ? value : null,
              measuredText: item.valueType === 'text' ? value : null, instrumentNo: draft.instrumentNo });
          }
          intent = prepareIncomingInspectionIntent(localStorage, actor, String(receiptId), { sampleNo, measurements, note }, () => crypto.randomUUID());
        } else {
          if (!canReviewLatest || !latest) throw Error('仅另一位授权 QA 可审核最新待审记录');
          intent = prepareIncomingReviewIntent(localStorage, actor, String(receiptId), latest,
            { expectedRevision: latest.revision, decision: kind, reason });
        }
      }
      setPending(intent);
      await execute(intent);
    } catch (cause) {
      // Never silently rotate a key after a timeout, key conflict or bad read-back.
      // Also recover writes that succeeded locally but failed their persistence check.
      if (current.current.actor === actor && current.current.receiptId === receiptId) {
        let rejected = false;
        try {
          if (intent && cause instanceof RejectedQualityCommand) {
            clearIncomingQualityIntent(localStorage, intent); rejected = true; setRejectedUnsubmitted(true);
          }
          setPending(readIncomingQualityIntent(localStorage, actor, String(receiptId)));
        } catch { setBundle(null); }
        setError(`${errorText(cause)}${intent ? rejected ? ' 服务端已明确拒绝且未写入；已保留填写内容，请核对最新记录后修正。' : ' 原请求已保留，请使用“确认原请求”，不要重建。' : ''}`);
        if (rejected) {
          // Read only: never replay an old decision against a newer QC revision.
          try {
            const next = await incomingQualityService.get(receiptId);
            if (current.current.actor === actor && current.current.receiptId === receiptId) setBundle(next);
          } catch (readError) {
            if (current.current.actor === actor && current.current.receiptId === receiptId) {
              setBundle(null); setError(`${errorText(cause)}；最新记录读取失败：${errorText(readError)}`);
            }
          }
        }
      }
    } finally { flight.current = false; setBusy(false); }
  }

  if (!canRead) return <p role="status" className="p-4 text-sm text-slate-500">当前角色没有来料检验或 QA 审核权限。</p>;
  return <section data-testid="incoming-quality-workspace" className="space-y-4 text-slate-900 dark:text-slate-100">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-black">来料检验 / QA 放行</h2><p className="text-sm text-slate-500 dark:text-slate-400">冻结实收检验依据 · 真实测量 · 独立审核。列表仅用于选择，不表示已放行。</p></div>
      <button className={button} disabled={busy || loading || listLoading} data-testid="incoming-quality-refresh" onClick={() => requestClose(() => setReload(value => value + 1))}>刷新实际记录</button>
    </div>
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
      <aside className="rounded-xl border border-slate-200 p-3 dark:border-slate-800" aria-label="实收批次列表">
        {listLoading && <p role="status" className="p-3 text-sm">正在读取实收批次…</p>}
        {listError && <p role="alert" className="p-3 text-sm text-rose-600 dark:text-rose-300">{listError}</p>}
        {list && !list.rows.length && <p className="p-3 text-sm text-slate-500">暂无可选实收批次。</p>}
        <div className="max-h-[650px] space-y-1 overflow-y-auto">
          {list?.rows.map(row => <button key={row.id} type="button" data-testid={`incoming-quality-select-${row.id}`} disabled={busy}
            aria-pressed={receiptId === row.id} onClick={() => { if (receiptId !== row.id) requestClose(() => { setReceiptId(row.id); setNotice(''); }); }}
            className={`w-full rounded-lg p-3 text-left disabled:opacity-50 ${receiptId === row.id ? 'bg-emerald-50 ring-1 ring-emerald-600 dark:bg-emerald-950/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
            <span className="block break-words text-sm font-bold">{row.productName || row.receiptNo}</span>
            <span className="block break-all text-xs text-slate-500">{row.receiptNo} · {row.acceptedQuantity} {row.unit}</span>
            <span className="block break-all text-xs text-slate-500">供应商批号：{row.supplierBatchNo || '未核对'}</span>
            <span className="block text-xs text-slate-500">{when(row.receivedAt)}</span>
            {row.historyUnreconciled && <span className="text-xs font-bold text-amber-700 dark:text-amber-300">历史来源待核对（不允许猜检验标准）</span>}
          </button>)}
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
          <button className={button} disabled={busy || listLoading || page <= 1} onClick={() => setPage(value => value - 1)}>上一页</button>
          <span className="text-xs">{page} / {Math.max(1, list?.meta.totalPages || 0)} · {list?.meta.total ?? '—'} 条</span>
          <button className={button} disabled={busy || listLoading || !list || page >= list.meta.totalPages} onClick={() => setPage(value => value + 1)}>下一页</button>
        </div>
      </aside>
      <div className="min-w-0 space-y-4">
        {receiptId === null && <p className="rounded-xl border border-dashed border-slate-300 p-8 text-sm text-slate-500 dark:border-slate-700">先选择实收批次。此工作台不读取采购价格或应付金额。</p>}
        {loading && <p role="status">正在核对原实收来源与检验记录…</p>}
        {error && <p role="alert" data-testid="incoming-quality-error" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{error}</p>}
        {notice && <p role="status" data-testid="incoming-quality-notice" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">{notice}</p>}
        {pending && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30" data-testid="incoming-quality-pending">
          <p className="font-bold">有一笔待确认的原{pending.kind === 'inspection' ? '检验' : 'QA 审核'}请求，事实已冻结。</p>
          <p className="mt-1 break-all">{pending.kind === 'inspection' ? `样本：${pending.input.sampleNo} · 请求：${pending.key}` : `检验：${pending.check.checkNo} / r${pending.input.expectedRevision} · ${statusLabel[pending.input.decision]} · ${pending.input.reason}`}</p>
          <button className={`${button} mt-2 bg-white dark:bg-slate-900`} data-testid="incoming-quality-retry" disabled={busy || loading || !bundle || (pending.kind === 'inspection' ? !canInspect : !canRelease)} onClick={() => void act('retry')}>{busy ? '正在确认…' : '确认原请求'}</button>
          <p className="mt-1 text-xs">网络中断或刷新后继续使用同一请求；不另建样本、不重放旧放行到新复检。</p>
        </div>}
        {bundle && <>
          <header className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-black">{bundle.receipt.productName}</h3><p className="break-all text-sm text-slate-500">{bundle.receipt.receiptNo} · PO #{bundle.receipt.purchaseOrderId} · 实收 {bundle.receipt.acceptedQuantity} {bundle.receipt.unit}</p></div>
              <StatusBadge status={provenRelease ? 'released' : bundle.receipt.qualityStatus === 'released' ? 'hold' : bundle.receipt.qualityStatus}
                label={provenRelease ? '最新检验已独立 QA 放行' : bundle.receipt.qualityStatus === 'released' ? '放行标志待核对（不是 QA 凭证）' : statusLabel[bundle.receipt.qualityStatus] || '状态待核对'} />
            </div>
            <p className="mt-2 break-all text-xs text-slate-500">供应商批号 {bundle.receipt.supplierBatchNo} · 内部批号 {bundle.receipt.batchNo} · 实收 {when(bundle.receipt.receivedAt)}</p>
            <p className="mt-2 text-sm font-bold">冻结标准：{bundle.plan.specificationRef} / {bundle.plan.specificationRevision}</p>
          </header>
          <section aria-label="实测检验" className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h3 className="font-black">实际测量{latest ? `（新增复检将冻结批次，已有 r${latest.revision}）` : ''}</h3>{!canInspect && <span className="text-xs text-slate-500">只读；无检验提交权限</span>}</div>
            <div className="mb-4 grid gap-3 sm:grid-cols-2"><FormField label="实际样本编号" value={sampleNo} onChange={setSampleNo} maxLength={120} required disabled={locked || !canInspect} dataTestId="incoming-quality-sample" />
              <FormField label="检验备注" value={note} onChange={setNote} maxLength={2000} disabled={locked || !canInspect} dataTestId="incoming-quality-note" /></div>
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {bundle.plan.characteristics.map(item => <div key={item.code} className="grid gap-3 py-3 xl:grid-cols-[minmax(0,1fr)_minmax(180px,1fr)_minmax(180px,1fr)]">
                <div className="min-w-0"><p className="break-words text-sm font-bold">{item.code} · {item.name}{item.required ? '（必检）' : '（选检）'}</p>
                  <p className="break-words text-xs text-slate-500">{item.valueType === 'numeric' ? `范围 ${item.lowerLimit ?? '无下限'} ～ ${item.upperLimit ?? '无上限'} ${item.unit || '无单位'}` : `目标 ${item.targetText || '未提供'} / ${item.unit || '无单位'}`}</p><p className="break-words text-xs text-slate-500">方法：{item.testMethod}</p></div>
                <FormField label={`实测 ${item.name}${item.unit ? ` (${item.unit})` : ''}`} value={drafts[item.code]?.value || ''} onChange={value => changeMeasurement(item.code, { value })}
                  maxLength={200} required={item.required} disabled={locked || !canInspect} hint={item.valueType === 'numeric' ? '原始十进制字符串，不四舍五入；服务端判定结果' : '填写实际观察值；服务端判定结果'} dataTestId={`incoming-quality-value-${item.code}`} />
                <FormField label="仪器 / 方法记录编号" value={drafts[item.code]?.instrumentNo || ''} onChange={instrumentNo => changeMeasurement(item.code, { instrumentNo })}
                  maxLength={120} required={item.required} disabled={locked || !canInspect} dataTestId={`incoming-quality-instrument-${item.code}`} />
              </div>)}
            </div>
            {canInspect && <button className={`${button} mt-4 bg-emerald-600 text-white`} data-testid="incoming-quality-submit" disabled={locked} onClick={() => void act('inspection')}>提交实际测量（冻结批次）</button>}
          </section>
          {canRelease && latest && <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-800" aria-label="独立 QA 审核">
            <h3 className="font-black">独立 QA · 最新 r{latest.revision}</h3>
            <p data-testid="incoming-quality-review-state" className="my-2 text-sm text-slate-500">检验人 #{latest.inspectorUserId} · 当前审核人 #{actor} · {latest.status === 'released'
              ? '已独立 QA 放行；原审核决定只读，新增复检会重新冻结批次'
              : latest.status === 'rejected' ? '已隔离；原审核决定只读，需重新实际检验'
                : latest.result === 'pass' ? '实测合格，仍须独立审核' : '实测不合格，只能隔离或重新实际检验'}</p>
            {!independent && <p className="mb-2 text-sm text-amber-700 dark:text-amber-300">本人提交的检验不能自行审核。</p>}
            <FormField label="QA 审核依据 / 原因（至少 3 字）" value={reason} onChange={setReason} as="textarea" maxLength={2000} disabled={!canReviewLatest} dataTestId="incoming-quality-review-reason" />
            <div className="mt-3 flex flex-wrap gap-2"><button className={`${button} bg-emerald-600 text-white`} data-testid="incoming-quality-release" disabled={!canReviewLatest || latest.result !== 'pass'} onClick={() => void act('released')}>独立 QA 放行最新版本</button>
              <button className={`${button} text-rose-700 dark:text-rose-300`} data-testid="incoming-quality-reject" disabled={!canReviewLatest} onClick={() => void act('rejected')}>隔离 / 拒绝放行</button></div>
          </section>}
          <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-800" aria-label="检验历史"><h3 className="mb-3 font-black">不可改写的检验历史</h3>
            {!bundle.qualityChecks.length && <p className="text-sm text-slate-500">尚无实测记录；不能凭批次标志放行。</p>}
            <div className="space-y-3">{bundle.qualityChecks.map(check => <details key={check.id} open={check.id === latest?.id} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-900" data-testid={`incoming-quality-check-${check.id}`}>
              <summary className="cursor-pointer text-sm font-bold">r{check.revision} · {check.checkNo} · 样本 {check.sampleNo} · {check.result === 'pass' ? '实测合格' : '实测不合格'} · {statusLabel[check.status]}</summary>
              <p className="my-2 text-xs text-slate-500">检验人 #{check.inspectorUserId} · {when(check.checkedAt)}{check.reviewedByUserId ? ` · QA #${check.reviewedByUserId} · ${when(check.reviewedAt!)}` : ''}</p>
              <ul className="space-y-1 text-sm">{check.measurements.map(item => <li key={item.code} className="break-words">{item.code} · {item.measuredNumeric ?? item.measuredText} {item.unit || ''} · 仪器/记录 {item.instrumentNo} · {item.result === 'pass' ? '合格' : '不合格'}</li>)}</ul>
              {check.note && <p className="mt-2 break-words text-sm">检验备注：{check.note}</p>}{check.reviewNote && <p className="mt-2 break-words text-sm">QA 依据：{check.reviewNote}</p>}
            </details>)}</div>
          </section>
        </>}
      </div>
    </div>
  </section>;
}

export default IncomingQualityWorkspace;
