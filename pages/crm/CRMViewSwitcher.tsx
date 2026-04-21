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
        <div className="bg-white dark:bg-slate-900 p-1.5 rounded-[20px] flex flex-wrap gap-2 border border-slate-100 dark:border-slate-800 shadow-sm">
          <button onClick={() => onViewChange('my')} className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 ${viewMode === 'my' ? 'bg-slate-900 dark:bg-slate-700 text-white shadow-lg' : 'text-slate-400'}`}>
            {t.myCustomers}
          </button>
          <button onClick={() => onViewChange('public')} className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 ${viewMode === 'public' ? 'bg-rose-500 text-white shadow-lg' : 'text-slate-400'}`}>
            <Globe size={12} className="inline mr-2" />
            {t.publicPool}
          </button>
        </div>

        {canCreate && (
          <button data-testid="crm-add-customer" onClick={onCreate} className="flex items-center px-6 py-4 bg-blue-600 text-white rounded-[24px] font-black text-xs uppercase tracking-widest shadow-2xl hover:bg-blue-700 transition-all active:scale-95">
            <Plus size={16} className="mr-2" />
            {t.addCustomer}
          </button>
        )}

        {scopeSegment && (
          <div className="px-4 py-3 rounded-[20px] border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-bold tracking-[0.12em]">
            {scopeLabel} {t.crmWorkbenchLabel || '工作台'}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="bg-white dark:bg-slate-900 p-1.5 rounded-[20px] flex flex-wrap gap-2 border border-slate-100 dark:border-slate-800 shadow-sm w-fit">
          {[
            { key: 'all', label: segmentLabelMap.all },
            { key: 'direct', label: segmentLabelMap.direct },
            { key: 'channel', label: segmentLabelMap.channel },
            { key: 'mixed', label: segmentLabelMap.mixed },
          ].map((item) => (
            <button
              key={item.key}
              onClick={() => onSegmentChange(item.key as 'all' | 'direct' | 'channel' | 'mixed')}
              className={`px-5 py-2.5 rounded-2xl text-xs font-bold tracking-[0.12em] transition-all active:scale-95 ${
                segmentFilter === item.key ? 'bg-emerald-500 text-white shadow-lg' : 'text-slate-400'
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
            placeholder={t.search || "Search..."}
            className="w-full rounded-[22px] border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm font-bold text-slate-700 outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
      </div>
    </div>
  );
}
