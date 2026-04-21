import React from 'react';
import { Search } from 'lucide-react';

type ActionToolbarAction = {
  label: React.ReactNode;
  onClick?: () => void;
  icon?: React.ReactNode;
  tone?: 'primary' | 'neutral' | 'success' | 'danger';
  disabled?: boolean;
  testId?: string;
};

type Props = {
  title?: React.ReactNode;
  description?: React.ReactNode;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  searchInputTestId?: string;
  resultCount?: number;
  actions?: ActionToolbarAction[];
  children?: React.ReactNode;
  className?: string;
};

const actionToneClass: Record<NonNullable<ActionToolbarAction['tone']>, string> = {
  primary: 'bg-blue-600 text-white shadow-appLift hover:bg-blue-700',
  neutral: 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700',
  success: 'bg-emerald-600 text-white shadow-appLift hover:bg-emerald-700',
  danger: 'bg-rose-600 text-white shadow-appLift hover:bg-rose-700',
};

export const ActionToolbar: React.FC<Props> = ({
  title,
  description,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search',
  searchInputTestId,
  resultCount,
  actions = [],
  children,
  className = '',
}) => {
  const showSearch = typeof searchValue === 'string' && onSearchChange;

  return (
    <div className={`flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between ${className}`}>
      {(title || description) && (
        <div>
          {title ? <h3 className="text-sm font-black uppercase tracking-[0.18em] text-slate-700 dark:text-slate-200">{title}</h3> : null}
          {description ? <p className="mt-1 text-xs font-medium text-slate-400">{description}</p> : null}
        </div>
      )}

      <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
        {showSearch ? (
          <label className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/60 sm:max-w-md">
            <Search size={16} className="flex-shrink-0 text-slate-400" />
            <input
              data-testid={searchInputTestId}
              value={searchValue}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent text-sm font-bold outline-none placeholder:text-slate-400"
            />
            {typeof resultCount === 'number' ? (
              <span className="rounded-full bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 dark:bg-slate-900">
                {resultCount}
              </span>
            ) : null}
          </label>
        ) : null}

        {children}

        {actions.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {actions.map((action, index) => (
              <button
                key={`${String(action.label)}-${index}`}
                type="button"
                data-testid={action.testId}
                onClick={action.onClick}
                disabled={action.disabled}
                className={`inline-flex items-center justify-center rounded-[18px] px-4 py-2.5 text-xs font-black tracking-[0.14em] transition disabled:cursor-not-allowed disabled:opacity-50 ${actionToneClass[action.tone || 'neutral']}`}
              >
                {action.icon ? <span className="mr-2">{action.icon}</span> : null}
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
};
