import React from 'react';
import { Inbox } from 'lucide-react';

type Props = {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
};

export const EmptyState: React.FC<Props> = ({ icon, title, description, action, className = '' }) => (
  <div className={`flex flex-col items-center justify-center rounded-[26px] border border-dashed border-slate-200 bg-slate-50/70 px-6 py-10 text-center dark:border-slate-700 dark:bg-slate-800/50 ${className}`}>
    <div className="mb-4 rounded-2xl bg-white p-4 text-slate-400 shadow-sm dark:bg-slate-900 dark:text-slate-500">
      {icon || <Inbox size={24} />}
    </div>
    <h3 className="text-sm font-black tracking-tight text-slate-800 dark:text-white">{title}</h3>
    {description ? <p className="mt-2 max-w-md text-xs leading-6 text-slate-500 dark:text-slate-400">{description}</p> : null}
    {action ? <div className="mt-5">{action}</div> : null}
  </div>
);
