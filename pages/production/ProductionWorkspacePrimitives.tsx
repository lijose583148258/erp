import React from 'react';
import type { ProductBatch } from '../../services/asset.service';
import type { AdjustmentRecord } from '../../services/adjustment.service';
import type { ProductionWorkOrderStatus } from '../../services/production.service';
import { getStatusBorderBadgeClassName } from '../../components/ui/statusBadgeLogic';
import { WO_LABELS } from './productionWorkspaceConfig';

export const SectionHeader = ({ title, subtitle }: { title: string; subtitle: string }) => (
  <div className="flex items-center justify-between gap-4">
    <h2 className="text-2xl font-black tracking-tighter italic uppercase flex items-center">
      <div className="w-2 h-8 bg-blue-600 rounded-full mr-4" />
      {title}
    </h2>
    <div className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">{subtitle}</div>
  </div>
);

export const StatCard = ({ title, value, color, icon }: { title: string; value: number | string; color: string; icon: React.ReactNode }) => (
  <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-8 rounded-[40px] border border-white/50 dark:border-slate-800 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.02)]">
    <div className={`p-4 ${color} text-white rounded-[22px] shadow-xl shadow-current/20 w-fit mb-8`}>{icon}</div>
    <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">{title}</p>
    <p className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter mt-2">{value}</p>
  </div>
);

export const SummaryChip = ({ label, value, dataTestId }: { label: string; value: string; dataTestId?: string }) => (
  <div data-testid={dataTestId} className="rounded-[20px] border border-slate-100 dark:border-slate-700 bg-white/80 dark:bg-slate-900/70 px-4 py-3">
    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{label}</div>
    <div className="mt-2 text-sm font-black text-slate-900 dark:text-white">{value}</div>
  </div>
);

export const Field = ({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  readOnly = false,
  dataTestId,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
  readOnly?: boolean;
  dataTestId?: string;
  error?: string;
}) => {
  const errorId = dataTestId && error ? `${dataTestId}-error` : undefined;

  return (
    <label className="block">
      <span className="block text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 mb-2">{label}</span>
      <input
        data-testid={dataTestId}
        value={value}
        readOnly={readOnly}
        onChange={readOnly ? undefined : e => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
        aria-invalid={Boolean(error)}
        aria-describedby={errorId}
        className={`w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800/70 text-sm font-bold text-slate-700 dark:text-slate-200 border ${
          error ? 'border-rose-400 focus:ring-2 focus:ring-rose-100' : 'border-slate-100 dark:border-slate-700'
        }`}
      />
      {error ? <span id={errorId} className="mt-2 block text-xs font-bold text-rose-600 dark:text-rose-300">{error}</span> : null}
    </label>
  );
};

export const SelectField = ({
  label,
  value,
  onChange,
  options,
  dataTestId,
}: {
  label: string;
  value: string;
  onChange: (value: any) => void;
  options: Array<{ value: string; label: string }>;
  dataTestId?: string;
}) => (
  <label className="block">
    <span className="block text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 mb-2">{label}</span>
    <select data-testid={dataTestId} value={value} onChange={e => onChange(e.target.value)} className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800/70 text-sm font-bold text-slate-700 dark:text-slate-200 border border-slate-100 dark:border-slate-700">
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>
);

export const TextareaField = ({ label, value, onChange, placeholder, dataTestId }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; dataTestId?: string }) => (
  <label className="block">
    {label ? <span className="block text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 mb-2">{label}</span> : null}
    <textarea data-testid={dataTestId} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="w-full min-h-24 px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800/70 text-sm font-bold text-slate-700 dark:text-slate-200 border border-slate-100 dark:border-slate-700" />
  </label>
);

export const Th = ({ children }: { children: React.ReactNode }) => (
  <th className="px-4 py-4 text-[10px] font-black text-slate-400 uppercase tracking-[0.25em]">{children}</th>
);

export const Td = ({
  children,
  mono,
  strong,
  className = '',
}: {
  children: React.ReactNode;
  mono?: boolean;
  strong?: boolean;
  className?: string;
}) => (
  <td className={`px-4 py-5 text-sm ${mono ? 'font-mono text-xs font-bold text-slate-600 dark:text-slate-300' : strong ? 'font-bold text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-300'} ${className}`}>
    {children}
  </td>
);

export const MiniTag = ({ label }: { label: string }) => (
  <span className="inline-flex items-center px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-[0.15em] border bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200">{label}</span>
);

export const BatchBadge = ({ status }: { status?: ProductBatch['status'] }) => (
  <span className={`px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-[0.15em] border ${getStatusBorderBadgeClassName(status || 'healthy')}`}>
    {status === 'expired' ? '已过期' : status === 'expiring' ? '临期' : '正常'}
  </span>
);

export const AdjustmentBadge = ({ status }: { status: AdjustmentRecord['status'] }) => (
  <span className={`px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-[0.15em] border ${getStatusBorderBadgeClassName(status)}`}>
    {status === 'posted' ? '已生效' : status === 'reversed' ? '已冲销' : '待处理'}
  </span>
);

export const WorkOrderStatusBadge = ({ status }: { status: ProductionWorkOrderStatus }) => (
  <span className={`px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-[0.15em] border ${getStatusBorderBadgeClassName(status)}`}>
    {WO_LABELS[status]}
  </span>
);

export const OrderActionButtons = ({
  workOrderId,
  status,
  onAction,
}: {
  workOrderId: number;
  status: ProductionWorkOrderStatus;
  onAction: (workOrderId: number, status: ProductionWorkOrderStatus) => Promise<void>;
}) => {
  if (status === 'completed' || status === 'cancelled') {
    return <MiniTag label={WO_LABELS[status]} />;
  }

  if (status === 'qc_pending') {
    return (
      <>
        <button onClick={() => void onAction(workOrderId, 'completed')} className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest">
          完工
        </button>
        <button onClick={() => void onAction(workOrderId, 'cancelled')} className="px-3 py-2 rounded-xl bg-slate-200 text-slate-700 text-[10px] font-black uppercase tracking-widest dark:bg-slate-800 dark:text-slate-200">
          取消
        </button>
      </>
    );
  }

  if (status === 'in_progress') {
    return (
      <>
        <button onClick={() => void onAction(workOrderId, 'qc_pending')} className="px-3 py-2 rounded-xl bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest">
          送检
        </button>
        <button onClick={() => void onAction(workOrderId, 'cancelled')} className="px-3 py-2 rounded-xl bg-slate-200 text-slate-700 text-[10px] font-black uppercase tracking-widest dark:bg-slate-800 dark:text-slate-200">
          取消
        </button>
      </>
    );
  }

  return (
    <>
      <button onClick={() => void onAction(workOrderId, 'in_progress')} className="px-3 py-2 rounded-xl bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest">
        开工
      </button>
      <button onClick={() => void onAction(workOrderId, 'cancelled')} className="px-3 py-2 rounded-xl bg-slate-200 text-slate-700 text-[10px] font-black uppercase tracking-widest dark:bg-slate-800 dark:text-slate-200">
        取消
      </button>
    </>
  );
};
