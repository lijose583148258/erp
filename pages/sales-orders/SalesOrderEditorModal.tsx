import React from 'react';
import { Box, Calculator, ChevronDown, FileCheck, RefreshCw, Scan, X } from 'lucide-react';
import { DocumentInputGuide } from '../../components/ui/DocumentInputGuide';
import SmartFormFill from '../../components/SmartFormFill';
import { DocumentType, OcrDocumentData } from '../../services/smartFormService';
import { Customer } from '../../types';
import SalesOrderHeaderForm from './SalesOrderHeaderForm';
import SalesOrderLineGrid from './SalesOrderLineGrid';
import type { SalesOrderFormData } from './useSalesOrders';
import type { SalesOrderLineErrors } from './salesOrderFormHelpers';

type Props = {
    isOpen: boolean;
    isEditMode: boolean;
    isOffline: boolean;
    draftAvailable: boolean;
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
        <div className="rounded-[28px] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
            <div className="mb-4 flex items-center justify-between">
                <div>
                    <h3 className={`text-sm font-black uppercase tracking-[0.18em] ${toneClass}`}>{title}</h3>
                    <p className="mt-2 text-[11px] font-medium text-slate-400">{hint}</p>
                </div>
                {icon}
            </div>
            <div className="space-y-3">
                {items.map((item, index) => (
                    <div key={`${item.title}-${index}`} className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
                        <div>
                            <div className="text-sm font-black text-slate-800 dark:text-slate-100">{item.title}</div>
                            <div className="mt-1 text-[10px] font-bold text-slate-400">{item.subtitle}</div>
                        </div>
                        {item.action ? (
                            <button onClick={item.action} className="rounded-xl bg-slate-900 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-white dark:bg-white dark:text-slate-900">
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

    React.useEffect(() => {
        if (isOpen) {
            setIsAssistOpen(false);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const offlineScanCount = (() => {
        try {
            return JSON.parse(localStorage.getItem('offline_scans') || '[]').length;
        } catch {
            return 0;
        }
    })();
    const assistBadges = [
        isOffline ? (t.offlineMode || '离线模式') : null,
        draftAvailable ? (t.draftDetected || '检测到草稿') : null,
        offlineScanCount > 0 ? `${t.offlineScans || '离线扫描'} ${offlineScanCount}` : null,
    ].filter((badge): badge is string => Boolean(badge));
    const guideCopy = language === 'en'
        ? {
            eyebrow: 'SALES ORDER ENTRY',
            title: 'Create the order header first, then enter item lines like a spreadsheet',
            description: 'Sales orders are parent documents. Customer, terms, contract and notes stay in the header; products, quantity, price, tax and discount stay in the line grid. Payments and shipments are follow-up actions, not mixed into order creation.',
            steps: [
                { title: 'Select customer', description: 'Pick one customer and confirm terms, tax mode, contract and notes.', badge: 'Header' },
                { title: 'Enter lines', description: 'Add or paste product lines with quantity, unit, price, discount and tax.', badge: 'Grid' },
                { title: 'Review impact', description: 'Check totals, price suggestions and inventory insights before saving.', badge: 'Preview' },
                { title: 'Read back', description: 'After saving, return to the order ledger and verify customer, amount and payment status.', badge: 'Evidence' },
            ],
            boundaries: [
                { title: 'This window handles', items: ['Order header', 'Item lines', 'Draft/offline entry', 'OCR assisted fill'] },
                { title: 'Handled elsewhere', items: ['Payment verification', 'Shipment execution', 'Inventory transfer', 'Customer ownership'] },
            ],
            evidence: ['Order number', 'Customer name', 'Line count', 'Grand total', 'Payment status'],
        }
        : language === 'vi'
            ? {
                eyebrow: 'NHAP DON BAN HANG',
                title: 'Tao dau don truoc, sau do nhap chi tiet hang hoa nhu bang tinh',
                description: 'Don ban hang la chung tu cha. Khach hang, dieu khoan, hop dong va ghi chu nam o dau don; hang hoa, so luong, don gia, thue va chiet khau nam o bang chi tiet. Thu tien va giao hang la thao tac tiep theo, khong tron vao luc tao don.',
                steps: [
                    { title: 'Chon khach hang', description: 'Chon mot khach hang va xac nhan cong no, thue, hop dong, ghi chu.', badge: 'Dau don' },
                    { title: 'Nhap chi tiet', description: 'Them hoac dan nhieu dong hang hoa voi so luong, don vi, gia, chiet khau, thue.', badge: 'Bang' },
                    { title: 'Kiem tra tac dong', description: 'Xem tong tien, goi y gia va ton kho truoc khi luu.', badge: 'Xem truoc' },
                    { title: 'Doc lai ket qua', description: 'Sau khi luu, quay ve so don hang de doi chieu khach hang, so tien va trang thai thanh toan.', badge: 'Bang chung' },
                ],
                boundaries: [
                    { title: 'Cua so nay phu trach', items: ['Dau don', 'Dong hang hoa', 'Ban nhap/offline', 'OCR ho tro'] },
                    { title: 'De module khac xu ly', items: ['Xac minh thu tien', 'Giao hang', 'Dieu chuyen ton kho', 'Quyen so huu khach'] },
                ],
                evidence: ['So don', 'Ten khach', 'So dong', 'Tong tien', 'Trang thai thu tien'],
            }
            : {
                eyebrow: '销售开单顺序',
                title: '先建订单头，再像 Excel 一样录商品明细',
                description: '销售订单是父单据。客户、账期、合同、备注放订单头；商品、数量、单位、单价、折扣、税额放明细网格。回款核验和发货执行是后续动作，不混进开单录入区。',
                steps: [
                    { title: '选择客户', description: '只在订单头选择一次客户，并确认账期、税务模式、合同和备注。', badge: '单头' },
                    { title: '录入明细', description: '逐行新增或粘贴商品、数量、单位、单价、折扣、税额。', badge: '网格' },
                    { title: '检查影响', description: '保存前看金额汇总、价格建议和库存洞察，避免漏填或超卖。', badge: '预览' },
                    { title: '保存回读', description: '保存后回到订单台账，核对客户、金额、明细行数和回款状态。', badge: '证据' },
                ],
                boundaries: [
                    { title: '本窗口负责', items: ['订单头', '商品明细', '草稿/离线录入', 'OCR 辅助填单'] },
                    { title: '不要在这里处理', items: ['财务核验', '发货执行', '库存调拨', '客户归属调整'] },
                ],
                evidence: ['订单号', '客户名', '明细行数', '订单总额', '回款状态'],
            };

    return (
        <div data-testid="sales-order-editor-modal" className="fixed inset-0 z-[120] flex justify-end bg-slate-950/60 backdrop-blur-md animate-in fade-in duration-300">
            <div className="flex h-full w-full max-w-[96vw] flex-col bg-slate-50 shadow-2xl animate-in slide-in-from-right duration-500 dark:bg-slate-950">
                <div className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/95 px-8 py-6 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
                    <div>
                        <div className="text-[11px] font-black text-blue-600">{language === 'en' ? 'Sales Order Workspace' : language === 'vi' ? 'Không gian đơn bán hàng' : '销售订单工作台'}</div>
                        <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-900 dark:text-white">
                            {isEditMode ? (t.editOrder || '编辑订单') : (t.newOrder || '新建订单')}
                        </h2>
                        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{t.salesOrderDualTrackHint || '订单头走表单，订单明细走网格，减少混输和回读脱钩。'}</p>
                    </div>
                    <button onClick={onClose} className="rounded-full bg-slate-100 p-4 text-slate-500 transition hover:rotate-90 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200">
                        <X size={24} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-8 py-8 custom-scrollbar">
                    <div className="space-y-6">
                        <DocumentInputGuide
                            testId="sales-order-input-guide"
                            eyebrow={guideCopy.eyebrow}
                            title={guideCopy.title}
                            description={guideCopy.description}
                            steps={guideCopy.steps}
                            boundaries={guideCopy.boundaries}
                            evidence={guideCopy.evidence}
                            tone="blue"
                        />

                        <div className="grid gap-6 xl:grid-cols-[360px,minmax(0,1fr)]">
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
                                                placeholder={t.ocrPlaceholder || '粘贴识别文本或手工录入 OCR 内容'}
                                                className="mt-4 h-28 w-full rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-medium outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-800"
                                            />
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
                            <button onClick={onClose} className="rounded-[18px] bg-slate-200 px-5 py-3 text-xs font-black uppercase tracking-[0.16em] text-slate-700 transition hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
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
