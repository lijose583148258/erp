import React from 'react';

export type ModuleHeroStat = {
  label: React.ReactNode;
  value: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'blue' | 'emerald' | 'amber' | 'rose' | 'slate';
};

type Props = {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  stats?: ModuleHeroStat[];
  className?: string;
};

const statToneClass: Record<NonNullable<ModuleHeroStat['tone']>, string> = {
  blue: 'text-blue-500 bg-blue-50 dark:bg-blue-950/30',
  emerald: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-950/30',
  amber: 'text-amber-500 bg-amber-50 dark:bg-amber-950/30',
  rose: 'text-rose-500 bg-rose-50 dark:bg-rose-950/30',
  slate: 'text-slate-500 bg-slate-50 dark:bg-slate-800',
};

export const ModuleHero: React.FC<Props> = ({ eyebrow, title, description, actions, stats = [], className = '' }) => (
  <section className={`app-panel overflow-hidden p-6 ${className}`}>
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="app-section-title mb-3">{eyebrow}</p> : null}
        <h1 className="text-3xl font-black italic tracking-tighter text-slate-900 dark:text-white">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-slate-500 dark:text-slate-300">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>

    {stats.length > 0 ? (
      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat, index) => (
          <div key={index} className="rounded-[24px] border border-slate-100 bg-white/80 p-4 dark:border-slate-800 dark:bg-slate-900/70">
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{stat.label}</p>
              {stat.icon ? <div className={`rounded-2xl p-3 ${statToneClass[stat.tone || 'slate']}`}>{stat.icon}</div> : null}
            </div>
            <div className="mt-3 text-3xl font-black tracking-tighter text-slate-900 dark:text-white">{stat.value}</div>
          </div>
        ))}
      </div>
    ) : null}
  </section>
);
