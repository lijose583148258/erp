import React from 'react';

type Props = {
  children: React.ReactNode;
  className?: string;
};

export const StickyActionBar: React.FC<Props> = ({ children, className = '' }) => (
  <div className={`sticky bottom-4 z-20 rounded-[24px] border border-slate-200 bg-white/90 p-3 shadow-appSoft backdrop-blur-xl dark:border-slate-700 dark:bg-slate-900/90 ${className}`}>
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">{children}</div>
  </div>
);
