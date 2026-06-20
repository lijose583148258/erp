import React from 'react';

export type DocumentGuideStep = {
  title: string;
  description: string;
  badge?: string;
};

export type DocumentGuideBoundary = {
  title: string;
  items: string[];
};

type DocumentInputGuideProps = {
  eyebrow: string;
  title: string;
  description: string;
  steps: DocumentGuideStep[];
  boundaries?: DocumentGuideBoundary[];
  evidence?: string[];
  tone?: 'blue' | 'emerald' | 'amber';
  testId?: string;
};

const toneClassMap = {
  blue: {
    bar: 'bg-blue-600',
    chip: 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-950/30 dark:text-blue-200 dark:border-blue-900/50',
    ring: 'border-blue-100 bg-blue-50/60 dark:border-blue-900/50 dark:bg-blue-950/20',
  },
  emerald: {
    bar: 'bg-emerald-600',
    chip: 'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-900/50',
    ring: 'border-emerald-100 bg-emerald-50/60 dark:border-emerald-900/50 dark:bg-emerald-950/20',
  },
  amber: {
    bar: 'bg-amber-500',
    chip: 'bg-amber-50 text-amber-800 border-amber-100 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-900/50',
    ring: 'border-amber-100 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-950/20',
  },
} as const;

export const DocumentInputGuide: React.FC<DocumentInputGuideProps> = ({
  eyebrow,
  title,
  description,
  steps,
  boundaries = [],
  evidence = [],
  tone = 'blue',
  testId,
}) => {
  const toneClass = toneClassMap[tone];

  return (
    <section
      data-testid={testId}
      className="rounded-[40px] border border-white/70 bg-white/75 p-6 shadow-[0_18px_50px_rgba(15,23,42,0.05)] backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/75"
    >
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="max-w-3xl">
          <div className="flex items-center gap-3">
            <span className={`h-8 w-2 rounded-full ${toneClass.bar}`} />
            <p className="text-[11px] font-black tracking-[0.22em] text-slate-400">{eyebrow}</p>
          </div>
          <h2 className="mt-3 text-2xl font-black tracking-tight text-slate-950 dark:text-white">{title}</h2>
          <p className="mt-3 text-sm font-bold leading-7 text-slate-500 dark:text-slate-300">{description}</p>
        </div>

        {evidence.length ? (
          <div className={`rounded-[28px] border px-4 py-3 ${toneClass.ring}`}>
            <p className="text-[11px] font-black tracking-[0.18em] text-slate-400">保存后必须看到</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {evidence.map((item) => (
                <span key={item} className={`rounded-full border px-3 py-1.5 text-xs font-black ${toneClass.chip}`}>
                  {item}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {steps.map((step, index) => (
          <div key={`${step.title}-${index}`} className="rounded-[28px] border border-slate-100 bg-slate-50/75 p-4 dark:border-slate-800 dark:bg-slate-950/35">
            <div className="flex items-center justify-between gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-950 text-sm font-black text-white dark:bg-white dark:text-slate-950">
                {index + 1}
              </span>
              {step.badge ? (
                <span className={`rounded-full border px-3 py-1 text-[10px] font-black tracking-[0.16em] ${toneClass.chip}`}>
                  {step.badge}
                </span>
              ) : null}
            </div>
            <h3 className="mt-4 text-base font-black text-slate-950 dark:text-white">{step.title}</h3>
            <p className="mt-2 text-sm font-bold leading-6 text-slate-500 dark:text-slate-300">{step.description}</p>
          </div>
        ))}
      </div>

      {boundaries.length ? (
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {boundaries.map((boundary) => (
            <div key={boundary.title} className="rounded-[28px] border border-slate-100 bg-white/80 p-4 dark:border-slate-800 dark:bg-slate-950/35">
              <h3 className="text-sm font-black text-slate-950 dark:text-white">{boundary.title}</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {boundary.items.map((item) => (
                  <span key={item} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-200">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
};

export default DocumentInputGuide;
