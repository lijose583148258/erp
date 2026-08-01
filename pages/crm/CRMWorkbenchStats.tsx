import React from 'react';
import { AlertTriangle, Building2, ShieldCheck, ShieldX, Users2, Wallet } from 'lucide-react';

type ScopeStats = {
  total: number;
  publicPool: number;
  internalPool: number;
  privatePool: number;
  overdueAmount: number;
  creditHoldCount: number;
  shipmentHoldCount: number;
};

type SegmentStats = ScopeStats & {
  segment: 'direct' | 'channel' | 'mixed';
};

type Props = {
  scopeSegment?: 'direct' | 'channel' | 'mixed' | null;
  stats: ScopeStats;
  segmentBreakdown: SegmentStats[];
  formatPrice: (value: number) => string;
};

const statCards = [
  {
    key: 'total',
    label: '客户总数',
    icon: Users2,
    tone: 'bg-slate-900 text-white dark:bg-white dark:text-slate-900',
  },
  {
    key: 'publicPool',
    label: '公海',
    icon: Building2,
    tone: 'bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-900/50',
  },
  {
    key: 'internalPool',
    label: '内部',
    icon: ShieldCheck,
    tone: 'bg-violet-50 text-violet-600 border-violet-200 dark:bg-violet-950/30 dark:text-violet-300 dark:border-violet-900/50',
  },
  {
    key: 'privatePool',
    label: '私海',
    icon: ShieldX,
    tone: 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900/50',
  },
  {
    key: 'overdueAmount',
    label: '逾期',
    icon: Wallet,
    tone: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900/50',
  },
  {
    key: 'holdTotal',
    label: '拦截',
    icon: AlertTriangle,
    tone: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-900/50',
  },
] as const;

const segmentLabels: Record<'direct' | 'channel' | 'mixed', { label: string; tone: string }> = {
  direct: {
    label: '直销',
    tone: 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-900/50',
  },
  channel: {
    label: '渠道',
    tone: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900/50',
  },
  mixed: {
    label: '混合',
    tone: 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900/50',
  },
};

export function CRMWorkbenchStats({ scopeSegment = null, stats, segmentBreakdown, formatPrice }: Props) {
  const holdTotal = stats.creditHoldCount + stats.shipmentHoldCount;

  const cardValues: Record<string, string> = {
    total: String(stats.total),
    publicPool: String(stats.publicPool),
    internalPool: String(stats.internalPool),
    privatePool: String(stats.privatePool),
    overdueAmount: formatPrice(stats.overdueAmount || 0),
    holdTotal: `${holdTotal}`,
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.28em] text-slate-400 dark:text-slate-500">
            工作台快照
          </div>
          <div className="mt-1 text-sm font-black uppercase tracking-[0.2em] text-slate-900 dark:text-white">
            {scopeSegment ? `${scopeSegment === 'direct' ? '直销' : scopeSegment === 'channel' ? '渠道' : '混合'}范围` : '全部范围'}
          </div>
        </div>
        <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
          授信 {stats.creditHoldCount} · 发货 {stats.shipmentHoldCount}
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-6 gap-3">
        {statCards.map((card) => {
          const Icon = card.icon;
          const value = cardValues[card.key];
          return (
            <div
              key={card.key}
 className={`rounded-[24px] border p-4 shadow-sm backdrop-blur-sm transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-150 motion-reduce:transition-none ${card.tone}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.24em] opacity-70">
                    {card.label}
                  </div>
                  <div className="mt-2 text-2xl font-black tracking-tight leading-none">
                    {value}
                  </div>
                </div>
                <div className="rounded-2xl bg-white/70 dark:bg-black/20 p-3">
                  <Icon size={16} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-3 pt-1">
        <div className="text-xs font-black uppercase tracking-[0.28em] text-slate-400 dark:text-slate-500">
          业务线分布
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
          {segmentBreakdown.map((segment) => {
            const meta = segmentLabels[segment.segment];
            return (
              <div key={segment.segment} className={`rounded-[24px] border p-4 shadow-sm backdrop-blur-sm ${meta.tone}`}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-black uppercase tracking-[0.24em] opacity-70">
                      {meta.label}
                    </div>
                    <div className="mt-2 text-xl font-black tracking-tight leading-none">
                      {segment.total}
                    </div>
                  </div>
                  <div className="text-right text-xs font-black uppercase tracking-[0.2em] opacity-70">
                    授信 {segment.creditHoldCount}<br />
                    发货 {segment.shipmentHoldCount}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 text-xs font-black uppercase tracking-[0.18em]">
                  <div className="rounded-2xl bg-white/70 dark:bg-black/20 p-3">
                    <div className="opacity-60">公海</div>
                    <div className="mt-2 text-sm">{segment.publicPool}</div>
                  </div>
                  <div className="rounded-2xl bg-white/70 dark:bg-black/20 p-3">
                    <div className="opacity-60">内部</div>
                    <div className="mt-2 text-sm">{segment.internalPool}</div>
                  </div>
                  <div className="rounded-2xl bg-white/70 dark:bg-black/20 p-3">
                    <div className="opacity-60">私海</div>
                    <div className="mt-2 text-sm">{segment.privatePool}</div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between text-xs font-black uppercase tracking-[0.18em] opacity-80">
                  <span>逾期</span>
                  <span>{formatPrice(segment.overdueAmount || 0)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
