import React from 'react';
import type { ProductBatch } from '../../services/asset.service';
import type { AdjustmentRecord } from '../../services/adjustment.service';
import type { ProductionWorkOrderStatus } from '../../services/production.service';
import { getStatusBorderBadgeClassName } from '../../components/ui/statusBadgeLogic';
import { WO_LABELS } from './productionWorkspaceConfig';

export const SectionHeader = ({ title, subtitle }: { title: string; subtitle: string }) => (
  <div className="flex flex-col items-start gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
    <h2 className="flex items-center text-xl font-black tracking-tighter">
      <div className="mr-3 h-7 w-1.5 rounded-full bg-blue-600" />
      {title}
    </h2>
    <div className="max-w-2xl text-xs font-bold leading-5 text-slate-500 dark:text-slate-400">{subtitle}</div>
  </div>
);

export const StatCard = ({ title, value, color, icon }: { title: string; value: number | string; color: string; icon: React.ReactNode }) => (
  <div className="flex items-center gap-3 rounded-[24px] border border-white/50 bg-white/80 p-3.5 shadow-[0_10px_30px_-14px_rgba(15,23,42,0.14)] backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/80">
    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] ${color} text-white shadow-lg shadow-current/15`}>{icon}</div>
    <div className="min-w-0">
      <p className="truncate text-xs font-black text-slate-500">{title}</p>
      <p className="mt-0.5 text-2xl font-black leading-none tracking-tight text-slate-900 dark:text-white">{value}</p>
    </div>
  </div>
);

export const SummaryChip = ({ label, value, dataTestId }: { label: string; value: string; dataTestId?: string }) => (
  <div data-testid={dataTestId} className="rounded-[20px] border border-slate-100 dark:border-slate-700 bg-white/80 dark:bg-slate-900/70 px-4 py-3">
    <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">{label}</div>
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
  required = false,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
  readOnly?: boolean;
  dataTestId?: string;
  error?: string;
  required?: boolean;
  hint?: string;
}) => {
  const errorId = dataTestId && error ? `${dataTestId}-error` : undefined;

  return (
    <label className="block">
      <span className="mb-2 flex items-center gap-2 text-xs font-black text-slate-500">
        {label}
        {required ? <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[11px] text-rose-600 dark:bg-rose-950/40 dark:text-rose-300">必填</span> : null}
      </span>
      <input
        data-testid={dataTestId}
        value={value}
        readOnly={readOnly}
        onChange={readOnly ? undefined : e => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
        aria-invalid={Boolean(error)}
        aria-describedby={errorId}
        aria-required={required}
        className={`w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800/70 text-sm font-bold text-slate-700 dark:text-slate-200 border ${
          error ? 'border-rose-400 focus:ring-2 focus:ring-rose-100' : 'border-slate-100 dark:border-slate-700'
        }`}
      />
      {hint ? <span className="mt-1.5 block text-xs font-bold leading-5 text-slate-400">{hint}</span> : null}
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
    <span className="block text-xs font-black uppercase tracking-[0.25em] text-slate-400 mb-2">{label}</span>
    <select data-testid={dataTestId} value={value} onChange={e => onChange(e.target.value)} className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800/70 text-sm font-bold text-slate-700 dark:text-slate-200 border border-slate-100 dark:border-slate-700">
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>
);

export const TextareaField = ({ label, value, onChange, placeholder, dataTestId }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; dataTestId?: string }) => (
  <label className="block">
    {label ? <span className="block text-xs font-black uppercase tracking-[0.25em] text-slate-400 mb-2">{label}</span> : null}
    <textarea data-testid={dataTestId} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="w-full min-h-24 px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800/70 text-sm font-bold text-slate-700 dark:text-slate-200 border border-slate-100 dark:border-slate-700" />
  </label>
);

export const Th = ({ children }: { children: React.ReactNode }) => (
  <th className="px-4 py-4 text-xs font-black text-slate-400 uppercase tracking-[0.25em]">{children}</th>
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
        <button onClick={() => void onAction(workOrderId, 'completed')} className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-black uppercase tracking-widest">
          完工
        </button>
        <button onClick={() => void onAction(workOrderId, 'cancelled')} className="px-3 py-2 rounded-xl bg-slate-200 text-slate-700 text-xs font-black uppercase tracking-widest dark:bg-slate-800 dark:text-slate-200">
          取消
        </button>
      </>
    );
  }

  if (status === 'in_progress') {
    return (
      <>
        <button onClick={() => void onAction(workOrderId, 'qc_pending')} className="px-3 py-2 rounded-xl bg-blue-600 text-white text-xs font-black uppercase tracking-widest">
          送检
        </button>
        <button onClick={() => void onAction(workOrderId, 'cancelled')} className="px-3 py-2 rounded-xl bg-slate-200 text-slate-700 text-xs font-black uppercase tracking-widest dark:bg-slate-800 dark:text-slate-200">
          取消
        </button>
      </>
    );
  }

  return (
    <>
      <button onClick={() => void onAction(workOrderId, 'in_progress')} className="px-3 py-2 rounded-xl bg-blue-600 text-white text-xs font-black uppercase tracking-widest">
        开工
      </button>
      <button onClick={() => void onAction(workOrderId, 'cancelled')} className="px-3 py-2 rounded-xl bg-slate-200 text-slate-700 text-xs font-black uppercase tracking-widest dark:bg-slate-800 dark:text-slate-200">
        取消
      </button>
    </>
  );
};
