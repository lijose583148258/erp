import React from 'react';

type Props = {
  status: unknown;
  label?: React.ReactNode;
  className?: string;
};

const normalizeStatus = (status: unknown) => {
  if (typeof status !== 'string') return String(status ?? 'unknown').toLowerCase();
  return status.toLowerCase().replace(/\s+/g, '_');
};

const getBadgeText = (value: unknown, fallback: unknown = 'unknown'): React.ReactNode => {
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (React.isValidElement(value)) return value;
  if (Array.isArray(value)) {
    const text = value.map((item) => getBadgeText(item, '')).filter(Boolean).join(' ');
    return text || getBadgeText(fallback);
  }
  if (value === null || value === undefined || typeof value === 'boolean') return getBadgeText(fallback);
  return String(value);
};

export type StatusToneName = 'blue' | 'sky' | 'indigo' | 'amber' | 'emerald' | 'rose' | 'neutral';

const toneClassByName: Record<StatusToneName, string> = {
  blue: 'bg-blue-50 text-blue-700 ring-blue-100 dark:bg-blue-950/30 dark:text-blue-200 dark:ring-blue-900/40',
  sky: 'bg-sky-50 text-sky-700 ring-sky-100 dark:bg-sky-950/30 dark:text-sky-200 dark:ring-sky-900/40',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-100 dark:bg-indigo-950/30 dark:text-indigo-200 dark:ring-indigo-900/40',
  amber: 'bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-950/30 dark:text-amber-200 dark:ring-amber-900/40',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-200 dark:ring-emerald-900/40',
  rose: 'bg-rose-50 text-rose-700 ring-rose-100 dark:bg-rose-950/30 dark:text-rose-200 dark:ring-rose-900/40',
  neutral: 'bg-slate-100 text-slate-500 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
};

const borderToneClassByName: Record<StatusToneName, string> = {
  blue: 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-950/30 dark:text-blue-200 dark:border-blue-900/40',
  sky: 'bg-sky-50 text-sky-700 border-sky-100 dark:bg-sky-950/30 dark:text-sky-200 dark:border-sky-900/40',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-100 dark:bg-indigo-950/30 dark:text-indigo-200 dark:border-indigo-900/40',
  amber: 'bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-900/40',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-900/40',
  rose: 'bg-rose-50 text-rose-700 border-rose-100 dark:bg-rose-950/30 dark:text-rose-200 dark:border-rose-900/40',
  neutral: 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
};

const toneByStatus: Record<string, StatusToneName> = {
  open: 'blue',
  active: 'blue',
  planned: 'blue',
  requested: 'blue',
  draft: 'neutral',
  pending: 'amber',
  in_review: 'amber',
  quoted: 'amber',
  confirmed: 'blue',
  approved: 'emerald',
  posted: 'emerald',
  verified: 'emerald',
  healthy: 'emerald',
  valid: 'emerald',
  pass: 'emerald',
  kept: 'emerald',
  resolved: 'emerald',
  received: 'emerald',
  paid: 'emerald',
  unpaid: 'rose',
  completed: 'emerald',
  in_transit: 'sky',
  shipped: 'sky',
  sent: 'sky',
  delivered: 'emerald',
  feedback: 'emerald',
  processing: 'indigo',
  in_progress: 'indigo',
  testing: 'indigo',
  qc_pending: 'amber',
  partial: 'amber',
  payment_submitted: 'amber',
  reviewing: 'amber',
  promised: 'amber',
  expiring: 'amber',
  low: 'emerald',
  medium: 'amber',
  high: 'rose',
  critical: 'rose',
  overdue: 'rose',
  expired: 'rose',
  missed: 'rose',
  rejected: 'rose',
  terminated: 'rose',
  reversed: 'rose',
  exception: 'rose',
  fail: 'rose',
  missing: 'rose',
  cancelled: 'neutral',
  closed: 'neutral',
  inactive: 'neutral',
  retired: 'neutral',
  withdrawn: 'neutral',
};

export const getStatusTone = (status: unknown): StatusToneName => toneByStatus[normalizeStatus(status || 'unknown')] || 'neutral';

export const getStatusBadgeClassName = (status: unknown) => toneClassByName[getStatusTone(status)];

export const getStatusBorderBadgeClassName = (status: unknown) => borderToneClassByName[getStatusTone(status)];

export const StatusBadge: React.FC<Props> = ({ status, label, className = '' }) => {
  const toneClass = getStatusBadgeClassName(status || 'unknown');
  const text = getBadgeText(label, status || 'unknown');

  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] ring-1 ${toneClass} ${className}`}>
      {text}
    </span>
  );
};
