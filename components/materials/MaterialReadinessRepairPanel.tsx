import React from 'react';
import { AlertTriangle, ArrowRight, X } from 'lucide-react';
import {
  getMaterialReadinessIssueLabel,
  MATERIAL_READINESS_EVENT,
  parseMaterialReadinessDetails,
  type MaterialReadinessDetails,
} from '../../utils/materialReadiness';

export function MaterialReadinessRepairPanel() {
  const [details, setDetails] = React.useState<MaterialReadinessDetails | null>(null);

  React.useEffect(() => {
    const handleReadiness = (event: Event) => {
      const parsed = parseMaterialReadinessDetails((event as CustomEvent).detail);
      if (parsed) setDetails(parsed);
    };
    window.addEventListener(MATERIAL_READINESS_EVENT, handleReadiness);
    return () => window.removeEventListener(MATERIAL_READINESS_EVENT, handleReadiness);
  }, []);

  if (!details) return null;
  const visibleIssues = details.issues.slice(0, 5);

  return (
    <aside
      role="alertdialog"
      aria-modal="false"
      aria-labelledby="material-readiness-title"
      aria-describedby="material-readiness-description"
      data-testid="material-readiness-repair-panel"
      className="fixed bottom-5 right-5 z-[130] w-[min(92vw,30rem)] animate-in fade-in slide-in-from-bottom-2 overflow-hidden rounded-3xl border border-amber-200 bg-white shadow-2xl duration-150 motion-reduce:animate-none dark:border-amber-800 dark:bg-slate-900"
    >
      <div className="flex items-start gap-3 border-b border-amber-100 bg-amber-50 px-5 py-4 dark:border-amber-900/50 dark:bg-amber-950/30">
        <AlertTriangle className="mt-0.5 shrink-0 text-amber-600" size={20} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 id="material-readiness-title" className="text-sm font-black text-slate-950 dark:text-white">
            已保留原数据，但暂不能确认或过账
          </h2>
          <p id="material-readiness-description" className="mt-1 text-xs font-semibold leading-5 text-slate-600 dark:text-slate-300">
            共 {details.issueCount} 行需要修复。先按行关联已发布物料，再回到原单重试；系统不会自动猜测或静默替换。
          </p>
        </div>
        <button type="button" aria-label="关闭物料修复提示" onClick={() => setDetails(null)} className="rounded-xl p-2 text-slate-500 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:hover:bg-slate-800">
          <X size={16} />
        </button>
      </div>
      <ol className="max-h-64 space-y-2 overflow-y-auto px-5 py-4">
        {visibleIssues.map(issue => (
          <li key={`${issue.lineKey}-${issue.reason}`} className="rounded-2xl border border-slate-200 px-4 py-3 dark:border-slate-700">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 text-xs font-black text-slate-900 dark:text-white">第 {issue.rowNumber} 行 · {issue.displayName}</p>
              {issue.materialCode && <code className="shrink-0 text-[10px] font-bold text-slate-500">{issue.materialCode}</code>}
            </div>
            <p className="mt-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">{getMaterialReadinessIssueLabel(issue)}</p>
          </li>
        ))}
        {details.issueCount > visibleIssues.length && (
          <li className="px-2 text-[11px] font-bold text-slate-500">
            另有 {details.issueCount - visibleIssues.length} 行；回到单据后按红色行标逐项处理。
          </li>
        )}
      </ol>
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-4 dark:border-slate-800">
        <button type="button" onClick={() => setDetails(null)} className="app-button-secondary min-h-11 px-4 text-xs">留在原单修复</button>
        <button
          type="button"
          onClick={() => {
            window.location.hash = '#materials';
            setDetails(null);
          }}
          className="app-button-primary flex min-h-11 items-center gap-2 px-4 text-xs"
        >
          打开物料中心 <ArrowRight size={14} aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
