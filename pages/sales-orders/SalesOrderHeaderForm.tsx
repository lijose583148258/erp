import React from 'react';
import { Check, FileText, Receipt, Search, ShieldCheck, Users } from 'lucide-react';
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
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600">{icon}</span>
            {title}
        </div>
        <p className="mt-1.5 text-xs font-medium text-slate-500">{hint}</p>
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
    const selectedCustomer = customers.find((customer) => String(customer.id) === String(formData.customerId));
    const selectedCustomerLabel = selectedCustomer ? getCustomerDisplayName(selectedCustomer, language) : '';
    const [customerQuery, setCustomerQuery] = React.useState(selectedCustomerLabel);
    const [isCustomerOpen, setIsCustomerOpen] = React.useState(false);
    const [activeCustomerIndex, setActiveCustomerIndex] = React.useState(-1);
    const customerPickerRef = React.useRef<HTMLDivElement>(null);
    const matchingCustomers = React.useMemo(() => {
        const query = customerQuery.trim().toLocaleLowerCase();
        if (!query) return customers.slice(0, 30);
        return customers.filter((customer) => {
            const searchable = [
                getCustomerDisplayName(customer, language),
                customer.name,
                customer.nameZh,
                customer.nameEn,
                customer.nameVi,
                ...(customer.nameAliases || []),
            ].filter(Boolean).join(' ').toLocaleLowerCase();
            return searchable.includes(query);
        }).slice(0, 30);
    }, [customerQuery, customers, language]);

    React.useEffect(() => {
        setCustomerQuery(selectedCustomerLabel);
    }, [selectedCustomerLabel]);

    React.useEffect(() => {
        if (!isCustomerOpen || matchingCustomers.length === 0) {
            setActiveCustomerIndex(-1);
            return;
        }
        setActiveCustomerIndex((current) => Math.min(Math.max(current, 0), matchingCustomers.length - 1));
    }, [isCustomerOpen, matchingCustomers.length]);

    React.useEffect(() => {
        if (!isCustomerOpen || activeCustomerIndex < 0) return;
        const activeId = matchingCustomers[activeCustomerIndex]?.id;
        if (!activeId) return;
        const option = document.getElementById(`sales-order-customer-option-${activeId}`);
        option?.scrollIntoView({ block: 'nearest' });
    }, [activeCustomerIndex, isCustomerOpen, matchingCustomers]);

    const selectCustomer = (customer: Customer) => {
        updateOrderHeader('customerId', String(customer.id));
        updateOrderHeader('contractId', '');
        setCustomerQuery(getCustomerDisplayName(customer, language));
        setIsCustomerOpen(false);
        setActiveCustomerIndex(-1);
    };
    const activeCustomer = activeCustomerIndex >= 0 ? matchingCustomers[activeCustomerIndex] : null;
    const activeCustomerOptionId = activeCustomer ? `sales-order-customer-option-${activeCustomer.id}` : undefined;
    const notesLimit = 1000;
    const notesOverLimit = formData.notes.length > notesLimit;

    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
            <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                    <div className="text-xs font-black uppercase tracking-[0.18em] text-blue-600 dark:text-blue-300">第 1 步 · 确认客户与交易条件</div>
                    <h3 className="mt-1 text-lg font-black tracking-tight text-slate-900 dark:text-white">
                        {t.orderHeaderTitle || '订单基本信息'}
                    </h3>
                    <p className="mt-1.5 text-sm text-slate-500">
                        {t.orderHeaderHint || '客户、合同、账期和备注放在这里维护，明细行单独走网格。'}
                    </p>
                </div>
                <span className="rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-black text-blue-700 dark:bg-blue-900/20 dark:text-blue-200">
                    {isEditMode ? (t.editing || '编辑中') : (t.newOrder || '新建订单')}
                </span>
            </div>

            <div className="space-y-5">
                <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-4">
                    <div className="space-y-3 lg:col-span-2">
                        <SectionLabel
                            icon={<Users size={14} />}
                            title={t.customer || '客户'}
                            hint={t.orderHeaderCustomerHint || '订单头只选一次客户，明细行不再重复录客户。'}
                        />
                        <div
                            ref={customerPickerRef}
                            className="relative"
                            onBlur={(event) => {
                                if (!customerPickerRef.current?.contains(event.relatedTarget as Node)) {
                                    setIsCustomerOpen(false);
                                    setCustomerQuery(selectedCustomerLabel);
                                }
                            }}
                        >
                            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-slate-500" />
                            <input
                                data-autofocus
                                data-testid="sales-order-customer-select"
                                role="combobox"
                                aria-label={t.customer || '客户'}
                                aria-expanded={isCustomerOpen}
                                aria-controls="sales-order-customer-options"
                                aria-activedescendant={isCustomerOpen ? activeCustomerOptionId : undefined}
                                aria-autocomplete="list"
                                autoComplete="off"
                                value={customerQuery}
                                onFocus={() => {
                                    if (isEditMode) return;
                                    setIsCustomerOpen(true);
                                    setActiveCustomerIndex(0);
                                }}
                                onChange={(event) => {
                                    setCustomerQuery(event.target.value);
                                    setIsCustomerOpen(true);
                                    setActiveCustomerIndex(0);
                                    if (formData.customerId) {
                                        updateOrderHeader('customerId', '');
                                        updateOrderHeader('contractId', '');
                                    }
                                }}
                                onKeyDown={(event) => {
                                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                                        event.preventDefault();
                                        setIsCustomerOpen(true);
                                        const direction = event.key === 'ArrowDown' ? 1 : -1;
                                        setActiveCustomerIndex((current) => {
                                            if (!matchingCustomers.length) return -1;
                                            if (current < 0) return direction > 0 ? 0 : matchingCustomers.length - 1;
                                            return (current + direction + matchingCustomers.length) % matchingCustomers.length;
                                        });
                                        return;
                                    }
                                    if (event.key === 'Home' && isCustomerOpen && matchingCustomers.length) {
                                        event.preventDefault();
                                        setActiveCustomerIndex(0);
                                        return;
                                    }
                                    if (event.key === 'End' && isCustomerOpen && matchingCustomers.length) {
                                        event.preventDefault();
                                        setActiveCustomerIndex(matchingCustomers.length - 1);
                                        return;
                                    }
                                    if (event.key === 'Escape') {
                                        event.stopPropagation();
                                        setIsCustomerOpen(false);
                                        setCustomerQuery(selectedCustomerLabel);
                                        setActiveCustomerIndex(-1);
                                        return;
                                    }
                                    if (event.key === 'Enter' && isCustomerOpen && activeCustomer) {
                                        event.preventDefault();
                                        selectCustomer(activeCustomer);
                                    }
                                }}
                                placeholder={t.phSelectCustomer || '搜索客户名称、简称或别名'}
                                disabled={isEditMode}
                                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm font-bold outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800"
                            />
                            {isCustomerOpen && !isEditMode && (
                                <div id="sales-order-customer-options" role="listbox" className="absolute z-30 mt-2 max-h-72 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                                    {matchingCustomers.length ? matchingCustomers.map((customer, index) => {
                                        const label = getCustomerDisplayName(customer, language);
                                        const isSelected = String(customer.id) === String(formData.customerId);
                                        const isActive = index === activeCustomerIndex;
                                        return (
                                            <div
                                                key={customer.id}
                                                id={`sales-order-customer-option-${customer.id}`}
                                                role="option"
                                                data-testid={`sales-order-customer-option-${customer.id}`}
                                                aria-selected={isSelected}
                                                onMouseDown={(event) => event.preventDefault()}
                                                onMouseMove={() => setActiveCustomerIndex(index)}
                                                onClick={() => selectCustomer(customer)}
                                                className={`flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm font-bold ${
                                                    isActive
                                                        ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200'
                                                        : 'text-slate-700 dark:text-slate-200'
                                                }`}
                                            >
                                                <span className="min-w-0 truncate" title={label}>{label}</span>
                                                {isSelected ? <Check size={16} className="shrink-0 text-blue-600" /> : null}
                                            </div>
                                        );
                                    }) : (
                                        <div className="px-3 py-4 text-sm font-medium text-slate-500">
                                            {language === 'en' ? 'No matching customers' : language === 'vi' ? 'Không tìm thấy khách hàng' : '未找到匹配客户'}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
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
                            min={1}
                            max={365}
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-800"
                            value={formData.paymentTermsDays}
                            onChange={(event) => updateOrderHeader('paymentTermsDays', Math.min(365, Math.max(1, Number(event.target.value) || 1)))}
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
                                className={`min-h-11 rounded-xl px-4 py-3 text-sm font-black transition ${
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
                                className={`min-h-11 rounded-xl px-4 py-3 text-sm font-black transition ${
                                    !formData.taxInclusive
                                        ? 'bg-slate-900 text-white shadow-lg dark:bg-white dark:text-slate-900'
                                        : 'border border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                }`}
                            >
                                {t.taxExclusive || '未税'}
                            </button>
                        </div>
                    </div>

                    <div className="space-y-3 lg:col-span-2">
                        <SectionLabel
                            icon={<FileText size={14} />}
                            title={t.linkContractTitle || '关联合同'}
                            hint={t.orderHeaderContractHint || '合同挂在订单头，防止明细层重复挂载。'}
                        />
                        <select
                            data-testid="sales-order-contract-select"
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-800"
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

                    <div className="space-y-3 lg:col-span-2 xl:col-span-4">
                        <SectionLabel
                            icon={<FileText size={14} />}
                            title={t.notes || '订单备注'}
                            hint={t.orderHeaderNotesHint || '跟客户约定、发运提醒、结算备注都放在订单头。'}
                        />
                        <textarea
                            data-testid="sales-order-notes"
                            value={formData.notes}
                            onChange={(event) => updateOrderHeader('notes', event.target.value)}
                            aria-invalid={notesOverLimit}
                            aria-describedby="sales-order-notes-count"
                            placeholder={t.orderNotesPlaceholder || '填写这张订单的业务说明、交付要求、结算备注...'}
                            className={`h-24 w-full resize-y rounded-xl border bg-slate-50 px-4 py-3 text-sm font-medium outline-none transition dark:bg-slate-800 ${
                                notesOverLimit
                                    ? 'border-red-500 focus:border-red-600 focus:ring-2 focus:ring-red-100 dark:border-red-500'
                                    : 'border-slate-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-slate-700'
                            }`}
                        />
                        <div id="sales-order-notes-count" className={`text-right text-xs font-medium ${notesOverLimit ? 'text-red-600' : 'text-slate-500'}`}>
                            {notesOverLimit ? `已超出 ${formData.notes.length - notesLimit} 个字符，保存前请精简。` : `${formData.notes.length}/${notesLimit}`}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SalesOrderHeaderForm;
