import React from 'react';
import { ArrowRightLeft, Building2, Clock3, History, ShieldCheck, ShieldX } from 'lucide-react';
import { CustomerPoolHistoryEntry } from '../../types';

type Props = {
  t: any;
  history: CustomerPoolHistoryEntry[];
  latest: CustomerPoolHistoryEntry | null;
  currentPool: {
    poolState: 'public' | 'internal' | 'private';
    salespersonId: string | null;
    salespersonName?: string | null;
    poolReason: string | null;
    poolUpdatedAt: string | null;
    poolUpdatedBy: string | null;
  } | null;
  loading: boolean;
};

const buildPoolMeta = (t: any): Record<'public' | 'internal' | 'private', { tone: string; icon: React.ElementType; label: string }> => ({
  public: {
    tone: 'bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-900/50',
    icon: Building2,
    label: t.crmPoolPublic || '公海',
  },
  internal: {
    tone: 'bg-violet-50 text-violet-600 border-violet-200 dark:bg-violet-950/30 dark:text-violet-300 dark:border-violet-900/50',
    icon: ShieldCheck,
    label: t.crmPoolInternal || '内部池',
  },
  private: {
    tone: 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900/50',
    icon: ShieldX,
    label: t.crmPoolPrivate || '私海',
  },
});

function formatTime(value: string | null | undefined) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function CRMCustomerPoolAudit({ t, history, latest, currentPool, loading }: Props) {
  const poolMeta = buildPoolMeta(t);
  const actionLabelMap: Record<CustomerPoolHistoryEntry['action'], string> = {
    POOL_ASSIGN: t.crmPoolActionAssign || '分配到私海',
    POOL_RELEASE: t.crmPoolActionRelease || '释放到公海',
    POOL_RECLAIM: t.crmPoolActionReclaim || '回收到内部池',
    POOL_TRANSFER: t.crmPoolActionTransfer || '客户池调整',
  };
  const roleLabelMap: Record<string, string> = {
    admin: t.roleAdmin || '管理员',
    manager: t.roleManager || '经理',
    sales: t.roleSales || '销售',
    warehouse: t.roleWarehouse || '仓库',
    finance: t.roleFinance || '财务',
  };
  const currentMeta = currentPool ? poolMeta[currentPool.poolState] : null;
  const getPoolStateLabel = (state: string | null | undefined) => {
    if (!state || !poolMeta[state as keyof typeof poolMeta]) return '--';
    return poolMeta[state as keyof typeof poolMeta].label;
  };
  const currentPoolLabel = currentPool ? (
    currentPool.poolState === 'public'
      ? (t.crmPoolPublic || '公海')
      : currentPool.poolState === 'internal'
        ? (t.crmPoolInternal || '内部池')
        : (t.crmPoolPrivate || '私海')
  ) : null;
  const CurrentIcon = currentMeta?.icon;

  return (
    <div className="pt-6 border-t border-slate-100 dark:border-slate-800 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center">
          <History size={14} className="mr-2" />
          {t.crmPoolAuditTitle || '客户池审计'}
        </h5>
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
          {history.length} {t.crmPoolAuditEvents || '条记录'}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <div className="rounded-[28px] border border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">{t.crmPoolAuditCurrentPool || '当前池'}</div>
              <div className="mt-2 text-sm font-black uppercase tracking-[0.18em] text-slate-900 dark:text-white">
                {currentPoolLabel || (t.crmPoolAuditUnknown || '未知')}
              </div>
            </div>
            {currentMeta && (
              <div className={`px-3 py-2 rounded-2xl border text-[10px] font-black uppercase tracking-widest ${currentMeta.tone}`}>
                {CurrentIcon ? <CurrentIcon size={14} className="inline mr-1" /> : null}
                {currentPoolLabel}
              </div>
            )}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
            <div className="rounded-2xl bg-white/70 dark:bg-slate-900/60 p-3">
              <div className="opacity-60">{t.crmPoolAuditUpdatedAt || '更新时间'}</div>
              <div className="mt-2 text-[11px] text-slate-800 dark:text-slate-200">{formatTime(currentPool?.poolUpdatedAt)}</div>
            </div>
            <div className="rounded-2xl bg-white/70 dark:bg-slate-900/60 p-3">
              <div className="opacity-60">{t.crmPoolAuditUpdatedBy || '更新人'}</div>
              <div className="mt-2 text-[11px] text-slate-800 dark:text-slate-200">{currentPool?.poolUpdatedBy || '--'}</div>
            </div>
          </div>
          <div className="mt-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
            {t.crmPoolAuditReason || '原因'}: <span className="text-slate-700 dark:text-slate-200">{currentPool?.poolReason || '--'}</span>
          </div>
          <div className="mt-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
            {t.crmPoolAuditSalesperson || '负责人'}: <span className="text-slate-700 dark:text-slate-200">{currentPool?.salespersonName || (currentPool?.salespersonId ? `#${currentPool.salespersonId}` : '--')}</span>
          </div>
        </div>

        <div className="rounded-[28px] border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">{t.crmPoolAuditRecentActions || '最近动作'}</div>
            {latest && (
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 flex items-center">
                <Clock3 size={12} className="mr-1" />
                {formatTime(latest.createdAt)}
              </div>
            )}
          </div>

          {loading ? (
            <div className="text-center py-8 text-slate-400 text-xs font-bold">{t.crmPoolAuditLoading || '正在加载客户池历史...'}</div>
          ) : history.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-xs font-bold">{t.crmPoolAuditEmpty || '暂无客户池动作'}</div>
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
                            {actionLabelMap[entry.action] || entry.action}
                          </div>
                          <div className="mt-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                            {getPoolStateLabel(entry.previousPoolState)} → {getPoolStateLabel(entry.nextPoolState)}
                          </div>
                        </div>
                        {nextMeta && (
                          <span className={`px-2 py-1 rounded-xl text-[11px] font-black uppercase border ${nextMeta.tone}`}>
                            {nextMeta.label}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                        {entry.reason || (t.crmPoolAuditNoReason || '未填写原因')}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
                        <span>{entry.operatorName}</span>
                        <span>{roleLabelMap[entry.operatorRole] || entry.operatorRole}</span>
                        {entry.salespersonName || entry.salespersonId ? (
                          <span>{t.crmPoolAuditSalesperson || '负责人'} {entry.salespersonName || `#${entry.salespersonId}`}</span>
                        ) : null}
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
