import { useEffect, useState } from 'react';
import { productionService, type ProductionBatchTrace } from '../../services/production.service';

import { ProductionGenealogyReadback } from './ProductionGenealogyReadback';

export function ProductionBatchGenealogy({ batchId }: { batchId: number }) {
  const [state, setState] = useState<{ batchId: number; trace?: ProductionBatchTrace; error?: string }>({ batchId });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ batchId });
    void productionService.getBatchTrace(batchId, { signal: controller.signal }).then(trace => {
      if (!controller.signal.aborted) setState({ batchId, trace });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ batchId, error: error instanceof Error ? error.message : '追溯读取失败' });
    });
    return () => controller.abort();
  }, [batchId, revision]);
  const current = state.batchId === batchId ? state : { batchId };
  return <div data-testid={`production-genealogy-${batchId}`} className="rounded-[28px] bg-slate-50 dark:bg-slate-800/70 border border-slate-100 dark:border-slate-700 p-5 space-y-4">
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-sm font-bold text-slate-900 dark:text-white">物料批次关联</h3>
      <button type="button" onClick={() => { setState({ batchId }); setRevision(value => value + 1); }} className="shrink-0 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200">刷新追溯</button>
    </div>
    <p className="text-xs leading-5 text-slate-500">仅显示实际记录的直接上下游，不代表完整多级追溯。无关联不等于没有耗用。</p>
    {current.error ? <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">追溯读取失败：{current.error}。请刷新重试。</p>
      : current.trace ? <ProductionGenealogyReadback trace={current.trace} />
        : <p role="status" className="text-sm text-slate-500">正在读取追溯记录…</p>}
  </div>;
}
