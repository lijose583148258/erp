import { BadgeCheck, Beaker, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useAppContext } from '../../app/AppContext';
import { can } from '../../app/permissions';
import type { ProductionQualityCheck, ProductionWorkOrder } from '../../services/production.service';
import type { QualityFormErrors } from './productionWorkspaceSave';
import { formatDate, QC_RESULT_LABELS } from './productionWorkspaceConfig';
import { MiniTag, TextareaField } from './ProductionWorkspacePrimitives';

type Props = {
  workOrder: ProductionWorkOrder;
  checks: ProductionQualityCheck[];
  sampleNo: string;
  setSampleNo: (value: string) => void;
  measurementValues: Record<number, string>;
  setMeasurementValue: (characteristicId: number, value: string) => void;
  instrumentNumbers: Record<number, string>;
  setInstrumentNumber: (characteristicId: number, value: string) => void;
  note: string;
  setNote: (value: string) => void;
  reviewNote: string;
  setReviewNote: (value: string) => void;
  saving: boolean;
  errors: QualityFormErrors;
  onSubmit: () => void;
  onReview: (checkId: number, decision: 'release' | 'reject') => void;
  onMarkQcPending: () => void;
  onComplete: () => void;
};

const inputClass = 'min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-white';

export function ProductionQualityInspectionPanel({
  workOrder,
  checks,
  sampleNo,
  setSampleNo,
  measurementValues,
  setMeasurementValue,
  instrumentNumbers,
  setInstrumentNumber,
  note,
  setNote,
  reviewNote,
  setReviewNote,
  saving,
  errors,
  onSubmit,
  onReview,
  onMarkQcPending,
  onComplete,
}: Props) {
  const { currentUser } = useAppContext();
  const canInspect = can(currentUser, 'production.quality.inspect');
  const canRelease = can(currentUser, 'production.quality.release');
  const characteristics = workOrder.bom?.qualityCharacteristics || [];
  const latest = checks[0] || null;
  const released = latest?.status === 'released' && latest.result === 'pass';
  const waitingForReview = latest?.status === 'submitted';
  const isOwnInspection = Boolean(
    waitingForReview
    && latest?.inspectorUserId
    && currentUser?.id
    && Number(latest.inspectorUserId) === Number(currentUser.id),
  );
  const workflowSteps = [
    { label: '送检', complete: workOrder.status === 'qc_pending' || workOrder.status === 'completed' },
    { label: '录入实测值', complete: Boolean(latest) },
    { label: '独立放行', complete: released },
  ];

  return (
    <section className="space-y-4 rounded-[28px] border border-slate-100 bg-slate-50 p-4 sm:p-5 dark:border-slate-700 dark:bg-slate-800/70" data-testid="production-quality-inspection-panel">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-slate-500"><Beaker size={15} />质检与批次放行</div>
          <p className="mt-2 text-xs font-bold leading-5 text-slate-500">检验员逐项录值 → 系统按 BOM 标准判定 → 另一名放行人审核 → 才允许完工入库。检验员不能审核自己的记录。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <MiniTag label={`${characteristics.length} 个标准`} />
          <MiniTag label={latest ? `R${latest.revision} · ${latest.status}` : '尚未检验'} />
        </div>
      </div>

      <ol aria-label="质检流程进度" className="grid grid-cols-3 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        {workflowSteps.map((step, index) => {
          const active = !step.complete && (index === 0 || workflowSteps[index - 1]?.complete);
          return (
            <li key={step.label} className={`flex min-h-16 items-center gap-2 px-3 py-3 transition-colors duration-200 motion-reduce:transition-none sm:px-4 ${step.complete ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-200' : active ? 'bg-blue-50 text-blue-800 dark:bg-blue-950/20 dark:text-blue-200' : 'text-slate-400'}`}>
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${step.complete ? 'bg-emerald-600 text-white' : active ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}>{step.complete ? '✓' : index + 1}</span>
              <span className="text-[11px] font-black leading-4 sm:text-xs">{step.label}</span>
            </li>
          );
        })}
      </ol>

      {workOrder.status !== 'qc_pending' && workOrder.status !== 'completed' ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-bold leading-5 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
          当前工单状态为 {workOrder.status}。完成生产步骤后先送检，送检后才开放测量值录入。
          <button type="button" onClick={onMarkQcPending} className="mt-3 block min-h-11 rounded-xl bg-slate-900 px-4 text-xs font-black text-white">送交质检</button>
        </div>
      ) : null}

      {workOrder.status === 'qc_pending' && canInspect && !waitingForReview && !released ? (
        <div className="rounded-2xl border border-blue-100 bg-white p-4 transition-colors duration-200 motion-reduce:transition-none dark:border-blue-900/40 dark:bg-slate-900">
          <div className="text-xs font-black text-blue-700 dark:text-blue-300">第 1 步 · 检验员录入实测值</div>
          <label className="mt-3 block text-xs font-black text-slate-600 dark:text-slate-300">样品 / 留样编号
            <input data-testid="production-quality-sample-no" value={sampleNo} onChange={event => setSampleNo(event.target.value)} placeholder="例如 WO-20260801-S01" className={`${inputClass} mt-1.5`} />
          </label>
          {errors.sampleNo ? <div className="mt-2 text-xs font-bold text-rose-600">{errors.sampleNo}</div> : null}

          <div className="mt-4 space-y-3">
            {characteristics.map((item, index) => (
              <article key={item.id} className="rounded-2xl border border-slate-200 p-3 dark:border-slate-700" data-testid={`production-quality-measurement-${index}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-black text-slate-900 dark:text-white">{item.name} <span className="font-mono text-xs text-slate-400">{item.code}</span></div>
                    <div className="mt-1 text-[11px] font-bold text-slate-500">
                      {item.valueType === 'numeric' ? `合格范围 ${item.lowerLimit ?? '-∞'} ～ ${item.upperLimit ?? '+∞'} ${item.unit || ''}` : `合格值 ${item.targetText}`}
                      {item.testMethod ? ` · ${item.testMethod}` : ''}
                    </div>
                  </div>
                  {item.required ? <MiniTag label="必检" /> : null}
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="text-xs font-black text-slate-600 dark:text-slate-300">实测值
                    <input
                      data-testid={`production-quality-value-${item.id}`}
                      inputMode={item.valueType === 'numeric' ? 'decimal' : 'text'}
                      value={measurementValues[item.id] || ''}
                      onChange={event => setMeasurementValue(item.id, event.target.value)}
                      placeholder={item.valueType === 'numeric' ? `输入数值 ${item.unit || ''}` : `输入 ${item.targetText || '检验结果'}`}
                      className={`${inputClass} mt-1.5`}
                    />
                  </label>
                  <label className="text-xs font-black text-slate-600 dark:text-slate-300">仪器编号（可选）
                    <input data-testid={`production-quality-instrument-${item.id}`} value={instrumentNumbers[item.id] || ''} onChange={event => setInstrumentNumber(item.id, event.target.value)} placeholder="设备 / 仪器编号" className={`${inputClass} mt-1.5`} />
                  </label>
                </div>
              </article>
            ))}
          </div>
          {errors.measurements ? <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 dark:bg-rose-950/20 dark:text-rose-200">{errors.measurements}</div> : null}
          <div className="mt-4"><TextareaField dataTestId="production-quality-note" label="检验备注" value={note} onChange={setNote} placeholder="记录留样位置、异常现象、复检背景" /></div>
          <button type="button" data-testid="production-qc-save" onClick={onSubmit} disabled={saving || characteristics.length === 0} className="mt-4 min-h-12 w-full rounded-2xl bg-blue-600 px-5 text-xs font-black text-white disabled:opacity-50 sm:w-auto">{saving ? '提交中...' : '提交检验记录（进入待审核）'}</button>
        </div>
      ) : null}

      {workOrder.status === 'qc_pending' && !canInspect && !waitingForReview && !released ? (
        <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-xs font-bold leading-5 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"><LockKeyhole className="mt-0.5 shrink-0" size={16} />当前账号没有“执行生产质检”权限。测量值必须由独立检验角色录入。</div>
      ) : null}

      {latest?.status === 'submitted' ? (
        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-900/50 dark:bg-violet-950/20">
          <div className="flex items-center gap-2 text-xs font-black text-violet-700 dark:text-violet-200"><ShieldCheck size={16} />第 2 步 · 独立审核与处置</div>
          <div className="mt-2 text-xs font-bold text-slate-600 dark:text-slate-300">{latest.checkNo} · 系统判定 {QC_RESULT_LABELS[latest.result]} · 检验员 {latest.checkedBy || '-'} · {formatDate(latest.checkedAt)}</div>
          {canRelease && !isOwnInspection ? (
            <>
              <textarea data-testid="production-quality-review-note" value={reviewNote} onChange={event => setReviewNote(event.target.value)} rows={2} placeholder="必填：审核依据、复核情况或隔离原因" className={`${inputClass} mt-3 py-3`} />
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <button type="button" data-testid="production-qc-release" onClick={() => onReview(latest.id, 'release')} disabled={!reviewNote.trim() || latest.result !== 'pass' || saving} className="min-h-11 rounded-xl bg-emerald-600 px-4 text-xs font-black text-white disabled:opacity-50">审核通过并放行</button>
                <button type="button" data-testid="production-qc-reject" onClick={() => onReview(latest.id, 'reject')} disabled={!reviewNote.trim() || saving} className="min-h-11 rounded-xl bg-rose-600 px-4 text-xs font-black text-white disabled:opacity-50">拒绝并隔离</button>
              </div>
            </>
          ) : <div className="mt-3 rounded-xl border border-violet-200 bg-white/70 px-3 py-2 text-xs font-bold leading-5 text-violet-700 dark:border-violet-800 dark:bg-slate-900/40 dark:text-violet-200">{isOwnInspection ? '职责分离：这条记录由当前账号检验，必须切换另一名有放行权限的账号审核。' : '当前账号没有放行权限；请由经理或质量放行角色审核。'}</div>}
        </div>
      ) : null}

      {released && workOrder.status === 'qc_pending' ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/20">
          <div className="flex items-center gap-2 text-sm font-black text-emerald-800 dark:text-emerald-200"><BadgeCheck size={18} />检验已由 {latest.reviewedBy} 放行</div>
          <p className="mt-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">现在可以确认实际耗料并完工入库；系统会把批次标记为 released。</p>
          <button type="button" data-testid="production-quality-enter-completion" onClick={onComplete} className="mt-3 min-h-12 w-full rounded-xl bg-emerald-600 px-5 text-xs font-black text-white transition-colors duration-200 hover:bg-emerald-700 motion-reduce:transition-none sm:w-auto">进入耗料确认并完工</button>
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">检验历史</div>
        <div className="mt-3 space-y-2">
          {checks.length === 0 ? <div className="text-xs font-bold text-slate-400">暂无检验记录</div> : checks.map(check => (
            <article key={check.id} className="rounded-xl border border-slate-100 px-3 py-3 dark:border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-2"><div className="text-xs font-black text-slate-900 dark:text-white">R{check.revision} · {check.checkNo}</div><MiniTag label={`${QC_RESULT_LABELS[check.result]} · ${check.status}`} /></div>
              <div className="mt-1 text-[11px] font-bold text-slate-500">样品 {check.sampleNo || '-'} · 检验 {check.checkedBy || '-'} · 审核 {check.reviewedBy || '-'}</div>
              {check.measurements?.length ? <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">{check.measurements.map(item => <div key={item.id} className="text-[11px] font-bold text-slate-600 dark:text-slate-300">{item.characteristicName}: {item.measuredNumeric ?? item.measuredText ?? '-'} {item.unit || ''} · {QC_RESULT_LABELS[item.result]}</div>)}</div> : null}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
