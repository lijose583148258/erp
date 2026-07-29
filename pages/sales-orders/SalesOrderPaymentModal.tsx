import React from 'react';
import { Info, X } from 'lucide-react';
import { SalesOrder } from '../../types';
import { getCustomerDisplayName } from '../../utils/customerName';
import {
    getEffectiveReceivableAmount,
    getOutstandingAmount,
    getReceivableAdjustmentAmount,
} from './salesOrderFormHelpers';
import { useDialogFocus } from '../../app/useDialogFocus';

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

const parseFiniteAmountInput = (value: string) => {
    if (!value.trim()) return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const SalesOrderPaymentModal: React.FC<Props> = ({ isOpen, selectedOrder, language, t, formatPrice, paymentForm, setPaymentForm, onClose, onConfirm }) => {
    const dialogRef = React.useRef<HTMLDivElement>(null);
    useDialogFocus(isOpen && Boolean(selectedOrder), dialogRef, onClose);

    if (!isOpen || !selectedOrder) return null;
    const finalAmount = Number(selectedOrder.finalAmount || selectedOrder.totalAmount || 0);
    const receivableAdjustmentAmount = getReceivableAdjustmentAmount(selectedOrder);
    const effectiveReceivableAmount = getEffectiveReceivableAmount(selectedOrder);
    const remainingBalance = getOutstandingAmount(selectedOrder);
    const currentPaymentAmount = Number.isFinite(paymentForm.amount) ? paymentForm.amount : 0;

    return (
        <div data-testid="sales-order-payment-modal" className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="sales-order-payment-title"
                tabIndex={-1}
                className="bg-white dark:bg-slate-900 w-full max-w-md rounded-[32px] p-8 shadow-2xl animate-in zoom-in-95"
            >
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-500">回款登记</p>
                        <h3 id="sales-order-payment-title" className="text-xl font-black italic text-slate-900 dark:text-white">登记回款</h3>
                    </div>
                    <button aria-label={t.close || '关闭'} onClick={onClose} className="p-2 bg-slate-100 dark:bg-slate-800 rounded-full"><X size={20} /></button>
                </div>
                <div className="space-y-4">
                    <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl text-xs font-bold text-indigo-600 dark:text-indigo-300 flex items-center">
                        <Info size={14} className="mr-2 shrink-0" />
                        本窗口只登记本次回款，财务仍需在回款中心核验/核销后才计入正式已收。
                    </div>

                    <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl mb-4">
                        <p className="text-xs font-black uppercase text-slate-400">回款对象</p>
                        <p className="font-bold text-slate-800 dark:text-white">{getCustomerDisplayName({
                            name: selectedOrder.customerName,
                            nameZh: selectedOrder.customerNameZh,
                            nameEn: selectedOrder.customerNameEn,
                            nameVi: selectedOrder.customerNameVi,
                            displayName: selectedOrder.customerDisplayName,
                        }, language)}</p>
                        <div data-testid="sales-order-payment-effective-summary" className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-slate-500">
                            <span>订单应收：{formatPrice(finalAmount)}</span>
                            <span>已登记/已收：{formatPrice(selectedOrder.paidAmount || 0)}</span>
                            <span>应收调整：-{formatPrice(receivableAdjustmentAmount)}</span>
                            <span>有效未收：<b className="text-rose-500">{formatPrice(remainingBalance)}</b></span>
                            <span>本次金额：<b className="text-emerald-600">{formatPrice(currentPaymentAmount)}</b></span>
                        </div>
                        {receivableAdjustmentAmount > 0 ? (
                            <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                                本单存在应收调整 -{formatPrice(receivableAdjustmentAmount)}，回款金额按有效应收 {formatPrice(effectiveReceivableAmount)} 校验。
                            </p>
                        ) : null}
                    </div>
                    <div>
                        <label className="text-xs font-black uppercase text-slate-400 ml-2">本次登记金额（部分或全额）</label>
                        <input data-autofocus data-testid="sales-order-payment-amount" type="number" className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-black text-lg outline-none focus:ring-2 focus:ring-blue-100" value={Number.isFinite(paymentForm.amount) ? paymentForm.amount : ''} onChange={e => setPaymentForm({ ...paymentForm, amount: parseFiniteAmountInput(e.target.value) })} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-black uppercase text-slate-400 ml-2">回款日期</label>
                            <input type="date" className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold outline-none" value={paymentForm.date} onChange={e => setPaymentForm({ ...paymentForm, date: e.target.value })} />
                        </div>
                        <div>
                            <label className="text-xs font-black uppercase text-slate-400 ml-2">回款方式</label>
                            <select className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold outline-none appearance-none" value={paymentForm.method} onChange={e => setPaymentForm({ ...paymentForm, method: e.target.value })}>
                                <option value="bank_transfer">银行转账</option>
                                <option value="cash">现金</option>
                                <option value="check">支票</option>
                                <option value="alipay_wechat">支付宝/微信</option>
                            </select>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 p-2">
                        <input type="checkbox" id="proxy" className="w-5 h-5 rounded-lg accent-blue-600" checked={paymentForm.isProxy} onChange={e => setPaymentForm({ ...paymentForm, isProxy: e.target.checked })} />
                        <label htmlFor="proxy" className="font-bold text-sm text-slate-700 dark:text-slate-300">{t.proxyPaymentLabel}</label>
                    </div>
                    {paymentForm.isProxy && (
                        <div className="animate-in slide-in-from-top-2">
                            <label className="text-xs font-black uppercase text-slate-400 ml-2">{t.proxyPayerName}</label>
                            <input type="text" className="w-full p-4 bg-amber-50 dark:bg-amber-900/20 rounded-2xl font-bold outline-none text-amber-900 dark:text-amber-100" placeholder={t.phActualPayer} value={paymentForm.payerName} onChange={e => setPaymentForm({ ...paymentForm, payerName: e.target.value })} />
                        </div>
                    )}
                    <div>
                        <input type="text" className="w-full p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl font-bold text-sm outline-none" placeholder={t.phNote} value={paymentForm.note} onChange={e => setPaymentForm({ ...paymentForm, note: e.target.value })} />
                    </div>
                    <button data-testid="sales-order-payment-confirm" onClick={onConfirm} className="w-full py-4 bg-emerald-500 text-white rounded-[24px] font-black shadow-xl hover:bg-emerald-600 active:scale-95 transition-all mt-4">提交登记，待财务核验</button>
                </div>
            </div>
        </div>
    );
};

export default SalesOrderPaymentModal;
