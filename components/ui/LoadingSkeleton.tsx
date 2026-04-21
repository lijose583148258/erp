import React from 'react';

type Props = {
  variant?: 'card' | 'table' | 'lines';
  rows?: number;
  className?: string;
};

export const LoadingSkeleton: React.FC<Props> = ({ variant = 'lines', rows = 4, className = '' }) => {
  if (variant === 'table') {
    return (
      <div className={`space-y-3 p-4 ${className}`}>
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="grid grid-cols-5 gap-3">
            <div className="h-10 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
            <div className="h-10 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
            <div className="h-10 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
            <div className="h-10 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
            <div className="h-10 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'card') {
    return (
      <div className={`rounded-[28px] border border-slate-100 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 ${className}`}>
        <div className="h-4 w-24 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
        <div className="mt-5 h-8 w-36 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
        <div className="mt-3 h-3 w-full animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-4 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" style={{ width: `${92 - index * 7}%` }} />
      ))}
    </div>
  );
};
