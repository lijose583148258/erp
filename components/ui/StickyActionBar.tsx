import React from 'react';

type Props = {
  children: React.ReactNode;
  className?: string;
  label?: string;
};

export const StickyActionBar: React.FC<Props> = ({ children, className = '', label = '当前表单操作' }) => (
  <div
    role="region"
    aria-label={label}
    data-sticky-action-bar
    className={`sticky bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 rounded-[24px] border border-slate-200 bg-white/95 p-3 shadow-appSoft backdrop-blur-xl dark:border-slate-700 dark:bg-slate-900/95 ${className}`}
  >
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">{children}</div>
  </div>
);
