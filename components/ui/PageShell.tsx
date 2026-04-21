import React from 'react';

type PageShellTab = {
  id: string;
  label: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  testId?: string;
};

type Props = {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  tabs?: PageShellTab[];
  children: React.ReactNode;
  className?: string;
};

export const PageShell: React.FC<Props> = ({ eyebrow, title, subtitle, actions, tabs = [], children, className = '' }) => (
  <div className={`space-y-6 ${className}`}>
    <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
      <div>
        {eyebrow ? <p className="app-section-title mb-2">{eyebrow}</p> : null}
        <h1 className="text-3xl font-black uppercase italic tracking-tighter text-slate-900 dark:text-white">{title}</h1>
        {subtitle ? <p className="mt-2 text-sm font-medium tracking-tight text-slate-500 dark:text-slate-300">{subtitle}</p> : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {tabs.length > 0 ? (
          <div className="flex flex-wrap gap-2 rounded-2xl bg-slate-100 p-1 dark:bg-slate-800">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                data-testid={tab.testId}
                onClick={tab.onClick}
                className={`rounded-xl px-6 py-3 text-xs font-black uppercase tracking-widest transition-all ${tab.active ? 'bg-white text-blue-600 shadow dark:bg-slate-700' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        ) : null}
        {actions}
      </div>
    </div>

    {children}
  </div>
);
