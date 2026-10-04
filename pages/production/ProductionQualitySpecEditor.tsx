import { Plus, Trash2 } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { newQualityCharacteristicDraft, type QualityCharacteristicDraft } from './useProductionWorkspaceForms';

type Props = {
  rows: QualityCharacteristicDraft[];
  setRows: Dispatch<SetStateAction<QualityCharacteristicDraft[]>>;
};

const inputClass = 'min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-white';

export function ProductionQualitySpecEditor({ rows, setRows }: Props) {
  const update = (rowKey: string, patch: Partial<QualityCharacteristicDraft>) => {
    setRows(current => current.map(row => row.rowKey === rowKey ? { ...row, ...patch } : row));
  };

  const addCommonChemicalTemplate = () => {
    const existing = new Set(rows.map(row => row.code.trim().toUpperCase()));
    const templates: Array<Pick<QualityCharacteristicDraft, 'code' | 'name' | 'unit' | 'valueType'>> = [
      { code: 'SOLIDS', name: '固含量', unit: '%', valueType: 'numeric' },
      { code: 'VISCOSITY', name: '粘度', unit: 'mPa·s', valueType: 'numeric' },
      { code: 'PH', name: 'pH', unit: '', valueType: 'numeric' },
      { code: 'APPEARANCE', name: '外观', unit: '', valueType: 'text' },
    ];
    setRows(current => [
      ...current,
      ...templates.filter(item => !existing.has(item.code)).map(item => ({
        ...newQualityCharacteristicDraft(),
        ...item,
        targetText: item.valueType === 'text' ? '合格' : '',
      })),
    ]);
  };

  return (
    <section className="rounded-[24px] border border-violet-100 bg-violet-50/40 p-4 dark:border-violet-900/40 dark:bg-violet-950/10" data-testid="production-quality-spec-editor">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.18em] text-violet-700 dark:text-violet-300">放行标准 · 逐项判定</div>
          <p className="mt-1 text-xs font-bold leading-5 text-slate-500">每一项都要明确上下限或文本合格值。摘要只供阅读，下面这些结构化项目才参与质检判定。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" data-testid="production-quality-spec-add-template" onClick={addCommonChemicalTemplate} className="min-h-10 rounded-xl border border-violet-200 bg-white px-3 text-xs font-black text-violet-700 transition-colors duration-200 hover:bg-violet-50 motion-reduce:transition-none dark:border-violet-800 dark:bg-slate-900 dark:text-violet-200 dark:hover:bg-violet-950/30">加入常用化工项目</button>
          <button type="button" data-testid="production-quality-spec-add-row" onClick={() => setRows(current => [...current, newQualityCharacteristicDraft()])} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-violet-600 px-3 text-xs font-black text-white transition-colors duration-200 hover:bg-violet-700 motion-reduce:transition-none"><Plus size={14} />新增检验项</button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-violet-200 bg-white/70 px-4 py-5 text-center text-xs font-bold text-slate-500 dark:border-violet-800 dark:bg-slate-900/60">草稿可暂不配置；化工配方进入审批或启用前必须补齐放行标准。</div>
      ) : (
        <div className="mt-4 space-y-3">
          {rows.map((row, index) => (
            <article key={row.rowKey} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900" data-testid={`production-quality-spec-row-${index}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-black text-slate-500">检验项 {index + 1}</div>
                <button type="button" aria-label={`删除检验项 ${index + 1}`} onClick={() => setRows(current => current.filter(item => item.rowKey !== row.rowKey))} className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 motion-reduce:transition-none dark:hover:bg-rose-950/30"><Trash2 size={15} /></button>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
                <label className="text-xs font-black text-slate-600 dark:text-slate-300">项目编码<input data-testid={`production-quality-spec-code-${index}`} value={row.code} onChange={event => update(row.rowKey, { code: event.target.value.toUpperCase() })} placeholder="例如 SOLIDS" className={`${inputClass} mt-1.5 font-mono uppercase`} /></label>
                <label className="text-xs font-black text-slate-600 dark:text-slate-300">项目名称<input data-testid={`production-quality-spec-name-${index}`} value={row.name} onChange={event => update(row.rowKey, { name: event.target.value })} placeholder="例如 固含量" className={`${inputClass} mt-1.5`} /></label>
                <label className="text-xs font-black text-slate-600 dark:text-slate-300">判定类型<select data-testid={`production-quality-spec-type-${index}`} value={row.valueType} onChange={event => update(row.rowKey, { valueType: event.target.value as 'numeric' | 'text' })} className={`${inputClass} mt-1.5`}><option value="numeric">数值范围</option><option value="text">文本合格值</option></select></label>
                <label className="text-xs font-black text-slate-600 dark:text-slate-300">单位<input data-testid={`production-quality-spec-unit-${index}`} value={row.unit} onChange={event => update(row.rowKey, { unit: event.target.value })} placeholder="%、mPa·s" className={`${inputClass} mt-1.5`} /></label>
              </div>
              {row.valueType === 'numeric' ? (
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <label className="text-xs font-black text-slate-600 dark:text-slate-300">合格下限<input data-testid={`production-quality-spec-lower-${index}`} inputMode="decimal" value={row.lowerLimit} onChange={event => update(row.rowKey, { lowerLimit: event.target.value })} placeholder="允许只填一侧" className={`${inputClass} mt-1.5`} /></label>
                  <label className="text-xs font-black text-slate-600 dark:text-slate-300">合格上限<input data-testid={`production-quality-spec-upper-${index}`} inputMode="decimal" value={row.upperLimit} onChange={event => update(row.rowKey, { upperLimit: event.target.value })} placeholder="允许只填一侧" className={`${inputClass} mt-1.5`} /></label>
                  <label className="text-xs font-black text-slate-600 dark:text-slate-300">检验方法<input data-testid={`production-quality-spec-method-${index}`} value={row.testMethod} onChange={event => update(row.rowKey, { testMethod: event.target.value })} placeholder="例如 GB/T 1725" className={`${inputClass} mt-1.5`} /></label>
                </div>
              ) : (
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="text-xs font-black text-slate-600 dark:text-slate-300">合格值<input data-testid={`production-quality-spec-target-${index}`} value={row.targetText} onChange={event => update(row.rowKey, { targetText: event.target.value })} placeholder="多个允许值用 | 分隔，例如 合格|通过" className={`${inputClass} mt-1.5`} /></label>
                  <label className="text-xs font-black text-slate-600 dark:text-slate-300">检验方法<input data-testid={`production-quality-spec-method-${index}`} value={row.testMethod} onChange={event => update(row.rowKey, { testMethod: event.target.value })} placeholder="例如 目测" className={`${inputClass} mt-1.5`} /></label>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
