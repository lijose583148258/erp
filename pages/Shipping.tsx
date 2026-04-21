import React from 'react';
import { adaptDataTableColumns, EnterpriseDataGrid, FormField, StatusBadge } from '../components/ui';
import { buildShipmentColumns } from './shipping/ShippingColumns';
import ShippingOcrPanel from './shipping/ShippingOcrPanel';
import ShippingLogisticsPanel from './shipping/ShippingLogisticsPanel';
import ShippingAssetModal from './shipping/ShippingAssetModal';
import ShippingAssetsPanel from './shipping/ShippingAssetsPanel';
import { useShipping } from './shipping/useShipping';

const Shipping = () => {
    const state = useShipping();
    const shipmentColumns = buildShipmentColumns(state.t, state.handleFileUpload, state.handleShipmentStatusUpdate, state.handleOpenReceiptEvents);

    return (
        <div className="space-y-6">
            <input data-testid="shipment-receipt-input" type="file" ref={state.fileInputRef} className="hidden" accept="image/*,application/pdf" onChange={state.onFileChange} />

            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 dark:text-white uppercase italic tracking-tighter">{state.t.shipping}</h1>
                    <p className="text-slate-500 font-medium tracking-tight text-sm mt-2">{state.t.allServiceRequests || 'Global Logistics Management System'}</p>
                </div>
                <div className="flex flex-wrap gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl">
                    <button
                        data-testid="shipping-tab-logistics"
                        onClick={() => state.setActiveTab('logistics')}
                        className={`px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${state.activeTab === 'logistics' ? 'bg-white dark:bg-slate-700 shadow text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                        {state.t.globalTracker || 'Logistics'}
                    </button>
                    <button
                        data-testid="shipping-tab-assets"
                        onClick={() => state.setActiveTab('assets')}
                        className={`px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center ${state.activeTab === 'assets' ? 'bg-white dark:bg-slate-700 shadow text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                        {state.t.assets || 'Asset Flow'}
                    </button>
                </div>
            </div>

            {state.activeTab === 'logistics' ? (
                <>
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
                                id: '120px',
                                order: '180px',
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
                        />
                    </div>
                </>
            ) : (
                <ShippingAssetsPanel
                    t={state.t}
                    assetSummaries={state.assetSummaries}
                    onOpenRecordMove={() => state.setIsAssetModalOpen(true)}
                    onQuickReturn={(customerId) => {
                        state.setAssetForm(prev => ({ ...prev, customerId, action: 'return', quantity: 1 }));
                        state.setIsAssetModalOpen(true);
                    }}
                />
            )}

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

                        <div className="mt-6 grid grid-cols-4 gap-3">
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

                        <div className="mt-6 rounded-3xl border border-slate-200 p-4 dark:border-slate-800">
                            <div className="mb-4 flex items-center justify-between">
                                <h4 className="text-sm font-black text-slate-800 dark:text-slate-100">新增签收批次</h4>
                                <StatusBadge
                                    status={state.receiptDrawerShipment.status}
                                    label={state.receiptDrawerShipment.status === 'delivered' ? '已完成' : state.receiptDrawerShipment.status === 'exception' ? '异常中' : '在途可签收'}
                                />
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                                <FormField dataTestId="shipping-receipt-quantity-input" label="本次数量" value={state.receiptForm.quantity} onChange={(value) => state.setReceiptForm(prev => ({ ...prev, quantity: value, acceptedQuantity: prev.acceptedQuantity || value }))} disabled={state.receiptDrawerShipment.status === 'delivered'} />
                                <FormField dataTestId="shipping-receipt-accepted-input" label="正常签收" value={state.receiptForm.acceptedQuantity} onChange={(value) => state.setReceiptForm(prev => ({ ...prev, acceptedQuantity: value }))} disabled={state.receiptDrawerShipment.status === 'delivered'} />
                                <FormField dataTestId="shipping-receipt-rejected-input" label="异常数量" value={state.receiptForm.rejectedQuantity} onChange={(value) => state.setReceiptForm(prev => ({ ...prev, rejectedQuantity: value }))} disabled={state.receiptDrawerShipment.status === 'delivered'} />
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-3">
                                <FormField label="异常原因" value={state.receiptForm.discrepancyReason} onChange={(value) => state.setReceiptForm(prev => ({ ...prev, discrepancyReason: value }))} disabled={state.receiptDrawerShipment.status === 'delivered'} />
                                <label className="block space-y-1.5">
                                    <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-300">签收凭证</span>
                                    <input
                                        data-testid="shipping-receipt-file-input"
                                        type="file"
                                        accept="image/*,application/pdf"
                                        disabled={state.receiptDrawerShipment.status === 'delivered'}
                                        onChange={(event) => state.handleReceiptFileChange(event.target.files?.[0] || null)}
                                        className="app-control w-full text-xs"
                                    />
                                </label>
                            </div>
                            <FormField className="mt-3" as="textarea" rows={3} label="备注" value={state.receiptForm.note} onChange={(value) => state.setReceiptForm(prev => ({ ...prev, note: value }))} disabled={state.receiptDrawerShipment.status === 'delivered'} />
                            <button
                                type="button"
                                data-testid="shipping-receipt-save-button"
                                onClick={state.handleSubmitReceiptEvent}
                                disabled={state.isReceiptLoading || state.receiptDrawerShipment.status === 'delivered'}
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
