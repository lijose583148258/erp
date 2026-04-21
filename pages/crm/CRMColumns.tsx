import React from 'react';
import { UserRound } from 'lucide-react';
import { Customer, RiskLevel } from '../../types';
import type { Column } from '../../components/DataTable';
import { getCustomerPoolState } from '../../utils/customerPool';

const text = (t: any, key: string, fallback: string) => {
  const value = t?.[key];
  return typeof value === 'string' && value.trim() ? value : fallback;
};

const getRiskLabel = (t: any, riskLevel: RiskLevel | string) => {
  const labels: Record<string, string> = {
    [RiskLevel.LOW]: text(t, 'crmRiskLow', '低风险'),
    [RiskLevel.MEDIUM]: text(t, 'crmRiskMedium', '中风险'),
    [RiskLevel.HIGH]: text(t, 'crmRiskHigh', '高风险'),
    [RiskLevel.CRITICAL]: text(t, 'crmRiskCritical', text(t, 'critical', '关键风险')),
  };
  return labels[riskLevel] || String(riskLevel || '');
};

export function buildCRMColumns(t: any): Column<Customer>[] {
  return [
    {
      header: t.customerName, key: 'name', accessor: (row: Customer) => (
        <div className="flex flex-col">
          <span className="font-bold text-slate-800 dark:text-white text-base group-hover:text-blue-600 transition-colors">{row.displayName || row.name}</span>
          <span className="text-[10px] text-slate-400 uppercase font-black mt-0.5">ID: {row.id}</span>
        </div>
      )
    },
    {
      header: t.licenseStatus, key: 'license', accessor: (row) => {
        const statusColors = {
          verified: 'bg-emerald-100 text-emerald-600 border-emerald-200',
          expired: 'bg-rose-100 text-rose-600 border-rose-200',
          pending: 'bg-slate-100 text-slate-400 border-slate-200'
        };
        return (
          <span className={`px-2 py-0.5 rounded-lg text-[11px] font-black uppercase border ${statusColors[row.licenseStatus || 'pending']}`}>
            {t[row.licenseStatus || 'pending']}
          </span>
        );
      }
    },
    {
      header: t.salesperson, key: 'tracking', accessor: (row: Customer) => (
        <div className="flex items-center text-xs group/rep cursor-pointer">
          <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-xl mr-3 group-hover/rep:bg-blue-600 group-hover/rep:text-white transition-all shadow-sm">
            <UserRound size={14} />
          </div>
          <div className="flex flex-col text-left">
            <span className="text-slate-500 dark:text-slate-400 font-bold group-hover/rep:text-blue-500">{row.salespersonName || t.pending}</span>
            <span className="text-[11px] text-slate-400 font-black uppercase">
              {row.contacts.length} {t.records}
            </span>
          </div>
        </div>
      )
    },
    {
      header: text(t, 'crmBusinessLine', text(t, 'businessLine', '业务线')),
      key: 'segment',
      accessor: (row: Customer) => {
        const normalizedSegment = row.segment || 'mixed';
        const labels: Record<string, { bg: string; text: string; border: string; label: string }> = {
          direct: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-600 dark:text-blue-400', border: 'border-blue-200 dark:border-blue-800', label: text(t, 'crmSegmentDirect', '直销') },
          channel: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-200 dark:border-amber-800', label: text(t, 'crmSegmentChannel', '渠道') },
          mixed: { bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-200 dark:border-emerald-800', label: text(t, 'crmSegmentMixed', '混合') },
        };
        const badge = labels[normalizedSegment] || labels.mixed;
        return (
          <span className={`px-3 py-1 rounded-xl text-[10px] font-black tracking-widest border ${badge.bg} ${badge.text} ${badge.border}`}>
            {badge.label}
          </span>
        );
      },
    },
    {
      header: text(t, 'crmCustomerPool', '客户池'),
      key: 'poolState',
      accessor: (row: Customer) => {
        const normalizedPool = getCustomerPoolState(row);
        const labels: Record<string, { bg: string; text: string; border: string; label: string }> = {
          public: { bg: 'bg-rose-100 dark:bg-rose-900/30', text: 'text-rose-600 dark:text-rose-400', border: 'border-rose-200 dark:border-rose-800', label: text(t, 'crmPoolPublic', '公海') },
          internal: { bg: 'bg-violet-100 dark:bg-violet-900/30', text: 'text-violet-600 dark:text-violet-400', border: 'border-violet-200 dark:border-violet-800', label: text(t, 'crmPoolInternal', '内部池') },
          private: { bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-200 dark:border-emerald-800', label: text(t, 'crmPoolPrivate', '私海') },
        };
        const badge = labels[normalizedPool] || labels.private;
        return (
          <span className={`px-3 py-1 rounded-xl text-[10px] font-black tracking-widest border ${badge.bg} ${badge.text} ${badge.border}`}>
            {badge.label}
          </span>
        );
      },
    },
    {
      header: text(t, 'crmRiskLevel', text(t, 'riskLevel', '风险等级')), key: 'risk', accessor: (row) => (
        <span className={`px-3 py-1 rounded-xl text-[10px] font-black tracking-widest border transition-all ${row.riskLevel === RiskLevel.CRITICAL ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-800' :
          row.riskLevel === RiskLevel.HIGH ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800' :
            row.riskLevel === RiskLevel.MEDIUM ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800' :
              'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
          }`}>
          {getRiskLabel(t, row.riskLevel)}
        </span>
      )
    },
  ];
}

