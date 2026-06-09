import React from 'react';
import { FileText, Receipt, ShieldCheck, Users } from 'lucide-react';
import { Customer } from '../../types';
import { getCustomerDisplayName } from '../../utils/customerName';
import type { SalesOrderFormData } from './useSalesOrders';

type Props = {
    language: 'zh' | 'en' | 'vi';
    t: Record<string, string>;
    customers: Customer[];
    contracts: any[];
    formData: SalesOrderFormData;
    isEditMode: boolean;
    updateOrderHeader: <K extends keyof SalesOrderFormData>(field: K, value: SalesOrderFormData[K]) => void;
    formatPrice: (amount: number) => string;
};

const SectionLabel: React.FC<{ icon: React.ReactNode; title: string; hint: string }> = ({ icon, title, hint }) => (
    <div>
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500">
            <span className="flex h-7 w-7 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">{icon}</span>
            {title}
        </div>
        <p className="mt-2 text-[11px] font-medium text-slate-400">{hint}</p>
    </div>
);

const SalesOrderHeaderForm: React.FC<Props> = ({
    language,
    t,
    customers,
    contracts,
    formData,
    isEditMode,
    updateOrderHeader,
    formatPrice,
}) => {
    const filteredContracts = contracts.filter((contract: any) => !formData.customerId || String(contract.customerId) === String(formData.customerId));

    return (
        <div className="rounded-[32px] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
            <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                    <h3 className="text-lg font-black tracking-tight text-slate-900 dark:text-white">
                        {t.orderHeaderTitle || '订单头表单'}
                    </h3>
                    <p className="mt-2 text-sm text-slate-400">
                        {t.orderHeaderHint || '客户、合同、账期和备注放在这里维护，明细行单独走网格。'}
                    </p>
                </div>
                <span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-blue-600 dark:bg-blue-900/20 dark:text-blue-300">
                    {isEditMode ? (t.editing || '编辑中') : (t.newOrder || '新建订单')}
                </span>
            </div>

            <div className="space-y-6">
                <div className="grid gap-5 xl:grid-cols-2">
                    <div className="space-y-3 xl:col-span-2">
                        <SectionLabel
                            icon={<Users size={14} />}
                            title={t.customer || '客户'}
                            hint={t.orderHeaderCustomerHint || '订单头只选一次客户，明细行不再重复录客户。'}
                        />
                        <select
                            data-testid="sales-order-customer-select"
                            className="w-full rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-4 text-sm font-bold outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800"
                            value={formData.customerId}
                            onChange={(event) => updateOrderHeader('customerId', event.target.value)}
                            disabled={isEditMode}
                        >
                            <option value="">{t.phSelectCustomer || '请选择客户'}</option>
                            {customers.map((customer) => (
                                <option key={customer.id} value={customer.id}>
                                    {getCustomerDisplayName(customer, language)}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-3">
                        <SectionLabel
                            icon={<Receipt size={14} />}
                            title={t.termsDays || '账期天数'}
                            hint={t.orderHeaderTermsHint || '这里定义订单头的账期规则，回款链直接复用。'}
                        />
                        <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            className="w-full rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-4 text-sm font-black outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-800"
                            value={formData.paymentTermsDays}
                            onChange={(event) => updateOrderHeader('paymentTermsDays', Number(event.target.value) || 0)}
                        />
                    </div>

                    <div className="space-y-3">
                        <SectionLabel
                            icon={<ShieldCheck size={14} />}
                            title={t.taxMode || '税额模式'}
                            hint={t.orderHeaderTaxHint || '税含/税外放在订单头控制，不再散落在明细里。'}
                        />
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                type="button"
                                onClick={() => updateOrderHeader('taxInclusive', true)}
                                className={`rounded-[20px] px-4 py-4 text-sm font-black transition ${
                                    formData.taxInclusive
                                        ? 'bg-slate-900 text-white shadow-lg dark:bg-white dark:text-slate-900'
                                        : 'border border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                }`}
                            >
                                {t.taxInclusive || '含税'}
                            </button>
                            <button
                                type="button"
                                onClick={() => updateOrderHeader('taxInclusive', false)}
                                className={`rounded-[20px] px-4 py-4 text-sm font-black transition ${
                                    !formData.taxInclusive
                                        ? 'bg-slate-900 text-white shadow-lg dark:bg-white dark:text-slate-900'
                                        : 'border border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                }`}
                            >
                                {t.taxExclusive || '未税'}
                            </button>
                        </div>
                    </div>

                    <div className="space-y-3 xl:col-span-2">
                        <SectionLabel
                            icon={<FileText size={14} />}
                            title={t.linkContractTitle || '关联合同'}
                            hint={t.orderHeaderContractHint || '合同挂在订单头，防止明细层重复挂载。'}
                        />
                        <select
                            data-testid="sales-order-contract-select"
                            className="w-full rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-4 text-sm font-bold outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-800"
                            value={formData.contractId}
                            onChange={(event) => updateOrderHeader('contractId', event.target.value)}
                        >
                            <option value="">{t.noContractLinked || '不关联合同'}</option>
                            {filteredContracts.map((contract: any) => (
                                <option key={contract.id} value={contract.id}>
                                    {contract.contractNo} - {contract.title} ({formatPrice(contract.totalAmount || 0)})
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-3 xl:col-span-2">
                        <SectionLabel
                            icon={<FileText size={14} />}
                            title={t.notes || '订单备注'}
                            hint={t.orderHeaderNotesHint || '跟客户约定、发运提醒、结算备注都放在订单头。'}
                        />
                        <textarea
                            data-testid="sales-order-notes"
                            value={formData.notes}
                            onChange={(event) => updateOrderHeader('notes', event.target.value)}
                            placeholder={t.orderNotesPlaceholder || '填写这张订单的业务说明、交付要求、结算备注...'}
                            className="h-28 w-full rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-4 text-sm font-medium outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-800"
                        />
                    </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-[24px] border border-slate-100 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-800/60">
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{t.customer || '客户'}</div>
                        <div className="mt-2 text-sm font-black text-slate-800 dark:text-slate-100">
                            {customers.find((customer) => String(customer.id) === String(formData.customerId))
                                ? getCustomerDisplayName(
                                      customers.find((customer) => String(customer.id) === String(formData.customerId))!,
                                      language,
                                  )
                                : '--'}
                        </div>
                    </div>
                    <div className="rounded-[24px] border border-slate-100 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-800/60">
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{t.termsDays || '账期'}</div>
                        <div className="mt-2 text-sm font-black text-slate-800 dark:text-slate-100">{formData.paymentTermsDays} {t.days || '天'}</div>
                    </div>
                    <div className="rounded-[24px] border border-slate-100 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-800/60">
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{t.taxMode || '税额模式'}</div>
                        <div className="mt-2 text-sm font-black text-slate-800 dark:text-slate-100">
                            {formData.taxInclusive ? (t.taxInclusive || '含税') : (t.taxExclusive || '未税')}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SalesOrderHeaderForm;
