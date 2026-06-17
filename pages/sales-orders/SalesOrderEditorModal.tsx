import React from 'react';
import { Box, Calculator, ChevronDown, FileCheck, RefreshCw, Scan, X } from 'lucide-react';
import SmartFormFill from '../../components/SmartFormFill';
import { DocumentType, OcrDocumentData } from '../../services/smartFormService';
import { Customer } from '../../types';
import SalesOrderHeaderForm from './SalesOrderHeaderForm';
import SalesOrderLineGrid from './SalesOrderLineGrid';
import type { SalesOrderFormData } from './useSalesOrders';
import type { SalesOrderLineErrors } from './salesOrderFormHelpers';
import { useUnsavedForm } from '../../app/useUnsavedForm';
import { useDialogFocus } from '../../app/useDialogFocus';

type Props = {
    isOpen: boolean;
    isEditMode: boolean;
    isOffline: boolean;
    draftAvailable: boolean;
    userId: string;
    language: 'zh' | 'en' | 'vi';
    t: Record<string, string>;
    customers: Customer[];
    contracts: any[];
    formData: SalesOrderFormData;
    ocrDocType: DocumentType;
    setOcrDocType: React.Dispatch<React.SetStateAction<DocumentType>>;
    ocrText: string;
    setOcrText: React.Dispatch<React.SetStateAction<string>>;
    ocrResult: OcrDocumentData | null;
    handleSmartFill: (data: any) => void;
    handleOcrParse: () => void;
    handleApplyOcr: () => void;
    handleProductScan: (e: React.ChangeEvent<HTMLInputElement>) => void;
    syncOfflineData: () => void;
    loadDraft: () => void;
    clearDraft: () => void;
    onClose: () => void;
    onSave: () => void;
    totals: { subtotal?: number; totalDiscount: number; totalTax: number; grandTotal: number; estComm: number; totalCBM: number; totalWeight: number };
    formatPrice: (amount: number) => string;
    priceSuggestions: Array<{ productName: string; recommended: number; floor: number; ceiling: number; variance: number; apply: () => void }>;
    inventoryInsights: Array<{ productName: string; available: number; shortage: number; batches: number; status: string }>;
    isScanning: boolean;
    updateOrderHeader: <K extends keyof SalesOrderFormData>(field: K, value: SalesOrderFormData[K]) => void;
    updateOrderItem: (index: number, patch: Partial<any>) => void;
    addOrderItem: (seed?: Partial<any>) => void;
    duplicateOrderItem: (index: number) => void;
    removeOrderItem: (index: number) => void;
    importOrderItemsFromGrid: (rawText: string) => void;
    orderLineErrors: SalesOrderLineErrors;
};

const MetricPanel: React.FC<{
    title: string;
    hint: string;
    tone: 'indigo' | 'emerald';
    items: Array<{ title: string; subtitle: string; action?: () => void; actionLabel?: string }>;
}> = ({ title, hint, tone, items }) => {
    const toneClass = tone === 'indigo' ? 'text-indigo-600' : 'text-emerald-600';
    const icon = tone === 'indigo' ? <Calculator size={18} className="text-indigo-500" /> : <Box size={18} className="text-emerald-500" />;

    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
            <div className="mb-4 flex items-center justify-between">
                <div>
                    <h3 className={`text-sm font-black uppercase tracking-[0.18em] ${toneClass}`}>{title}</h3>
                    <p className="mt-1.5 text-xs font-medium text-slate-500">{hint}</p>
                </div>
                {icon}
            </div>
            <div className="space-y-3">
                {items.map((item, index) => (
                    <div key={`${item.title}-${index}`} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
                        <div className="min-w-0">
                            <div className="truncate text-sm font-black text-slate-800 dark:text-slate-100" title={item.title}>{item.title}</div>
                            <div className="mt-1 truncate text-xs font-bold text-slate-500" title={item.subtitle}>{item.subtitle}</div>
                        </div>
                        {item.action ? (
                            <button onClick={item.action} className="min-h-11 shrink-0 rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white dark:bg-white dark:text-slate-900">
                                {item.actionLabel || '应用'}
                            </button>
                        ) : null}
                    </div>
                ))}
            </div>
        </div>
    );
};

