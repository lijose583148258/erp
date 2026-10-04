import React, { useId, useRef } from 'react';

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

export const PageShell: React.FC<Props> = ({ eyebrow, title, subtitle, actions, tabs = [], children, className = '' }) => {
  const generatedId = useId();
  const titleId = `page-title-${generatedId}`;
  const subtitleId = `page-subtitle-${generatedId}`;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const focusTab = (index: number) => {
    const safeIndex = (index + tabs.length) % tabs.length;
    tabRefs.current[safeIndex]?.focus();
  };

  return (
    <div
      data-page-shell
      className={`space-y-6 ${className}`}
      aria-labelledby={titleId}
      aria-describedby={subtitle ? subtitleId : undefined}
    >
      <header className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          {eyebrow ? <p className="app-section-title mb-2">{eyebrow}</p> : null}
          <h1 id={titleId} data-page-title className="text-2xl font-black tracking-tight text-slate-950 dark:text-white sm:text-3xl">
            {title}
          </h1>
          {subtitle ? <p id={subtitleId} className="mt-2 max-w-4xl text-sm font-medium leading-6 text-slate-500 dark:text-slate-300">{subtitle}</p> : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {tabs.length > 0 ? (
            <div role="tablist" aria-label={`${String(title)}功能区`} className="flex flex-wrap gap-2 rounded-2xl bg-slate-100 p-1 dark:bg-slate-800">
              {tabs.map((tab, index) => (
                <button
                  key={tab.id}
                  ref={(node) => { tabRefs.current[index] = node; }}
                  type="button"
                  role="tab"
                  aria-selected={Boolean(tab.active)}
                  tabIndex={tab.active ? 0 : -1}
                  data-testid={tab.testId}
                  onClick={tab.onClick}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                      event.preventDefault();
                      focusTab(index + 1);
                    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                      event.preventDefault();
                      focusTab(index - 1);
                    } else if (event.key === 'Home') {
                      event.preventDefault();
                      focusTab(0);
                    } else if (event.key === 'End') {
                      event.preventDefault();
                      focusTab(tabs.length - 1);
                    }
                  }}
                  className={`min-h-11 rounded-xl px-5 py-2.5 text-xs font-black tracking-wide transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 motion-reduce:transition-none ${tab.active ? 'bg-white text-blue-600 shadow dark:bg-slate-700' : 'text-slate-500 hover:text-slate-700 dark:text-slate-300 dark:hover:text-white'}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          ) : null}
          {actions}
        </div>
      </header>

      {children}
    </div>
  );
};
