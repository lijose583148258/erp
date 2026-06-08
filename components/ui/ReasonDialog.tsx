import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText } from 'lucide-react';

type ReasonDialogTone = 'danger' | 'primary' | 'success';

type ReasonDialogProps = {
  open: boolean;
  title: React.ReactNode;
  description?: React.ReactNode;
  testId?: string;
  defaultReason?: string;
  placeholder?: string;
  confirmLabel?: React.ReactNode;
  cancelLabel?: React.ReactNode;
  tone?: ReasonDialogTone;
  loading?: boolean;
  required?: boolean;
  onConfirm: (reason: string) => void | Promise<void>;
  onCancel: () => void;
};

const toneClassMap: Record<ReasonDialogTone, string> = {
  danger: 'bg-rose-600 text-white hover:bg-rose-700',
  primary: 'bg-blue-600 text-white hover:bg-blue-700',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700',
};

export const ReasonDialog: React.FC<ReasonDialogProps> = ({
  open,
  title,
  description,
  testId = 'reason-dialog',
  defaultReason = '',
  placeholder = '请填写原因，便于后续审计追踪',
  confirmLabel = '确认',
  cancelLabel = '取消',
  tone = 'primary',
  loading = false,
  required = true,
  onConfirm,
  onCancel,
}) => {
  const [reason, setReason] = useState(defaultReason);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setReason(defaultReason);
      setError('');
    }
  }, [defaultReason, open]);

  if (!open) return null;

  const isDanger = tone === 'danger';
  const Icon = isDanger ? AlertTriangle : tone === 'success' ? CheckCircle2 : FileText;

  const handleConfirm = () => {
    const nextReason = reason.trim();
    if (required && !nextReason) {
      setError('请填写原因后再确认');
      return;
    }
    void onConfirm(nextReason || defaultReason.trim());
  };

  return (
    <div data-testid={testId} className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-[30px] border border-slate-200 bg-white p-6 shadow-appSoft dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-start gap-4">
          <div className={`rounded-2xl p-3 ${isDanger ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/30' : 'bg-blue-50 text-blue-600 dark:bg-blue-950/30'}`}>
            <Icon size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-black tracking-tight text-slate-900 dark:text-white">{title}</h3>
            {description ? <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-300">{description}</p> : null}
          </div>
        </div>

        <div className="mt-5">
          <label className="mb-2 block text-xs font-black tracking-[0.16em] text-slate-400">
            原因说明
          </label>
          <textarea
            data-testid={`${testId}-input`}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              if (error) setError('');
            }}
            placeholder={placeholder}
            disabled={loading}
            className="h-28 w-full resize-none rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:ring-blue-950/30"
          />
          {error ? <p className="mt-2 text-xs font-bold text-rose-600">{error}</p> : null}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black tracking-[0.14em] text-slate-500 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading}
            data-testid={`${testId}-confirm`}
            className={`rounded-2xl px-4 py-2.5 text-xs font-black tracking-[0.14em] transition disabled:opacity-50 ${toneClassMap[tone]}`}
          >
            {loading ? '处理中' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