const SalesOrderEditorModal: React.FC<Props> = ({
    isOpen,
    isEditMode,
    isOffline,
    draftAvailable,
    userId,
    language,
    t,
    customers,
    contracts,
    formData,
    ocrDocType,
    setOcrDocType,
    ocrText,
    setOcrText,
    ocrResult,
    handleSmartFill,
    handleOcrParse,
    handleApplyOcr,
    handleProductScan,
    syncOfflineData,
    loadDraft,
    clearDraft,
    onClose,
    onSave,
    totals,
    formatPrice,
    priceSuggestions,
    inventoryInsights,
    isScanning,
    updateOrderHeader,
    updateOrderItem,
    addOrderItem,
    duplicateOrderItem,
    removeOrderItem,
    importOrderItemsFromGrid,
    orderLineErrors,
}) => {
    const [isAssistOpen, setIsAssistOpen] = React.useState(false);
    const dialogRef = React.useRef<HTMLDivElement>(null);
    const { requestClose } = useUnsavedForm({
        sourceId: 'sales-order-editor',
        label: isEditMode ? '销售订单编辑' : '新建销售订单',
        open: isOpen,
        value: formData,
    });
    const handleClose = React.useCallback(() => requestClose(onClose), [onClose, requestClose]);
    useDialogFocus(isOpen, dialogRef, handleClose);

    React.useEffect(() => {
        if (isOpen) {
            setIsAssistOpen(isOffline || draftAvailable);
        }
    }, [draftAvailable, isOffline, isOpen]);

    if (!isOpen) return null;

    const offlineScanCount = (() => {
        try {
            return JSON.parse(localStorage.getItem(`ailao.offlineScans.${userId || 'anonymous'}`) || '[]').length;
        } catch {
            return 0;
        }
    })();
    const assistBadges = [
        isOffline ? (t.offlineMode || '离线模式') : null,
        draftAvailable ? (t.draftDetected || '检测到草稿') : null,
        offlineScanCount > 0 ? `${t.offlineScans || '离线扫描'} ${offlineScanCount}` : null,
    ].filter((badge): badge is string => Boolean(badge));
    return (
        <div data-testid="sales-order-editor-modal" className="fixed inset-0 z-[120] flex justify-end bg-slate-950/60 backdrop-blur-md animate-in fade-in duration-300">
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="sales-order-editor-title"
                tabIndex={-1}
                className="flex h-full w-full max-w-[98vw] flex-col bg-slate-50 shadow-2xl animate-in slide-in-from-right duration-500 dark:bg-slate-950"
            >
                <div className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-4 backdrop-blur sm:px-6 dark:border-slate-800 dark:bg-slate-900/95">
                    <div>
                        <div className="text-[11px] font-black text-blue-600">{language === 'en' ? 'Sales Order Workspace' : language === 'vi' ? 'Không gian đơn bán hàng' : '销售订单工作台'}</div>
                        <h2 id="sales-order-editor-title" className="mt-1 text-2xl font-black tracking-tight text-slate-900 dark:text-white">
                            {isEditMode ? (t.editOrder || '编辑订单') : (t.newOrder || '新建订单')}
                        </h2>
                        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{t.salesOrderDualTrackHint || '订单头走表单，订单明细走网格，减少混输和回读脱钩。'}</p>
                    </div>
                    <button aria-label={t.close || '关闭'} data-testid="sales-order-editor-close" onClick={handleClose} className="min-h-11 min-w-11 rounded-xl bg-slate-100 p-2.5 text-slate-600 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200">
                        <X size={24} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-3 py-4 custom-scrollbar sm:px-5 sm:py-5">
                    <div className="space-y-6">
                        <div className="space-y-6">
                            <div className="space-y-6">
                                <SalesOrderHeaderForm
                                    language={language}
                                    t={t}
                                    customers={customers}
                                    contracts={contracts}
                                    formData={formData}
                                    isEditMode={isEditMode}
                                    updateOrderHeader={updateOrderHeader}
                                    formatPrice={formatPrice}
                                />

                                <div className="rounded-[28px] border border-slate-100 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
                                    <button
                                        type="button"
                                        onClick={() => setIsAssistOpen((value) => !value)}
                                        aria-expanded={isAssistOpen}
                                        className="flex w-full items-center justify-between gap-4 rounded-[28px] px-6 py-5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/40"
                                    >
                                        <div className="min-w-0">
                                            <div className="text-sm font-black uppercase tracking-[0.18em] text-slate-700 dark:text-slate-200">{t.assistiveEntryTitle || '辅助录入'}</div>
                                            <p className="mt-2 text-[11px] font-medium text-slate-400">{t.assistiveEntryHint || '智能填单、OCR 和离线草稿收在这里，不打断订单头与明细录入。'}</p>
                                            {assistBadges.length > 0 && (
                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    {assistBadges.map((badge) => (
                                                        <span key={badge} className="rounded-full bg-amber-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
                                                            {badge}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        <ChevronDown size={20} className={`shrink-0 text-slate-400 transition-transform ${isAssistOpen ? 'rotate-180' : ''}`} />
                                    </button>

                                    <div className={isAssistOpen ? 'space-y-4 border-t border-slate-100 p-6 dark:border-slate-800' : 'hidden'}>
                                        {(isOffline || draftAvailable) && (
                                            <div className="flex flex-wrap items-center justify-between gap-4 rounded-[28px] border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
                                                <div>
                                                    <div className="text-xs font-black uppercase tracking-[0.18em] text-amber-700 dark:text-amber-200">
                                                        {isOffline ? (t.offlineMode || '离线模式') : (t.draftDetected || '检测到草稿')}
                                                    </div>
                                                    <p className="mt-1 text-xs font-medium text-amber-700/80 dark:text-amber-100/80">
                                                        {isOffline ? (t.offlineHint || '当前仍可录入，联网后再同步。') : (t.draftHint || '发现本地草稿，可以继续恢复或清空。')}
                                                    </p>
                                                </div>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    {draftAvailable && (
                                                        <>
                                                            <button onClick={loadDraft} className="rounded-[18px] bg-amber-600 px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-white">
                                                                {t.loadDraft || '载入草稿'}
                                                            </button>
                                                            <button onClick={clearDraft} className="rounded-[18px] border border-amber-200 bg-white px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-amber-700 dark:bg-slate-800 dark:text-amber-200">
                                                                {t.clearDraft || '清空草稿'}
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        <div className="rounded-[28px] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
                                            <div className="mb-4">
                                                <h3 className="text-sm font-black uppercase tracking-[0.18em] text-slate-700 dark:text-slate-200">{t.smartFillTitle || '智能填单'}</h3>
                                                <p className="mt-2 text-[11px] font-medium text-slate-400">{t.smartFillHint || '先识别客户和基础信息，再进入订单头表单。'}</p>
                                            </div>
                                            <SmartFormFill
                                                onFill={handleSmartFill}
                                                customers={customers.map((customer) => ({
                                                    id: customer.id,
                                                    name: customer.name,
                                                    nameZh: customer.nameZh,
                                                    nameEn: customer.nameEn,
                                                    nameVi: customer.nameVi,
                                                    displayName: customer.displayName,
                                                }))}
                                            />
                                        </div>

                                        <div className="rounded-[28px] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
                                            <div className="mb-4 flex items-start justify-between gap-3">
                                                <div>
                                                    <h3 className="text-sm font-black uppercase tracking-[0.18em] text-slate-700 dark:text-slate-200">{t.ocrCenter || 'OCR 中心'}</h3>
                                                    <p className="mt-2 text-[11px] font-medium text-slate-400">{t.ocrHint || '发票、发运单先识别，再决定是否回填订单。'}</p>
                                                </div>
                                                <label className="inline-flex cursor-pointer items-center rounded-[18px] bg-indigo-50 px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-indigo-600 transition hover:bg-indigo-100 dark:bg-indigo-950/30 dark:text-indigo-200">
                                                    {isScanning ? <RefreshCw size={14} className="mr-2 animate-spin" /> : <Scan size={14} className="mr-2" />}
                                                    {t.smartScan || '智能扫描'}
                                                    <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleProductScan} disabled={isScanning} />
                                                </label>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-3">
                                                <select value={ocrDocType} onChange={(event) => setOcrDocType(event.target.value as DocumentType)} className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-black outline-none dark:border-slate-700 dark:bg-slate-800">
                                                    <option value="invoice">{t.ocrInvoice || '发票'}</option>
                                                    <option value="shipment">{t.ocrShipment || '发运单'}</option>
                                                </select>
                                                {offlineScanCount > 0 && (
                                                    <button onClick={syncOfflineData} className="inline-flex items-center rounded-[18px] bg-amber-50 px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-amber-600 transition hover:bg-amber-100 dark:bg-amber-950/20 dark:text-amber-200">
                                                        <FileCheck size={14} className="mr-2" />
                                                        {offlineScanCount}
                                                    </button>
                                                )}
                                            </div>
                                            <textarea
                                                value={ocrText}
                                                onChange={(event) => setOcrText(event.target.value)}
                                                aria-invalid={ocrText.length > 10000}
                                                aria-describedby="sales-order-ocr-count"
                                                placeholder={t.ocrPlaceholder || '粘贴识别文本或手工录入 OCR 内容'}
                                                className={`mt-4 h-28 w-full resize-y rounded-xl border bg-slate-50 px-4 py-3 text-sm font-medium outline-none transition dark:bg-slate-800 ${
                                                    ocrText.length > 10000
                                                        ? 'border-red-500 focus:border-red-600 focus:ring-2 focus:ring-red-100 dark:border-red-500'
                                                        : 'border-slate-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-slate-700'
                                                }`}
                                            />
                                            <div id="sales-order-ocr-count" className={`mt-1 text-right text-xs font-medium ${ocrText.length > 10000 ? 'text-red-600' : 'text-slate-500'}`}>
                                                {ocrText.length > 10000 ? `已超出 ${ocrText.length - 10000} 个字符` : `${ocrText.length}/10000`}
                                            </div>
                                            <div className="mt-4 flex flex-wrap gap-2">
                                                <button onClick={handleOcrParse} className="rounded-[18px] bg-blue-600 px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-white">
                                                    {t.ocrParse || '解析'}
                                                </button>
                                                {ocrResult && (
                                                    <button onClick={handleApplyOcr} className="rounded-[18px] bg-emerald-500 px-4 py-2 text-[11px] font-black uppercase tracking-[0.16em] text-white">
                                                        {t.ocrApply || '回填'}
                                                    </button>
                                                )}
                                            </div>
                                            {ocrResult && (
                                                <div className="mt-4 grid gap-3 rounded-[20px] bg-slate-50 p-4 text-xs font-bold text-slate-600 dark:bg-slate-800/60 dark:text-slate-200">
                                                    <div>{t.customerName || '客户'}: {ocrResult.customerName || (t.ocrNotFound || '未识别')}</div>
                                                    <div>{t.productName || '产品'}: {ocrResult.productName || (t.ocrNotFound || '未识别')}</div>
                                                    <div>{t.amount || '金额'}: {ocrResult.totalAmount ? formatPrice(ocrResult.totalAmount) : (t.ocrNotFound || '未识别')}</div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-6">
                                <SalesOrderLineGrid
                                    t={t}
                                    formData={formData}
                                    updateOrderItem={updateOrderItem}
                                    addOrderItem={addOrderItem}
                                    duplicateOrderItem={duplicateOrderItem}
                                    removeOrderItem={removeOrderItem}
                                    importOrderItemsFromGrid={importOrderItemsFromGrid}
                                    formatPrice={formatPrice}
                                    totals={totals}
                                    lineErrors={orderLineErrors}
                                />

                                <div className="grid gap-6 xl:grid-cols-2">
                                    <MetricPanel
                                        title={t.priceEngineTitle || '价格建议'}
                                        hint={t.priceEngineHint || '按账期和数量给业务一个可参考的报价带。'}
                                        tone="indigo"
                                        items={priceSuggestions.map((suggestion) => ({
                                            title: suggestion.productName,
                                            subtitle: `${suggestion.floor} - ${suggestion.ceiling}`,
                                            action: suggestion.apply,
                                            actionLabel: t.apply || '应用',
                                        }))}
                                    />
                                    <MetricPanel
                                        title={t.inventoryInsightTitle || '库存洞察'}
                                        hint={t.inventoryInsightHint || '录单时同步看可用量、缺口和批次数。'}
                                        tone="emerald"
                                        items={inventoryInsights.map((insight) => ({
                                            title: insight.productName,
                                            subtitle: `Available ${insight.available} / Shortage ${insight.shortage} / Batches ${insight.batches}`,
                                        }))}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end gap-3">
                            <button data-testid="sales-order-editor-cancel" onClick={handleClose} className="rounded-[18px] bg-slate-200 px-5 py-3 text-xs font-black uppercase tracking-[0.16em] text-slate-700 transition hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
                                {t.cancel || '取消'}
                            </button>
                            <button data-testid="sales-order-save-button" onClick={onSave} className="rounded-[18px] bg-blue-600 px-6 py-3 text-xs font-black uppercase tracking-[0.16em] text-white shadow-lg transition hover:bg-blue-700">
                                {t.save || '保存订单'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SalesOrderEditorModal;
