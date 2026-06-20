import React from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import type { Notification } from '../../types';

type ToastStackProps = {
    notifications: Notification[];
    onDismiss: (id: string) => void;
};

const ToastStack: React.FC<ToastStackProps> = ({ notifications, onDismiss }) => {
    return (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[150] space-y-2 w-full max-w-sm px-4">
            {notifications.map(n => (
                <div
                    key={n.id}
                    className={`flex items-center p-4 rounded-2xl shadow-2xl backdrop-blur-md border animate-in slide-in-from-top-4 fade-in duration-300 ${
                        n.type === 'success'
                            ? 'bg-emerald-50/90 border-emerald-100 text-emerald-800'
                            : n.type === 'error'
                                ? 'bg-rose-50/90 border-rose-100 text-rose-800'
                                : n.type === 'warning'
                                    ? 'bg-amber-50/90 border-amber-100 text-amber-800'
                                    : 'bg-white/90 border-slate-100 text-slate-800'
                    }`}
                >
                    <div
                        className={`mr-3 p-1 rounded-full ${
                            n.type === 'success'
                                ? 'bg-emerald-200 text-emerald-700'
                                : n.type === 'error'
                                    ? 'bg-rose-200 text-rose-700'
                                    : n.type === 'warning'
                                        ? 'bg-amber-200 text-amber-700'
                                        : 'bg-slate-200 text-slate-600'
                        }`}
                    >
                        {n.type === 'success' && <CheckCircle2 size={16} />}
                        {n.type === 'error' && <XCircle size={16} />}
                        {n.type === 'warning' && <AlertTriangle size={16} />}
                        {n.type === 'info' && <Info size={16} />}
                    </div>
                    <span className="min-w-0 flex-1 break-words text-sm font-bold">{n.message}</span>
                    <button
                        type="button"
                        onClick={() => onDismiss(n.id)}
                        aria-label="关闭通知"
                        className="ml-2 flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-xl opacity-70 transition hover:bg-white/60 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-current/30"
                    >
                        <X size={16} />
                    </button>
                </div>
            ))}
        </div>
    );
};

export default ToastStack;
