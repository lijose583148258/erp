import React, { useId } from 'react';

type Option = {
  value: string;
  label: React.ReactNode;
};

type Props = {
  label?: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  as?: 'input' | 'textarea' | 'select';
  options?: Option[];
  rows?: number;
  required?: boolean;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  disabled?: boolean;
  readOnly?: boolean;
  autoFocus?: boolean;
  list?: string;
  maxLength?: number;
  dataTestId?: string;
  className?: string;
  inputClassName?: string;
  transformValue?: (value: string) => string;
};

export const FormField: React.FC<Props> = ({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  as = 'input',
  options = [],
  rows = 3,
  required = false,
  hint,
  error,
  disabled = false,
  readOnly = false,
  autoFocus = false,
  list,
  maxLength,
  dataTestId,
  className = '',
  inputClassName = '',
  transformValue,
}) => {
  const generatedId = useId();
  const controlId = dataTestId || `form-field-${generatedId}`;
  const errorId = `${controlId}-error`;
  const hintId = `${controlId}-hint`;
  const countId = `${controlId}-count`;
  const baseClass = `app-control w-full ${error ? 'border-rose-300 focus:border-rose-300 focus:ring-rose-100 dark:focus:ring-rose-900/30' : ''} ${inputClassName}`;
  const handleChange = (nextValue: string) => onChange(transformValue ? transformValue(nextValue) : nextValue);
  const valueTitle = value.length > 18 ? value : undefined;
  const showCount = typeof maxLength === 'number' && maxLength > 0 && (as === 'input' || as === 'textarea');
  const describedBy = [
    error ? errorId : null,
    !error && hint ? hintId : null,
    showCount ? countId : null,
  ].filter(Boolean).join(' ') || undefined;
  const remaining = showCount ? maxLength - value.length : 0;
  const countClass = remaining <= 0
    ? 'text-rose-600 dark:text-rose-300'
    : remaining <= Math.min(10, Math.ceil((maxLength || 0) * 0.12))
      ? 'text-amber-600 dark:text-amber-300'
      : 'text-slate-400 dark:text-slate-500';

  return (
    <label className={`block space-y-1.5 ${className}`}>
      {label ? (
        <span className="flex items-center gap-1 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">
          {label}
          {required ? <span className="text-rose-500">*</span> : null}
        </span>
      ) : null}

      {as === 'textarea' ? (
        <textarea
          id={controlId}
          data-testid={dataTestId}
          data-autofocus={autoFocus || undefined}
          value={value}
          title={valueTitle}
          onChange={(event) => handleChange(event.target.value)}
          placeholder={placeholder}
          rows={rows}
          disabled={disabled}
          readOnly={readOnly}
          autoFocus={autoFocus}
          maxLength={maxLength}
          required={required}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className={`${baseClass} min-h-[96px] resize-y app-long-text`}
        />
      ) : as === 'select' ? (
        <select
          id={controlId}
          data-testid={dataTestId}
          data-autofocus={autoFocus || undefined}
          value={value}
          title={valueTitle}
          onChange={(event) => handleChange(event.target.value)}
          disabled={disabled}
          autoFocus={autoFocus}
          required={required}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className={baseClass}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={controlId}
          data-testid={dataTestId}
          data-autofocus={autoFocus || undefined}
          type={type}
          value={value}
          title={valueTitle}
          onChange={(event) => handleChange(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          readOnly={readOnly}
          autoFocus={autoFocus}
          list={list}
          maxLength={maxLength}
          required={required}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className={baseClass}
        />
      )}

      {(error || hint || showCount) ? (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {error ? <p id={errorId} className="text-[11px] font-bold text-rose-500">{error}</p> : hint ? <p id={hintId} className="text-[11px] font-medium text-slate-400">{hint}</p> : null}
          </div>
          {showCount ? (
            <span id={countId} className={`shrink-0 text-[11px] font-black tabular-nums ${countClass}`}>
              {value.length}/{maxLength}
            </span>
          ) : null}
        </div>
      ) : null}
    </label>
  );
};
