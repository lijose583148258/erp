import React from 'react';

type Props = {
  title: string;
  subtitle: string;
  children: React.ReactNode;
};

export function CRMPageShell({ title, subtitle, children }: Props) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tighter leading-none italic uppercase">
            {title}
          </h1>
          <p className="mt-2 text-sm font-medium text-slate-600 dark:text-slate-300">
            {subtitle}
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
