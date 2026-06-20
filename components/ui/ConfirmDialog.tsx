import React, { useRef } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useDialogFocus } from '../../app/useDialogFocus';

type Props = {
  open: boolean;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: React.ReactNode;
  cancelLabel?: React.ReactNode;
  tone?: 'danger' | 'primary' | 'success';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export const ConfirmDialog: React.FC<Props> = ({
  open,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  tone = 'primary',
  loading = false,
  onConfirm,
  onCancel,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(open, dialogRef, onCancel);

  if (!open) return null;

  const isDanger = tone === 'danger';
  const Icon = isDanger ? AlertTriangle : CheckCircle2;
  const confirmClass = isDanger
    ? 'bg-rose-600 text-white hover:bg-rose-700'
    : tone === 'success'
      ? 'bg-emerald-600 text-white hover:bg-emerald-700'
      : 'bg-blue-600 text-white hover:bg-blue-700';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 px-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className="w-full max-w-md rounded-[30px] border border-slate-200 bg-white p-6 shadow-appSoft outline-none dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="flex items-start gap-4">
          <div className={`rounded-2xl p-3 ${isDanger ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/30' : 'bg-blue-50 text-blue-600 dark:bg-blue-950/30'}`}>
            <Icon size={22} />
          </div>
          <div className="min-w-0">
            <h3 className="text-lg font-black tracking-tight text-slate-900 dark:text-white">{title}</h3>
            {description ? <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-300">{description}</p> : null}
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            data-autofocus
            onClick={onCancel}
            disabled={loading}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black tracking-[0.14em] text-slate-500 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`rounded-2xl px-4 py-2.5 text-xs font-black tracking-[0.14em] transition disabled:opacity-50 ${confirmClass}`}
          >
            {loading ? '处理中' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
