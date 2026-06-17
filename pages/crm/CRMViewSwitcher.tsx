import React from 'react';
import { Globe, Plus, Search } from 'lucide-react';

type Props = {
  t: any;
  viewMode: 'my' | 'public';
  onViewChange: (mode: 'my' | 'public') => void;
  segmentFilter: 'all' | 'direct' | 'channel' | 'mixed';
  onSegmentChange: (segment: 'all' | 'direct' | 'channel' | 'mixed') => void;
  searchKeyword: string;
  onSearchKeywordChange: (value: string) => void;
  onCreate: () => void;
  scopeSegment?: 'direct' | 'channel' | 'mixed' | null;
  canCreate: boolean;
};

export function CRMViewSwitcher({
  t,
  viewMode,
  onViewChange,
  segmentFilter,
  onSegmentChange,
  searchKeyword,
  onSearchKeywordChange,
  onCreate,
  scopeSegment = null,
  canCreate,
}: Props) {
  const segmentLabelMap = {
    all: t.crmSegmentAll || '全部业务',
    direct: t.crmSegmentDirect || '内销直销',
    channel: t.crmSegmentChannel || '分销渠道',
    mixed: t.crmSegmentMixed || '混合经营',
  } as const;
  const scopeLabel = scopeSegment ? segmentLabelMap[scopeSegment] : '';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
          <button onClick={() => onViewChange('my')} className={`min-h-11 rounded-lg px-5 py-2.5 text-xs font-black transition ${viewMode === 'my' ? 'bg-slate-900 text-white dark:bg-slate-700' : 'text-slate-600 dark:text-slate-300'}`}>
            {t.myCustomers}
          </button>
          <button onClick={() => onViewChange('public')} className={`min-h-11 rounded-lg px-5 py-2.5 text-xs font-black transition ${viewMode === 'public' ? 'bg-rose-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}>
            <Globe size={12} className="inline mr-2" />
            {t.publicPool}
          </button>
        </div>

        {canCreate && (
          <button data-testid="crm-add-customer" onClick={onCreate} className="flex min-h-11 items-center rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-black text-white shadow-sm transition hover:bg-blue-700">
            <Plus size={16} className="mr-2" />
            {t.addCustomer}
          </button>
        )}

        {scopeSegment && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800">
            {scopeLabel} {t.crmWorkbenchLabel || '工作台'}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex w-fit flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
          {[
            { key: 'all', label: segmentLabelMap.all },
            { key: 'direct', label: segmentLabelMap.direct },
            { key: 'channel', label: segmentLabelMap.channel },
            { key: 'mixed', label: segmentLabelMap.mixed },
          ].map((item) => (
            <button
              key={item.key}
              onClick={() => onSegmentChange(item.key as 'all' | 'direct' | 'channel' | 'mixed')}
              className={`min-h-10 rounded-lg px-4 py-2 text-xs font-bold transition ${
                segmentFilter === item.key ? 'bg-emerald-600 text-white' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="relative min-w-[280px] xl:w-[380px]">
          <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            data-testid="crm-search"
            value={searchKeyword}
            onChange={(event) => onSearchKeywordChange(event.target.value)}
            maxLength={120}
            placeholder={t.search || "Search..."}
            className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm font-bold text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
      </div>
    </div>
  );
}
