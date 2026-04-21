import React from 'react';
import { ArrowRightLeft, Clock3, History, ShieldCheck, ShieldX, Building2 } from 'lucide-react';
import { CustomerPoolHistoryEntry } from '../../types';

type Props = {
  history: CustomerPoolHistoryEntry[];
  latest: CustomerPoolHistoryEntry | null;
  currentPool: {
    poolState: 'public' | 'internal' | 'private';
    salespersonId: string | null;
    poolReason: string | null;
    poolUpdatedAt: string | null;
    poolUpdatedBy: string | null;
  } | null;
  loading: boolean;
};

const poolMeta: Record<'public' | 'internal' | 'private', { label: string; tone: string; icon: React.ElementType }> = {
  public: { label: '公海', tone: 'bg-rose-50 text-rose-600 border-rose-200', icon: Building2 },
  internal: { label: '内部', tone: 'bg-violet-50 text-violet-600 border-violet-200', icon: ShieldCheck },
  private: { label: '私海', tone: 'bg-emerald-50 text-emerald-600 border-emerald-200', icon: ShieldX },
};

function formatTime(value: string | null | undefined) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function CRMCustomerPoolTimeline({ history, latest, currentPool, loading }: Props) {
  const currentMeta = currentPool ? poolMeta[currentPool.poolState] : null;

  return (
    <div className="pt-6 border-t border-slate-100 dark:border-slate-800 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center">
          <History size={14} className="mr-2" />
          客户池审计
        </h5>
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
          {history.length} events
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <div className="rounded-[28px] border border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Current Pool</div>
              <div className="mt-2 text-sm font-black uppercase tracking-[0.18em] text-slate-900 dark:text-white">
                {currentMeta?.label || 'UNKNOWN'}
              </div>
            </div>
            {currentMeta && (
              <div className={`px-3 py-2 rounded-2xl border text-[10px] font-black uppercase tracking-widest ${currentMeta.tone}`}>
                <currentMeta.icon size={14} className="inline mr-1" />
                {currentMeta.label}
              </div>
            )}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
            <div className="rounded-2xl bg-white/70 dark:bg-slate-900/60 p-3">
              <div className="opacity-60">Updated At</div>
              <div className="mt-2 text-[11px] text-slate-800 dark:text-slate-200">{formatTime(currentPool?.poolUpdatedAt)}</div>
            </div>
            <div className="rounded-2xl bg-white/70 dark:bg-slate-900/60 p-3">
              <div className="opacity-60">Updated By</div>
              <div className="mt-2 text-[11px] text-slate-800 dark:text-slate-200">{currentPool?.poolUpdatedBy || '--'}</div>
            </div>
          </div>
          <div className="mt-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
            Reason: <span className="text-slate-700 dark:text-slate-200">{currentPool?.poolReason || '--'}</span>
          </div>
          <div className="mt-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
            Salesperson: <span className="text-slate-700 dark:text-slate-200">{currentPool?.salespersonId || '--'}</span>
          </div>
        </div>

        <div className="rounded-[28px] border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Recent Actions</div>
            {latest && (
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 flex items-center">
                <Clock3 size={12} className="mr-1" />
                {formatTime(latest.createdAt)}
              </div>
            )}
          </div>

          {loading ? (
            <div className="text-center py-8 text-slate-400 text-xs font-bold">Loading pool history...</div>
          ) : history.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-xs font-bold">No pool actions yet</div>
          ) : (
            <div className="space-y-3">
              {history.map((entry) => {
                const nextMeta = entry.nextPoolState ? poolMeta[entry.nextPoolState] : null;
                return (
                  <div key={entry.id} className="flex gap-3 items-start rounded-[22px] bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 p-3">
                    <div className="mt-0.5 rounded-2xl p-2 bg-slate-900 text-white dark:bg-white dark:text-slate-900 shrink-0">
                      <ArrowRightLeft size={14} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-[0.14em]">
                            {entry.action}
                          </div>
                          <div className="mt-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                            {entry.previousPoolState || '--'} → {entry.nextPoolState || '--'}
                          </div>
                        </div>
                        {nextMeta && (
                          <span className={`px-2 py-1 rounded-xl text-[11px] font-black uppercase border ${nextMeta.tone}`}>
                            {nextMeta.label}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                        {entry.reason || 'No reason provided'}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
                        <span>{entry.operatorName}</span>
                        <span>{entry.operatorRole}</span>
                        <span>{formatTime(entry.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
