import React from 'react';

export type MobileRecordField = {
  label: React.ReactNode;
  value: React.ReactNode;
  fullWidth?: boolean;
  mono?: boolean;
  tone?: 'default' | 'positive' | 'negative';
};

interface MobileRecordCardProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  status?: React.ReactNode;
  fields: MobileRecordField[];
  action?: React.ReactNode;
}

const toneClass = {
  default: 'text-slate-900 dark:text-white',
  positive: 'text-emerald-600 dark:text-emerald-400',
  negative: 'text-rose-600 dark:text-rose-400',
};

export const MobileRecordCard = ({ title, subtitle, status, fields, action }: MobileRecordCardProps) => (
  <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="break-words text-sm font-black text-slate-900 dark:text-white">{title}</div>
        {subtitle ? <div className="mt-1 break-words text-xs font-semibold text-slate-500 dark:text-slate-400">{subtitle}</div> : null}
      </div>
      {status ? <div className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-700 dark:bg-slate-800 dark:text-slate-200">{status}</div> : null}
    </header>
    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
      {fields.map((field, index) => (
        <div key={`${String(field.label)}-${index}`} className={field.fullWidth ? 'col-span-2' : ''}>
          <dt className="text-[11px] font-bold text-slate-500 dark:text-slate-400">{field.label}</dt>
          <dd className={`mt-1 break-words text-sm font-black ${field.mono ? 'font-mono text-xs' : ''} ${toneClass[field.tone || 'default']}`}>
            {field.value ?? '--'}
          </dd>
        </div>
      ))}
    </dl>
    {action ? <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">{action}</div> : null}
  </article>
);

export const MobileRecordState = ({ text }: { text: React.ReactNode }) => (
  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400">
    {text}
  </div>
);
