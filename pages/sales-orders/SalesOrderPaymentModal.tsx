import React from 'react';
import { Info, X } from 'lucide-react';
import { SalesOrder } from '../../types';
import { getCustomerDisplayName } from '../../utils/customerName';
import {
    getEffectiveReceivableAmount,
    getOutstandingAmount,
    getReceivableAdjustmentAmount,
} from './salesOrderFormHelpers';

type Props = {
    isOpen: boolean;
    selectedOrder: SalesOrder | null;
    language: 'zh' | 'en' | 'vi';
    t: Record<string, string>;
    formatPrice: (amount: number) => string;
    paymentForm: {
        amount: number;
        date: string;
        method: string;
        isProxy: boolean;
        payerName: string;
        note: string;
    };
    setPaymentForm: React.Dispatch<React.SetStateAction<any>>;
    onClose: () => void;
    onConfirm: () => void;
};

const SalesOrderPaymentModal: React.FC<Props> = ({ isOpen, selectedOrder, language, t, formatPrice, paymentForm, setPaymentForm, onClose, onConfirm }) => {
    if (!isOpen || !selectedOrder) return null;
    const finalAmount = Number(selectedOrder.finalAmount || selectedOrder.totalAmount || 0);
    const receivableAdjustmentAmount = getReceivableAdjustmentAmount(selectedOrder);
    const effectiveReceivableAmount = getEffectiveReceivableAmount(selectedOrder);
    const remainingBalance = getOutstandingAmount(selectedOrder);

    return (
        <div data-testid="sales-order-payment-modal" className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-[32px] p-8 shadow-2xl animate-in zoom-in-95">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-black italic text-slate-900 dark:text-white">{t.recordPayment}</h3>
                    <button onClick={onClose} className="p-2 bg-slate-100 dark:bg-slate-800 rounded-full"><X size={20} /></button>
                </div>
                <div className="space-y-4">
                    <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl text-[10px] font-bold text-indigo-600 dark:text-indigo-300 flex items-center">
                        <Info size={14} className="mr-2 shrink-0" />
                        {t.paymentSharedResponsibility}
                    </div>

                    <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl mb-4">
                        <p className="text-[10px] font-black uppercase text-slate-400">Target Order</p>
                        <p className="font-bold text-slate-800 dark:text-white">{getCustomerDisplayName({
                            name: selectedOrder.customerName,
                            nameZh: selectedOrder.customerNameZh,
                            nameEn: selectedOrder.customerNameEn,
                            nameVi: selectedOrder.customerNameVi,
                            displayName: selectedOrder.customerDisplayName,
                        }, language)}</p>
                        <div data-testid="sales-order-payment-effective-summary" className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-slate-500">
                            <span>原应收：{formatPrice(finalAmount)}</span>
                            <span>已收：{formatPrice(selectedOrder.paidAmount || 0)}</span>
                            <span>应收调整：-{formatPrice(receivableAdjustmentAmount)}</span>
                            <span>有效未收：<b className="text-rose-500">{formatPrice(remainingBalance)}</b></span>
                        </div>
                        {receivableAdjustmentAmount > 0 ? (
                            <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                                本单存在应收调整，回款金额按有效应收 {formatPrice(effectiveReceivableAmount)} 校验。
                            </p>
                        ) : null}
                    </div>
                    <div>
                        <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Amount (Partial or Full)</label>
                        <input data-testid="sales-order-payment-amount" type="number" className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-black text-lg outline-none focus:ring-2 focus:ring-blue-100" value={paymentForm.amount} onChange={e => setPaymentForm({ ...paymentForm, amount: Number(e.target.value) })} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Date</label>
                            <input type="date" className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold outline-none" value={paymentForm.date} onChange={e => setPaymentForm({ ...paymentForm, date: e.target.value })} />
                        </div>
                        <div>
                            <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Method</label>
                            <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold outline-none appearance-none" value={paymentForm.method} onChange={e => setPaymentForm({ ...paymentForm, method: e.target.value })}>
                                <option value="Bank Transfer">Bank Transfer</option>
                                <option value="Cash">Cash</option>
                                <option value="Check">Check</option>
                                <option value="Alipay/WeChat">Alipay/WeChat</option>
                            </select>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 p-2">
                        <input type="checkbox" id="proxy" className="w-5 h-5 rounded-lg accent-blue-600" checked={paymentForm.isProxy} onChange={e => setPaymentForm({ ...paymentForm, isProxy: e.target.checked })} />
                        <label htmlFor="proxy" className="font-bold text-sm text-slate-700 dark:text-slate-300">{t.proxyPaymentLabel}</label>
                    </div>
                    {paymentForm.isProxy && (
                        <div className="animate-in slide-in-from-top-2">
                            <label className="text-[10px] font-black uppercase text-slate-400 ml-2">{t.proxyPayerName}</label>
                            <input type="text" className="w-full p-4 bg-amber-50 dark:bg-amber-900/20 rounded-2xl font-bold outline-none text-amber-900 dark:text-amber-100" placeholder={t.phActualPayer} value={paymentForm.payerName} onChange={e => setPaymentForm({ ...paymentForm, payerName: e.target.value })} />
                        </div>
                    )}
                    <div>
                        <input type="text" className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm outline-none" placeholder={t.phNote} value={paymentForm.note} onChange={e => setPaymentForm({ ...paymentForm, note: e.target.value })} />
                    </div>
                    <button data-testid="sales-order-payment-confirm" onClick={onConfirm} className="w-full py-4 bg-emerald-500 text-white rounded-[24px] font-black shadow-xl hover:bg-emerald-600 active:scale-95 transition-all mt-4">Confirm Payment</button>
                </div>
            </div>
        </div>
    );
};

export default SalesOrderPaymentModal;
