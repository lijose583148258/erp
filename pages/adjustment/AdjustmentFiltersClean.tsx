import React from 'react';
import { Filter, RefreshCcw, Search } from 'lucide-react';
import type {
  AdjustmentDomain,
  AdjustmentStatus,
  AdjustmentTargetType,
} from '../../services/adjustment.service';
import {
  adjustmentDomainMeta,
  adjustmentStatusMeta,
} from './adjustment.constants';

interface AdjustmentFiltersProps {
  query: string;
  onQueryChange: (value: string) => void;
  domainFilter: 'all' | AdjustmentDomain;
  onDomainFilterChange: (value: 'all' | AdjustmentDomain) => void;
  statusFilter: 'all' | AdjustmentStatus;
  onStatusFilterChange: (value: 'all' | AdjustmentStatus) => void;
  targetTypeFilter: 'all' | AdjustmentTargetType;
  onTargetTypeFilterChange: (value: 'all' | AdjustmentTargetType) => void;
  onRefresh: () => void;
}

const AdjustmentFiltersClean = ({
  query,
  onQueryChange,
  domainFilter,
  onDomainFilterChange,
  statusFilter,
  onStatusFilterChange,
  targetTypeFilter,
  onTargetTypeFilterChange,
  onRefresh,
}: AdjustmentFiltersProps) => {
  return (
    <div className="rounded-[36px] border border-slate-100 bg-white/80 p-5 shadow-sm backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/80 lg:p-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-xs font-black uppercase tracking-widest dark:bg-slate-800">
            <Filter size={12} />
            过滤
          </div>
          {(['all', 'finance', 'production', 'inventory'] as const).map((item) => (
            <button
              type="button"
              key={item}
              onClick={() => onDomainFilterChange(item)}
              className={`rounded-full border px-4 py-2 text-xs font-black uppercase tracking-widest ${
                domainFilter === item
                  ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900'
                  : 'border-slate-200 bg-transparent text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800'
              }`}
            >
              {item === 'all' ? '全部业务域' : adjustmentDomainMeta[item].label}
            </button>
          ))}
          {(['all', 'pending', 'posted', 'reversed', 'rejected'] as const).map((item) => (
            <button
              type="button"
              key={item}
              onClick={() => onStatusFilterChange(item)}
              className={`rounded-full border px-4 py-2 text-xs font-black uppercase tracking-widest ${
                statusFilter === item
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-slate-200 bg-transparent text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800'
              }`}
            >
              {item === 'all' ? '全部状态' : adjustmentStatusMeta[item].label}
            </button>
          ))}
          {(['all', 'order', 'productBatch', 'manual'] as const).map((item) => (
            <button
              type="button"
              key={item}
              onClick={() => onTargetTypeFilterChange(item)}
              className={`rounded-full border px-4 py-2 text-xs font-black uppercase tracking-widest ${
                targetTypeFilter === item
                  ? 'border-emerald-600 bg-emerald-600 text-white'
                  : 'border-slate-200 bg-transparent text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800'
              }`}
            >
              {item === 'all' ? '全部对象' : item === 'order' ? '订单' : item === 'productBatch' ? '批次' : '手工'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex min-w-[260px] items-center gap-2 rounded-[20px] border border-slate-100 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
            <Search size={16} className="text-slate-400" />
            <input
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="搜索单号、原因、对象..."
              aria-label="搜索调账单号、原因、对象"
              title="搜索调账单号、原因、对象"
              className="min-h-8 w-full bg-transparent text-sm font-bold text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-100"
            />
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-2 rounded-[20px] bg-slate-900 px-5 py-3 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-slate-900/10"
          >
            <RefreshCcw size={14} />
            刷新
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdjustmentFiltersClean;
