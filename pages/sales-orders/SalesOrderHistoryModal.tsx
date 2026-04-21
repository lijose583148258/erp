import React from 'react';
import { Calendar, CreditCard, User, Wallet, X } from 'lucide-react';
import { SalesOrder } from '../../types';
import { getCustomerDisplayName } from '../../utils/customerName';

type CollectionView = {
    label: string;
    nextAction: string;
    tone: 'emerald' | 'amber' | 'orange' | 'rose' | 'slate';
    overdueDays: number;
};

type Props = {
    isOpen: boolean;
    selectedOrder: SalesOrder | null;
    language: 'zh' | 'en' | 'vi';
    historyTab: 'payments' | 'audit';
    setHistoryTab: (tab: 'payments' | 'audit') => void;
    t: Record<string, string>;
    formatPrice: (amount: number) => string;
    getOutstandingAmount: (order: SalesOrder) => number;
    getCollectionView: (order: SalesOrder) => CollectionView;
    canVerifyPayment: boolean;
    onClose: () => void;
    onOpenPromise: () => void;
    onOpenDispute: () => void;
    onVerifyPayment: (paymentId: string) => void;
};

const SalesOrderHistoryModal: React.FC<Props> = ({
    isOpen,
    selectedOrder,
    language,
    historyTab,
    setHistoryTab,
    t,
    formatPrice,
    getOutstandingAmount,
    getCollectionView,
    canVerifyPayment,
    onClose,
    onOpenPromise,
    onOpenDispute,
    onVerifyPayment,
}) => {
    if (!isOpen || !selectedOrder) return null;
    const promiseRecords = [...(selectedOrder.collectionPromises || [])].sort((a, b) =>
        new Date(b.createdAt || b.promisedAt || 0).getTime() - new Date(a.createdAt || a.promisedAt || 0).getTime()
    );

    return (
        <div data-testid="sales-order-history-modal" className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-[32px] p-8 shadow-2xl animate-in zoom-in-95 border border-slate-100 dark:border-slate-800">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h3 className="text-xl font-black italic text-slate-900 dark:text-white uppercase">{t.activityLog}</h3>
                        <p className="text-xs text-slate-400 font-bold">{getCustomerDisplayName({
                            name: selectedOrder.customerName,
                            nameZh: selectedOrder.customerNameZh,
                            nameEn: selectedOrder.customerNameEn,
                            nameVi: selectedOrder.customerNameVi,
                            displayName: selectedOrder.customerDisplayName,
                        }, language)}</p>
                    </div>
                    <button onClick={onClose} className="p-2 bg-slate-100 dark:bg-slate-800 rounded-full"><X size={20} /></button>
                </div>

                <div className="flex mb-4 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                    <button onClick={() => setHistoryTab('payments')} className={`flex-1 py-2 text-xs font-bold uppercase rounded-lg transition-all ${historyTab === 'payments' ? 'bg-white dark:bg-slate-700 shadow text-slate-900 dark:text-white' : 'text-slate-400'}`}>{t.historyTab}</button>
                    <button onClick={() => setHistoryTab('audit')} className={`flex-1 py-2 text-xs font-bold uppercase rounded-lg transition-all ${historyTab === 'audit' ? 'bg-white dark:bg-slate-700 shadow text-slate-900 dark:text-white' : 'text-slate-400'}`}>{t.auditTab}</button>
                </div>

                {getOutstandingAmount(selectedOrder) > 0 && (
                    <div className="mb-4">
                        <div className="rounded-[20px] border border-slate-100 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-800/40">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">追款摘要</p>
                                    <div className="mt-2 flex items-center gap-2">
                                        <span className={`px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-widest ${
                                            getCollectionView(selectedOrder).tone === 'amber' ? 'bg-amber-50 text-amber-700 border border-amber-100' :
                                            getCollectionView(selectedOrder).tone === 'orange' ? 'bg-orange-50 text-orange-700 border border-orange-100' :
                                            getCollectionView(selectedOrder).tone === 'rose' ? 'bg-rose-50 text-rose-700 border border-rose-100' :
                                            'bg-slate-50 text-slate-500 border border-slate-100'
                                        }`}>
                                            {getCollectionView(selectedOrder).label}
                                        </span>
                                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">未收 {formatPrice(getOutstandingAmount(selectedOrder))}</span>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">建议动作</p>
                                    <p className="mt-2 text-xs font-bold text-slate-600 dark:text-slate-300">{getCollectionView(selectedOrder).nextAction}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {getOutstandingAmount(selectedOrder) > 0 && (
                    <div className="mb-4 grid grid-cols-2 gap-3">
                        <button data-testid="sales-order-open-promise-button" onClick={onOpenPromise} className="px-4 py-3 rounded-[18px] bg-amber-50 text-amber-700 border border-amber-200 text-xs font-black uppercase tracking-widest hover:bg-amber-100">
                            承诺付款
                        </button>
                        <button data-testid="sales-order-open-dispute-button" onClick={onOpenDispute} className="px-4 py-3 rounded-[18px] bg-rose-50 text-rose-700 border border-rose-200 text-xs font-black uppercase tracking-widest hover:bg-rose-100">
                            发起争议
                        </button>
                    </div>
                )}

                <div className="space-y-4 max-h-[50vh] overflow-y-auto custom-scrollbar pr-2">
                    {historyTab === 'payments' ? (
                        (!selectedOrder.paymentRecords || selectedOrder.paymentRecords.length === 0) ? (
                            <div className="text-center py-10 text-slate-400 text-xs font-bold uppercase tracking-widest bg-slate-50 dark:bg-slate-800/50 rounded-2xl">
                                No payments recorded.
                            </div>
                        ) : (
                            selectedOrder.paymentRecords
                                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                                .map((rec, idx) => (
                                    <div key={idx} className={`p-4 rounded-2xl border relative transition-all ${rec.status === 'verified' ? 'bg-emerald-50/50 border-emerald-100 dark:bg-emerald-900/10 dark:border-emerald-800' : 'bg-slate-50 border-slate-100 dark:bg-slate-800/50 dark:border-slate-700'}`}>
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <p className={`text-lg font-black tracking-tight ${rec.status === 'verified' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-400'}`}>{formatPrice(rec.amount)}</p>
                                                <div className="flex items-center text-[10px] font-bold text-slate-400 uppercase mt-1">
                                                    <Calendar size={10} className="mr-1" /> {rec.date}
                                                    <span className="mx-2">/</span>
                                                    {rec.method === 'Cash' ? <Wallet size={10} className="mr-1" /> : <CreditCard size={10} className="mr-1" />} {rec.method}
                                                </div>
                                            </div>
                                            <div className="flex flex-col items-end gap-1">
                                                <span className={`px-2 py-0.5 rounded-md text-[11px] font-black uppercase ${rec.status === 'verified' ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-500'}`}>
                                                    {rec.status === 'verified' ? t.paymentVerified : t.paymentPending}
                                                </span>
                                                {rec.isProxy && (
                                                    <div className="px-2 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[11px] font-black rounded-lg border border-amber-200 dark:border-amber-800 flex items-center">
                                                        <User size={10} className="mr-1" /> Proxy: {rec.payerName}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        {rec.note && <p className="text-xs text-slate-500 mt-2 italic border-t border-slate-200 dark:border-slate-700 pt-2">"{rec.note}"</p>}
                                        {rec.status === 'pending' && canVerifyPayment && (
                                            <div className="mt-3 flex justify-end">
                                                <button onClick={() => onVerifyPayment(rec.id)} className="px-4 py-2 bg-slate-900 text-white dark:bg-white dark:text-slate-900 rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-lg">
                                                    {t.verify}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                ))
                        )
                    ) : (
                        (!selectedOrder.historyLogs || selectedOrder.historyLogs.length === 0) ? (
                            <div className="text-center py-10 text-slate-400 text-xs font-bold uppercase tracking-widest bg-slate-50 dark:bg-slate-800/50 rounded-2xl">
                                No history available.
                            </div>
                        ) : (
                            selectedOrder.historyLogs
                                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                                .map((log, idx) => (
                                    <div key={idx} className="flex gap-4">
                                        <div className="flex flex-col items-center">
                                            <div className={`w-2 h-2 rounded-full ${idx === 0 ? 'bg-blue-500' : 'bg-slate-300 dark:bg-slate-600'}`}></div>
                                            {idx !== selectedOrder.historyLogs!.length - 1 && <div className="w-0.5 flex-1 bg-slate-100 dark:bg-slate-800 my-1"></div>}
                                        </div>
                                        <div className="pb-4">
                                            <p className="text-[10px] font-black uppercase text-slate-400">{new Date(log.date).toLocaleString()}</p>
                                            <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                                                <span className="text-blue-600 dark:text-blue-400 mr-2">[{log.user}]</span>
                                                {log.action}
                                            </p>
                                            <p className="text-xs text-slate-500 mt-1 bg-slate-50 dark:bg-slate-800/50 p-2 rounded-lg border border-slate-100 dark:border-slate-800">{log.details}</p>
                                        </div>
                                    </div>
                                ))
                        )
                    )}
                    {historyTab === 'payments' && promiseRecords.length > 0 && (
                        <div data-testid="sales-order-promise-readback" className="rounded-2xl border border-amber-100 bg-amber-50/70 p-4 dark:border-amber-900/40 dark:bg-amber-900/10">
                            <p className="text-[10px] font-black uppercase tracking-widest text-amber-600">承诺付款记录</p>
                            <div className="mt-3 space-y-3">
                                {promiseRecords.map((promise) => (
                                    <div key={promise.id} className="rounded-xl bg-white/80 p-3 text-xs font-bold text-slate-600 dark:bg-slate-900/60 dark:text-slate-300">
                                        <div className="flex items-center justify-between gap-3">
                                            <span>{promise.promiseNo || `#${promise.id}`}</span>
                                            <span className="text-amber-700">{formatPrice(promise.promisedAmount)}</span>
                                        </div>
                                        <div className="mt-1 text-slate-400">{promise.promisedAt ? new Date(promise.promisedAt).toLocaleString() : '-'}</div>
                                        {promise.note ? <div className="mt-2 text-slate-500">{promise.note}</div> : null}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {historyTab === 'payments' && (
                    <div className="mt-6 pt-6 border-t border-slate-100 dark:border-slate-800 flex justify-between items-end">
                        <div className="text-xs font-bold text-slate-400 uppercase">Total Verified</div>
                        <div className="text-2xl font-black text-slate-900 dark:text-white italic">{formatPrice(selectedOrder.paidAmount || 0)}</div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SalesOrderHistoryModal;

