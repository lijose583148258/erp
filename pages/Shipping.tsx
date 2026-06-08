import React from 'react';
import { AlertTriangle, BookOpen, Camera, CheckCircle2, ClipboardList, FileText, PackageCheck, Recycle, Truck } from 'lucide-react';
import { adaptDataTableColumns, EnterpriseDataGrid, FormField, StatusBadge } from '../components/ui';
import { WorkspaceTaskNavigator, type WorkspaceTaskNavigatorItem } from '../components/ui/WorkspaceTaskNavigator';
import type { Shipment } from '../types';
import { buildShipmentColumns } from './shipping/ShippingColumns';
import ShippingOcrPanel from './shipping/ShippingOcrPanel';
import ShippingLogisticsPanel from './shipping/ShippingLogisticsPanel';
import ShippingAssetModal from './shipping/ShippingAssetModal';
import ShippingAssetsPanel from './shipping/ShippingAssetsPanel';
import { useShipping } from './shipping/useShipping';

type ShippingDeskTab = 'logistics' | 'receipts' | 'ocr' | 'assets' | 'principle';

const Shipping = () => {
    const state = useShipping();
    const [activeDesk, setActiveDesk] = React.useState<ShippingDeskTab>('logistics');

    const shippingDeskCopy = React.useMemo(() => {
        if (state.language === 'en') {
            return {
                eyebrow: 'Shipment workflow',
                title: 'One task, one work area',
                description: 'Separate tracking, receiving proof, OCR import, and reusable asset flow so logistics facts do not compete for one input area.',
                logistics: { title: 'Logistics tracking', subtitle: 'Route, status, MSDS', purpose: 'Monitor shipments, dispatch status, cold-chain risk, and live logistics list.' },
                receipts: { title: 'POD receiving', subtitle: 'Partial receipt ledger', purpose: 'Open receipt batches from shipment rows and record accepted/rejected quantity.' },
                ocr: { title: 'OCR import', subtitle: 'Document-assisted entry', purpose: 'Extract shipment facts from images or text, then create a shipment after review.' },
                assets: { title: 'Reusable assets', subtitle: 'IBC, pallets, drums', purpose: 'Track customer-held containers and return movements separately from shipments.' },
                principle: { title: 'Boundary rules', subtitle: 'Avoid mixed entries', purpose: 'Clarify what belongs to logistics, POD, OCR, assets, and discrepancy handling.' },
                receiptGuideTitle: 'POD is a shipment-row action',
                receiptGuideBody: 'Find the shipment first, then open receipt batches from the row action. Each partial receipt remains tied to the original shipment.',
                sequenceEyebrow: 'Recommended order',
                sequenceTitle: 'Complete the shipment in five checkpoints',
                sequenceDescription: 'Start with the shipment row, then capture package and receipt facts, add POD/OCR evidence, handle discrepancies, and verify the saved readback.',
                sequenceSteps: [
                    ['Shipment order', 'Confirm customer, product, batch, quantity, route, carrier, tracking number, MSDS, and dispatch status.'],
                    ['Package / receipt detail', 'Open the receipt ledger from the shipment row and record this batch quantity, accepted quantity, rejected quantity, package note, and signer proof.'],
                    ['POD / OCR', 'Use OCR only to assist entry. POD file upload is proof; OCR text is not a delivery confirmation by itself.'],
                    ['Discrepancy entry', 'If rejected quantity is greater than zero, keep the reason here and follow the generated discrepancy case in the discrepancy workbench.'],
                    ['Save readback', 'After saving, re-check summary totals, latest receipt row, POD link, shipment status, and discrepancy case number before leaving.'],
                ],
                receiptEvidenceTitle: 'Saved readback evidence',
                receiptEvidenceEmpty: 'Open a shipment row to load receipt batches. After saving, this area should show updated totals, latest receipt, POD link, and discrepancy case evidence.',
                receiptEvidenceItems: ['Summary totals refreshed', 'Latest receipt row returned', 'POD link visible when uploaded', 'Discrepancy case returned when abnormal', 'Shipment row status synced'],
                principleCards: [
                    ['OCR is only an entry assistant', 'OCR can create a draft shipment after review, but it is not proof of delivery.'],
                    ['POD batches are not status labels', 'Each receipt batch records quantity, accepted/rejected amount, evidence, and notes.'],
                    ['Reusable assets are a separate ledger', 'IBC, pallets, and drums should not be mixed into shipment status updates.'],
                ],
            };
        }
        if (state.language === 'vi') {
            return {
                eyebrow: 'Luồng giao hàng',
                title: 'Mỗi nhiệm vụ một khu vực',
                description: 'Tách theo dõi vận chuyển, ký nhận, OCR và tài sản quay vòng để người dùng biết cần nhập dữ liệu ở đâu.',
                logistics: { title: 'Theo dõi vận chuyển', subtitle: 'Tuyến, trạng thái, MSDS', purpose: 'Theo dõi lô hàng, trạng thái giao, rủi ro chuỗi lạnh và danh sách vận chuyển.' },
                receipts: { title: 'Ký nhận POD', subtitle: 'Sổ nhận từng đợt', purpose: 'Mở lô ký nhận từ dòng vận chuyển và ghi số đạt/chênh lệch.' },
                ocr: { title: 'Nhập bằng OCR', subtitle: 'Hỗ trợ từ chứng từ', purpose: 'Trích xuất thông tin từ ảnh hoặc văn bản, sau đó tạo vận chuyển sau khi kiểm tra.' },
                assets: { title: 'Tài sản quay vòng', subtitle: 'IBC, pallet, thùng', purpose: 'Theo dõi bao bì khách đang giữ và các lần hoàn trả riêng với vận chuyển.' },
                principle: { title: 'Quy tắc ranh giới', subtitle: 'Không trộn vùng nhập', purpose: 'Phân biệt phần thuộc logistics, POD, OCR, tài sản và xử lý chênh lệch.' },
                receiptGuideTitle: 'POD là thao tác trên dòng vận chuyển',
                receiptGuideBody: 'Tìm lô vận chuyển trước, sau đó mở lô ký nhận từ thao tác của dòng. Mỗi lần nhận từng phần vẫn gắn đúng vận chuyển gốc.',
                sequenceEyebrow: 'Thứ tự đề xuất',
                sequenceTitle: 'Hoàn tất vận chuyển qua năm điểm kiểm tra',
                sequenceDescription: 'Bắt đầu từ dòng vận chuyển, sau đó ghi bao bì/ký nhận, bổ sung POD/OCR, xử lý chênh lệch và kiểm tra dữ liệu đọc lại sau lưu.',
                sequenceSteps: [
                    ['Phiếu giao hàng', 'Kiểm tra khách hàng, hàng hóa, lô, số lượng, tuyến, đơn vị vận chuyển, mã theo dõi, MSDS và trạng thái giao.'],
                    ['Bao bì / ký nhận', 'Mở sổ ký nhận từ dòng vận chuyển và ghi số lượng đợt này, số đạt, số lệch, ghi chú bao bì và chứng từ người ký.'],
                    ['POD / OCR', 'OCR chỉ hỗ trợ nhập liệu. File POD mới là bằng chứng; văn bản OCR không tự thay thế xác nhận giao hàng.'],
                    ['Lối vào chênh lệch', 'Nếu số lệch lớn hơn 0, giữ lý do tại đây và theo dõi phiếu chênh lệch được tạo trong workbench.'],
                    ['Lưu và đọc lại', 'Sau khi lưu, kiểm tra tổng hợp, dòng ký nhận mới nhất, link POD, trạng thái vận chuyển và mã chênh lệch trước khi rời trang.'],
                ],
                receiptEvidenceTitle: 'Bằng chứng đọc lại sau lưu',
                receiptEvidenceEmpty: 'Mở một dòng vận chuyển để tải lô ký nhận. Sau khi lưu, khu vực này cần hiển thị tổng mới, dòng ký nhận mới, link POD và phiếu chênh lệch nếu có.',
                receiptEvidenceItems: ['Tổng hợp đã cập nhật', 'Dòng ký nhận mới trả về', 'Có link POD khi tải file', 'Có phiếu chênh lệch khi bất thường', 'Dòng vận chuyển đã đồng bộ'],
                principleCards: [
                    ['OCR chỉ hỗ trợ nhập liệu', 'OCR có thể tạo vận chuyển sau khi kiểm tra, nhưng không phải bằng chứng ký nhận.'],
                    ['Lô POD không chỉ là trạng thái', 'Mỗi lô ký nhận ghi số lượng, đạt/chênh lệch, chứng từ và ghi chú.'],
                    ['Tài sản quay vòng có sổ riêng', 'IBC, pallet và thùng không nên trộn vào cập nhật trạng thái vận chuyển.'],
                ],
            };
        }
        return {
            eyebrow: '发货职责分流',
            title: '发货物流不是一个大杂烩',
            description: '把物流跟踪、签收批次、OCR 导入、周转资产分开表达，用户先选任务再输入，避免所有信息挤在一个区域里抢职责。',
            logistics: { title: '物流跟踪', subtitle: '路线、状态、MSDS', purpose: '查看发货单、在途状态、冷链风险和物流列表。' },
            receipts: { title: '签收动作', subtitle: '分批签收台账', purpose: '从发货行打开签收批次，记录正常/异常数量和凭证。' },
            ocr: { title: 'OCR 导入', subtitle: '凭证辅助录入', purpose: '从图片或文本识别发运信息，人工确认后再生成发货记录。' },
            assets: { title: '周转资产', subtitle: 'IBC、托盘、桶', purpose: '单独记录客户占用和归还，不和发货状态混在一起。' },
            principle: { title: '边界规则', subtitle: '避免混合输入', purpose: '说明物流、签收、OCR、资产、差异处理分别负责什么。' },
            receiptGuideTitle: '签收是发货行上的动作',
            receiptGuideBody: '先在发货列表里定位发货记录，再从行操作打开“签收批次”。每次分批签收都挂在原发货单下面，不把签收事实写成普通状态备注。',
            sequenceEyebrow: '建议录入顺序',
            sequenceTitle: '按五个检查点完成发货闭环',
            sequenceDescription: '先确认发货单，再补包装/签收明细，随后处理 POD/OCR 与差异入口，最后用保存回读证据确认系统已经真正落账。',
            sequenceSteps: [
                ['发货单', '确认客户、商品、批号、数量、路线、承运商、跟踪号、MSDS 与发运状态。'],
                ['包装/签收明细', '从发货行打开签收批次，记录本次数量、正常数量、异常数量、包装说明和签收凭证。'],
                ['POD/OCR', 'OCR 只辅助录入；POD 文件才是签收凭证，不能把 OCR 文本当成真实签收。'],
                    ['异常线索入口', '异常数量大于 0 时，在这里保留原因，并回到专门异常工作台复核后续处理记录。'],
                ['保存回读', '保存后核对汇总数量、最新批次、POD 链接、发货状态和差异单号，再离开发货页。'],
            ],
            receiptEvidenceTitle: '保存后回读证据',
            receiptEvidenceEmpty: '打开一条发货记录后会加载签收批次。保存后这里应看到汇总数量刷新、最新批次回写、POD 链接和异常差异单证据。',
            receiptEvidenceItems: ['汇总数量已刷新', '最新签收批次已回写', '上传后可查看 POD 链接', '异常时返回差异单', '发货列表状态同步'],
            principleCards: [
                ['OCR 只是录入助手', 'OCR 可以辅助生成发货记录，但不能替代真实签收凭证。'],
                ['签收批次不是简单状态', '每个批次必须记录本次数量、正常数量、异常数量、凭证和备注。'],
                ['周转资产必须独立成账', 'IBC、托盘、桶等资产占用和归还，不应混在发货状态里。'],
            ],
        };
    }, [state.language]);

    const switchShippingDesk = React.useCallback((desk: ShippingDeskTab) => {
        setActiveDesk(desk);
        state.setActiveTab(desk === 'assets' ? 'assets' : 'logistics');
    }, [state.setActiveTab]);

    React.useEffect(() => {
        const openOcrDesk = () => switchShippingDesk('ocr');
        window.addEventListener('command:ocr-shipment', openOcrDesk);
        return () => window.removeEventListener('command:ocr-shipment', openOcrDesk);
    }, [switchShippingDesk]);

    const receiptActionCount = React.useMemo(
        () => state.shipments.filter(item => item.status !== 'pending').length,
        [state.shipments],
    );

    const shippingDeskItems = React.useMemo<WorkspaceTaskNavigatorItem<ShippingDeskTab>[]>(() => [
        {
            id: 'logistics',
            title: shippingDeskCopy.logistics.title,
            subtitle: shippingDeskCopy.logistics.subtitle,
            purpose: shippingDeskCopy.logistics.purpose,
            count: state.shipments.length,
            icon: Truck,
            testId: 'shipping-desk-logistics',
        },
        {
            id: 'receipts',
            title: shippingDeskCopy.receipts.title,
            subtitle: shippingDeskCopy.receipts.subtitle,
            purpose: shippingDeskCopy.receipts.purpose,
            count: receiptActionCount,
            icon: PackageCheck,
            testId: 'shipping-desk-receipts',
        },
        {
            id: 'ocr',
            title: shippingDeskCopy.ocr.title,
            subtitle: shippingDeskCopy.ocr.subtitle,
            purpose: shippingDeskCopy.ocr.purpose,
            count: state.ocrImages.length,
            icon: Camera,
            testId: 'shipping-desk-ocr',
        },
        {
            id: 'assets',
            title: shippingDeskCopy.assets.title,
            subtitle: shippingDeskCopy.assets.subtitle,
            purpose: shippingDeskCopy.assets.purpose,
            count: state.assetSummaries.length,
            icon: Recycle,
            testId: 'shipping-desk-assets',
        },
        {
            id: 'principle',
            title: shippingDeskCopy.principle.title,
            subtitle: shippingDeskCopy.principle.subtitle,
            purpose: shippingDeskCopy.principle.purpose,
            count: shippingDeskCopy.principleCards.length,
            icon: BookOpen,
            testId: 'shipping-desk-principle',
        },
    ], [receiptActionCount, shippingDeskCopy, state.assetSummaries.length, state.ocrImages.length, state.shipments.length]);

    const handleOpenReceiptEvents = React.useCallback((shipment: Shipment) => {
        switchShippingDesk('receipts');
        void state.handleOpenReceiptEvents(shipment);
    }, [state.handleOpenReceiptEvents, switchShippingDesk]);

    const latestReceipt = state.receiptBundle?.receipts?.[0] || null;
    const discrepancyCases = state.receiptBundle?.discrepancyCases || [];
    const primaryDiscrepancyCase = state.receiptBundle?.discrepancyCase || discrepancyCases[0] || null;

    const shipmentColumns = buildShipmentColumns(state.t, state.handleFileUpload, state.handleShipmentStatusUpdate, handleOpenReceiptEvents, state.canWriteShipping);

    return (
        <div className="space-y-6">
            <input data-testid="shipment-receipt-input" type="file" ref={state.fileInputRef} className="hidden" accept="image/*,application/pdf" onChange={state.onFileChange} />

            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 dark:text-white uppercase italic tracking-tighter">{state.t.shipping}</h1>
                    <p className="text-slate-500 font-medium tracking-tight text-sm mt-2">{state.t.allServiceRequests || 'Global Logistics Management System'}</p>
                </div>
            </div>

            <WorkspaceTaskNavigator
                eyebrow={shippingDeskCopy.eyebrow}
                title={shippingDeskCopy.title}
                description={shippingDeskCopy.description}
                items={shippingDeskItems}
                activeId={activeDesk}
                onChange={switchShippingDesk}
                columns="four"
            />

            <section data-testid="shipping-input-sequence-guide" className="rounded-[36px] border border-slate-100 bg-white/80 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950/60">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <p className="text-[11px] font-black uppercase tracking-[0.22em] text-blue-500">{shippingDeskCopy.sequenceEyebrow}</p>
                        <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950 dark:text-white">{shippingDeskCopy.sequenceTitle}</h2>
                        <p className="mt-2 max-w-4xl text-sm font-bold leading-6 text-slate-500 dark:text-slate-300">{shippingDeskCopy.sequenceDescription}</p>
                    </div>
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs font-black text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-200">
                        {shippingDeskCopy.receiptEvidenceItems.length} readback checks
                    </div>
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-5">
                    {shippingDeskCopy.sequenceSteps.map(([title, body], index) => (
                        <article key={title} className="rounded-[26px] border border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/40">
                            <div className="flex items-center justify-between">
                                <span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-slate-950 text-xs font-black text-white dark:bg-white dark:text-slate-950">{index + 1}</span>
                                {index === 3 ? <AlertTriangle size={16} className="text-amber-500" /> : index === 4 ? <CheckCircle2 size={16} className="text-emerald-500" /> : <FileText size={16} className="text-blue-500" />}
                            </div>
                            <h3 className="mt-4 text-sm font-black text-slate-950 dark:text-white">{title}</h3>
                            <p className="mt-2 text-xs font-bold leading-5 text-slate-500 dark:text-slate-300">{body}</p>
                        </article>
                    ))}
                </div>
            </section>

            {activeDesk === 'principle' && (
                <section data-testid="shipping-principle-panel" className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    {shippingDeskCopy.principleCards.map(([title, body]) => (
                        <article key={title} className="rounded-[30px] border border-slate-100 bg-white/80 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950/60">
                            <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300">
                                <BookOpen size={18} />
                            </div>
                            <h3 className="text-base font-black tracking-tight text-slate-950 dark:text-white">{title}</h3>
                            <p className="mt-3 text-sm font-bold leading-6 text-slate-500 dark:text-slate-400">{body}</p>
                        </article>
                    ))}
                </section>
            )}

            {activeDesk === 'ocr' && (
                <ShippingOcrPanel
                    t={state.t}
                    ocrText={state.ocrText}
                    setOcrText={state.setOcrText}
                    ocrImage={state.ocrImage}
                    ocrImages={state.ocrImages}
                    selectedImageIndex={state.selectedImageIndex}
                    previewMode={state.previewMode}
                    isOcrProcessing={state.isOcrProcessing}
                    ocrResult={state.ocrResult}
                    onImageUpload={state.handleOcrImageUpload}
                    onParse={state.handleOcrParse}
                    onApply={state.handleApplyOcr}
                    onRemoveImage={state.removeOcrImage}
                    onSelectImage={state.selectImage}
                    onClearAll={state.clearAllImages}
                    onTogglePreview={state.togglePreviewMode}
                    fileInputRef={state.ocrFileInputRef}
                />
            )}

            {activeDesk === 'receipts' && (
                <section data-testid="shipping-receipt-guidance" className="rounded-[32px] border border-indigo-100 bg-indigo-50/70 p-5 shadow-sm dark:border-indigo-900/40 dark:bg-indigo-950/20">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-indigo-600">{shippingDeskCopy.receipts.title}</p>
                            <h3 className="mt-2 text-xl font-black tracking-tight text-slate-950 dark:text-white">{shippingDeskCopy.receiptGuideTitle}</h3>
                            <p className="mt-2 max-w-4xl text-sm font-bold leading-6 text-indigo-800/80 dark:text-indigo-200/80">{shippingDeskCopy.receiptGuideBody}</p>
                        </div>
                        <div className="rounded-2xl bg-white/80 px-4 py-3 text-xs font-black text-indigo-700 shadow-sm dark:bg-slate-950/60 dark:text-indigo-200">
                            {receiptActionCount} / {state.shipments.length}
                        </div>
                    </div>
                </section>
            )}

            {(activeDesk === 'logistics' || activeDesk === 'receipts') ? (
                <>
                    <ShippingLogisticsPanel
                        t={state.t}
                        shipments={state.shipments}
                        laneStats={state.laneStats}
                        coldChainSeries={state.coldChainSeries}
                        onGenerateAiInsights={state.generateAiInsights}
                        isAiPanelOpen={state.isAiPanelOpen}
                        aiInsights={state.aiInsights}
                        onCloseAiPanel={() => state.setIsAiPanelOpen(false)}
                    />

                    <div className="app-card p-6">
                        <EnterpriseDataGrid
                            title={state.t.globalTracker || 'Real-time shipment list'}
                            columns={adaptDataTableColumns(shipmentColumns, {
                                id: '210px',
                                order: '220px',
                                product: '220px',
                                msds: '120px',
                                route: '160px',
                                status: '150px',
                                coldChain: '150px',
                                batchNo: '140px',
                                receipt: '160px',
                                date: '130px',
                            })}
                            data={state.shipments}
                            rowKey={(row) => String(row.id)}
                            getRowTestId={(row) => `shipment-row-${String(row.id).replace(/[^a-zA-Z0-9_-]/g, '-')}`}
                            exportFileName="出货物流清单"
                            exportSheetName="出货物流"
                            searchPlaceholder={state.t.search || '搜索物流、订单、产品...'}
                            searchInputTestId="shipping-grid-search-input"
                        />
                    </div>
                </>
            ) : activeDesk === 'assets' ? (
                <ShippingAssetsPanel
                    t={state.t}
                    assetSummaries={state.assetSummaries}
                    onOpenRecordMove={() => state.setIsAssetModalOpen(true)}
                    onQuickReturn={(customerId) => {
                        state.setAssetForm(prev => ({ ...prev, customerId, action: 'return', quantity: 1 }));
                        state.setIsAssetModalOpen(true);
                    }}
                />
            ) : null}

            <ShippingAssetModal
                t={state.t}
                isOpen={state.isAssetModalOpen}
                customers={state.customers}
                assetForm={state.assetForm}
                setAssetForm={state.setAssetForm}
                onClose={() => state.setIsAssetModalOpen(false)}
                onSubmit={state.handleAssetSubmit}
            />

            {state.receiptDrawerShipment && (
                <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30 backdrop-blur-sm" data-testid="shipping-receipt-drawer">
                    <button
                        type="button"
                        aria-label="关闭签收批次"
                        className="flex-1 cursor-default"
                        onClick={() => state.setReceiptDrawerShipment(null)}
                    />
                    <aside className="h-full w-full max-w-xl overflow-y-auto border-l border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-950">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-indigo-500">POD Ledger</p>
                                <h3 className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">签收批次</h3>
                                <p className="mt-1 text-sm font-bold text-slate-500">{state.receiptDrawerShipment.productName} · #{state.receiptDrawerShipment.id}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => state.setReceiptDrawerShipment(null)}
                                className="rounded-2xl border border-slate-200 px-4 py-2 text-xs font-black text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900"
                            >
                                关闭
                            </button>
                        </div>

                        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                            {[
                                ['发货量', state.receiptBundle?.receiptSummary.shipmentQuantity ?? state.receiptDrawerShipment.quantity ?? 0],
                                ['已签收', state.receiptBundle?.receiptSummary.processedQuantity ?? 0],
                                ['正常', state.receiptBundle?.receiptSummary.acceptedQuantity ?? 0],
                                ['剩余', state.receiptBundle?.receiptSummary.remainingQuantity ?? state.receiptDrawerShipment.quantity ?? 0],
                            ].map(([label, value]) => (
                                <div key={String(label)} className="rounded-2xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
                                    <p className="mt-2 font-data text-xl font-black text-slate-900 dark:text-white">{String(value)}</p>
                                </div>
                            ))}
                        </div>

                        <div data-testid="shipping-receipt-readback-evidence" className="mt-6 rounded-[28px] border border-emerald-100 bg-emerald-50/70 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">{shippingDeskCopy.receiptEvidenceTitle}</p>
                                    <p className="mt-2 text-xs font-bold leading-5 text-emerald-800/80 dark:text-emerald-100/80">
                                        {state.receiptBundle ? '保存或打开后，请用以下返回数据确认签收、库存扣减和差异入口已经连上。' : shippingDeskCopy.receiptEvidenceEmpty}
                                    </p>
                                </div>
                                <CheckCircle2 size={20} className="mt-1 flex-none text-emerald-600" />
                            </div>
                            <div className="mt-4 grid gap-2 md:grid-cols-2">
                                {shippingDeskCopy.receiptEvidenceItems.map((item) => (
                                    <div key={item} className="rounded-2xl border border-white/70 bg-white/75 px-3 py-2 text-xs font-black text-emerald-700 shadow-sm dark:border-emerald-900/30 dark:bg-slate-950/40 dark:text-emerald-200">
                                        {item}
                                    </div>
                                ))}
                            </div>
                            {state.receiptBundle && (
                                <div className="mt-4 grid gap-3 md:grid-cols-3">
                                    <div className="rounded-2xl bg-white/80 p-3 dark:bg-slate-950/50">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Summary</p>
                                        <p className="mt-2 text-xs font-bold text-slate-600 dark:text-slate-300">
                                            {state.receiptBundle.receiptSummary.processedQuantity}/{state.receiptBundle.receiptSummary.shipmentQuantity} processed, {state.receiptBundle.receiptSummary.remainingQuantity} remaining
                                        </p>
                                    </div>
                                    <div className="rounded-2xl bg-white/80 p-3 dark:bg-slate-950/50">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Latest POD</p>
                                        <p className="mt-2 text-xs font-bold text-slate-600 dark:text-slate-300">
                                            {latestReceipt ? `${latestReceipt.receiptNo} · ${latestReceipt.quantity}${latestReceipt.unit}` : 'No receipt batch yet'}
                                        </p>
                                    </div>
                                    <div className="rounded-2xl bg-white/80 p-3 dark:bg-slate-950/50">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Discrepancy</p>
                                        <p className="mt-2 text-xs font-bold text-slate-600 dark:text-slate-300">
                                            {primaryDiscrepancyCase ? `${primaryDiscrepancyCase.caseNo || primaryDiscrepancyCase.id} · ${primaryDiscrepancyCase.status}` : 'No discrepancy case returned'}
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="mt-6 rounded-3xl border border-slate-200 p-4 dark:border-slate-800">
                            <div className="mb-4 flex items-center justify-between">
                                <h4 className="text-sm font-black text-slate-800 dark:text-slate-100">新增签收批次</h4>
                                <StatusBadge
                                    status={state.receiptDrawerShipment.status}
                                    label={state.receiptDrawerShipment.status === 'delivered' ? '已完成' : state.receiptDrawerShipment.status === 'exception' ? '异常中' : '在途可签收'}
                                />
                            </div>
                            {!state.canWriteShipping && (
                                <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
                                    当前角色只能查看签收批次，保存签收和上传凭证需要发货写入权限。
                                </div>
                            )}
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                <FormField dataTestId="shipping-receipt-quantity-input" label="本次数量" value={state.receiptForm.quantity} onChange={(value) => state.setReceiptForm(prev => ({ ...prev, quantity: value, acceptedQuantity: prev.acceptedQuantity || value }))} disabled={!state.canWriteShipping || state.receiptDrawerShipment.status === 'delivered'} />
                                <FormField dataTestId="shipping-receipt-accepted-input" label="正常签收" value={state.receiptForm.acceptedQuantity} onChange={(value) => state.setReceiptForm(prev => ({ ...prev, acceptedQuantity: value }))} disabled={!state.canWriteShipping || state.receiptDrawerShipment.status === 'delivered'} />
                                <FormField dataTestId="shipping-receipt-rejected-input" label="异常数量" value={state.receiptForm.rejectedQuantity} onChange={(value) => state.setReceiptForm(prev => ({ ...prev, rejectedQuantity: value }))} disabled={!state.canWriteShipping || state.receiptDrawerShipment.status === 'delivered'} />
                            </div>
                            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <FormField label="异常原因" value={state.receiptForm.discrepancyReason} onChange={(value) => state.setReceiptForm(prev => ({ ...prev, discrepancyReason: value }))} disabled={!state.canWriteShipping || state.receiptDrawerShipment.status === 'delivered'} />
                                <label className="block space-y-1.5">
                                    <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">签收凭证</span>
                                    <input
                                        data-testid="shipping-receipt-file-input"
                                        type="file"
                                        accept="image/*,application/pdf"
                                        disabled={!state.canWriteShipping || state.receiptDrawerShipment.status === 'delivered'}
                                        onChange={(event) => state.handleReceiptFileChange(event.target.files?.[0] || null)}
                                        className="app-control w-full text-xs"
                                    />
                                </label>
                            </div>
                            <FormField className="mt-3" as="textarea" rows={3} label="备注" value={state.receiptForm.note} onChange={(value) => state.setReceiptForm(prev => ({ ...prev, note: value }))} disabled={!state.canWriteShipping || state.receiptDrawerShipment.status === 'delivered'} />
                            <button
                                type="button"
                                data-testid="shipping-receipt-save-button"
                                onClick={state.handleSubmitReceiptEvent}
                                disabled={state.isReceiptLoading || !state.canWriteShipping || state.receiptDrawerShipment.status === 'delivered'}
                                className="mt-4 w-full rounded-2xl bg-indigo-600 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white shadow-appLift transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {state.isReceiptLoading ? '保存中...' : '保存签收批次'}
                            </button>
                        </div>

                        <div className="mt-6 space-y-3">
                            <h4 className="text-sm font-black text-slate-800 dark:text-slate-100">历史批次</h4>
                            {(state.receiptBundle?.receipts || []).length === 0 ? (
                                <div className="rounded-3xl border border-dashed border-slate-200 p-6 text-center text-xs font-bold text-slate-400 dark:border-slate-800">
                                    暂无签收批次
                                </div>
                            ) : (
                                state.receiptBundle?.receipts.map((receipt) => (
                                    <div key={receipt.id} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <p className="text-xs font-black text-slate-700 dark:text-slate-100">{receipt.receiptNo}</p>
                                                <p className="mt-1 text-[11px] font-bold text-slate-400">{receipt.receivedAt || receipt.createdAt || '-'}</p>
                                            </div>
                                            <StatusBadge status={receipt.rejectedQuantity > 0 ? 'exception' : 'delivered'} label={receipt.rejectedQuantity > 0 ? '有异常' : '正常'} />
                                        </div>
                                        <div className="mt-3 grid grid-cols-3 gap-2 text-xs font-bold text-slate-500">
                                            <span>本次 {receipt.quantity}{receipt.unit}</span>
                                            <span>正常 {receipt.acceptedQuantity}{receipt.unit}</span>
                                            <span>异常 {receipt.rejectedQuantity}{receipt.unit}</span>
                                        </div>
                                        {receipt.signedReceiptUrl ? (
                                            <a href={receipt.signedReceiptUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-xs font-black text-indigo-600">查看凭证</a>
                                        ) : null}
                                        {receipt.note || receipt.discrepancyReason ? (
                                            <p className="mt-2 text-xs font-medium text-slate-400">{receipt.discrepancyReason || receipt.note}</p>
                                        ) : null}
                                    </div>
                                ))
                            )}
                        </div>
                    </aside>
                </div>
            )}
        </div>
    );
};

export default Shipping;
