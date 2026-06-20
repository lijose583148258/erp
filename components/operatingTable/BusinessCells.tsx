import React from 'react';

export type LabelMap = Record<string, string>;
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export const text = (labels: LabelMap | undefined, key: string, fallback: string) => labels?.[key] || fallback;

const toneClass: Record<Tone, string> = {
  neutral: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200',
  info: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200',
  warning: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200',
  danger: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200',
};

export const riskRowClass = (tone: Tone | undefined) => {
  if (tone === 'danger') return 'bg-rose-50/60 hover:bg-rose-50 dark:bg-rose-950/20 dark:hover:bg-rose-950/30';
  if (tone === 'warning') return 'bg-amber-50/60 hover:bg-amber-50 dark:bg-amber-950/20 dark:hover:bg-amber-950/30';
  return '';
};

export function Pill({ tone = 'neutral', children, title }: { tone?: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[11px] font-black ${toneClass[tone]}`}>
      <span className="truncate">{children}</span>
    </span>
  );
}

export function MoneyCell({ value, currency, format }: { value: unknown; currency?: string; format?: (value: number, currency?: string) => string }) {
  const amount = typeof value === 'number' ? value : Number(value || 0);
  const rendered = Number.isFinite(amount) ? (format ? format(amount, currency) : `${amount.toLocaleString()}${currency ? ` ${currency}` : ''}`) : '-';
  return <span className="block text-right font-data font-black tabular-nums">{rendered}</span>;
}

export function QuantityCell({ value, unit, precision = 3 }: { value: unknown; unit?: string; precision?: number }) {
  const amount = typeof value === 'number' ? value : Number(value || 0);
  const rendered = Number.isFinite(amount) ? Number(amount.toFixed(precision)).toLocaleString() : '-';
  return <span className="block text-right font-data font-black tabular-nums">{rendered}{unit ? <span className="ml-1 text-slate-500">{unit}</span> : null}</span>;
}

export function DateCell({ value }: { value: unknown }) {
  if (!value) return <span className="text-slate-400">-</span>;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return <span>{String(value)}</span>;
  return <span className="font-data tabular-nums">{date.toLocaleDateString('vi-VN')}</span>;
}

export function CopyableCode({ value, label }: { value: unknown; label?: string }) {
  const code = String(value || '');
  if (!code) return <span className="text-slate-400">-</span>;
  return (
    <button
      type="button"
      title={label || code}
      onClick={(event) => {
        event.stopPropagation();
        navigator.clipboard?.writeText(code).catch(() => undefined);
      }}
      className="max-w-full truncate rounded-lg px-1.5 py-1 text-left font-data text-xs font-black text-blue-700 transition hover:bg-blue-50 dark:text-blue-200 dark:hover:bg-blue-950/30"
    >
      {code}
    </button>
  );
}

export function StackText({ title, subtitle }: { title: React.ReactNode; subtitle?: React.ReactNode }) {
  const titleText = typeof title === 'string' || typeof title === 'number' ? String(title) : undefined;
  const subtitleText = typeof subtitle === 'string' || typeof subtitle === 'number' ? String(subtitle) : undefined;
  return (
    <span className="block min-w-0">
      <span title={titleText} className="block truncate text-sm font-black text-slate-800 dark:text-slate-100">{title}</span>
      {subtitle ? <span title={subtitleText} className="mt-0.5 block truncate text-xs font-bold text-slate-500 dark:text-slate-400">{subtitle}</span> : null}
    </span>
  );
}

export function ActionButton({ children, tone = 'neutral', onClick, disabled }: { children: React.ReactNode; tone?: Tone; onClick: () => void; disabled?: boolean }) {
  const buttonTone: Record<Tone, string> = {
    neutral: 'border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800',
    info: 'border-blue-200 text-blue-700 hover:bg-blue-50 dark:border-blue-900/60 dark:text-blue-200 dark:hover:bg-blue-950/30',
    success: 'border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900/60 dark:text-emerald-200 dark:hover:bg-emerald-950/30',
    warning: 'border-amber-200 text-amber-800 hover:bg-amber-50 dark:border-amber-900/60 dark:text-amber-200 dark:hover:bg-amber-950/30',
    danger: 'border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-200 dark:hover:bg-rose-950/30',
  };
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`inline-flex items-center justify-center rounded-xl border bg-white px-3 py-1.5 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-900 ${buttonTone[tone]}`}
    >
      {children}
    </button>
  );
}
