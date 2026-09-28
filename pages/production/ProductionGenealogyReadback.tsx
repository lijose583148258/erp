import type { ProductionBatchTrace } from '../../services/productionBatchTrace';

export function ProductionGenealogyReadback({ trace }: { trace: ProductionBatchTrace }) {
  return <div className="space-y-4">
    {(['upstreamInputs', 'downstreamOutputs'] as const).map(direction => <section key={direction} data-testid={`genealogy-${direction}`}>
      <h4 className="text-sm font-bold text-slate-900 dark:text-white">{direction === 'upstreamInputs' ? '上游原料' : '下游产出'}</h4>
      {trace[direction].length === 0 ? <p className="mt-2 text-xs text-slate-500">暂无已记录的直接关联</p>
        : <ul className="mt-2 space-y-3">{trace[direction].map(edge => <li key={edge.id} data-testid={`genealogy-edge-${edge.id}`} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 text-xs leading-6 break-words">
          <div className="font-bold text-slate-900 dark:text-white">{direction === 'upstreamInputs' ? edge.inputBatchNo : edge.outputBatchNo}</div>
          <div className="text-slate-600 dark:text-slate-300">{direction === 'upstreamInputs' ? edge.inputProductName : edge.outputProductName}</div>
          <div className="font-bold text-slate-700 dark:text-slate-200">耗用 {edge.quantityConsumed} {edge.inputUnit}</div>
          <div className="text-slate-600 dark:text-slate-300">工单 {edge.workOrder.workOrderNo}</div>
        </li>)}</ul>}
    </section>)}
  </div>;
}
