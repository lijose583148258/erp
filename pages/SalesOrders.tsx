import React, { useMemo } from 'react';
import { Pencil, CheckCircle2, XCircle, Check, Truck, ReceiptText, CreditCard } from 'lucide-react';
import { adaptDataTableColumns, EnterpriseDataGrid } from '../components/ui';
import { useSalesOrders } from './sales-orders/useSalesOrders';
import { buildSalesOrderColumns } from './sales-orders/SalesOrderColumns';
import SalesOrderHistoryModal from './sales-orders/SalesOrderHistoryModal';
import SalesOrderPaymentModal from './sales-orders/SalesOrderPaymentModal';
import SalesOrderEditorModal from './sales-orders/SalesOrderEditorModal';
import CollectionActionModal from '../components/collections/CollectionActionModal';
import { OrderStatus, CommissionStatus } from '../types';
import { useAppContext } from '../app/AppContext';

const makeSalesOrderTestId = (id: unknown) => String(id ?? 'unknown').replace(/[^a-zA-Z0-9_-]/g, '-');

const SalesOrders = () => {
    const { t, currentUser } = useAppContext();
    const state = useSalesOrders();

    const columns = useMemo(() => buildSalesOrderColumns({
        t,
        language: state.language,
        formatPrice: state.formatPrice,
        getCollectionView: state.getCollectionView,
        openHistoryModal: state.openHistoryModal
    }), [t, state.language, state.formatPrice, state.getCollectionView, state.openHistoryModal]);

    const handleCollectionSubmitted = async () => {
        const selectedId = state.selectedOrder?.id;
        await state.loadOrderWorkspace();
        if (selectedId) {
            await state.refreshSelectedOrder(selectedId);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-end">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight uppercase">
                        {state.isManagerView ? t.commPending : t.orders}
                    </h1>
                </div>
                <div className="flex gap-4">
                    {state.canCreateOrder && (
                        <button data-testid="sales-order-create-button" onClick={state.openCreateModal} className="flex items-center px-10 py-4 bg-blue-600 text-white rounded-[28px] font-black text-sm shadow-2xl hover:bg-blue-700 transition-all active:scale-95">
                            <Pencil size={20} className="mr-3" /> {t.newOrder}
                        </button>
                    )}
                    {state.canAuditCommission && (
                        <div className="bg-slate-100 dark:bg-slate-800 p-1 rounded-xl flex flex-wrap gap-2">
                            <button onClick={() => state.setIsManagerView(false)} className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${!state.isManagerView ? 'bg-white shadow text-blue-600' : 'text-slate-400'}`}>{t.memberView}</button>
                            <button onClick={() => state.setIsManagerView(true)} className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${state.isManagerView ? 'bg-slate-900 text-white shadow' : 'text-slate-400'}`}>{t.managerView}</button>
                        </div>
                    )}
                </div>
            </div>

            <div className="app-card p-6">
            <EnterpriseDataGrid
                title={state.isManagerView ? t.commPending : t.orders}
                data={state.displayedOrders}
                columns={adaptDataTableColumns(columns, {
                    id: '130px',
                    customer: '220px',
                    documentAxis: '130px',
                    fulfillmentAxis: '130px',
                    financialAxis: '140px',
                    finance: '220px',
                    commissionAxis: '140px',
                    dueDate: '130px',
                    finalAmount: '140px',
                })}
                rowKey={(row: any) => String(row.id)}
                getRowTestId={(row: any) => `sales-order-row-${makeSalesOrderTestId(row.id)}`}
                exportFileName={state.isManagerView ? '销售订单_提成审核' : '销售订单'}
                exportSheetName="销售订单"
                onImport={state.handleImport}
                searchPlaceholder={t.search || '搜索订单、客户、状态...'}
                rowActions={(row: any) => (
                    <div className="flex flex-wrap justify-end gap-2">
                        {state.canEditOrder(row) && (
                            <button data-testid="sales-order-edit-button" onClick={(e) => { e.stopPropagation(); state.openEditModal(row); }} className="p-2 bg-amber-50 text-amber-600 rounded-xl hover:bg-amber-100 border border-amber-200" title={t.editOrder}>
                                <Pencil size={16} />
                            </button>
                        )}
                        {state.canRecordPayment && 
                            <button data-testid="sales-order-payment-button" onClick={(e) => { e.stopPropagation(); state.openPaymentModal(row); }} className="p-2 bg-emerald-50 text-emerald-600 rounded-xl hover:bg-emerald-100 border border-emerald-200" title={t.recordPayment}>
                                <CreditCard size={16} />
                            </button>
                        }
                        <button data-testid="sales-order-history-button" onClick={(e) => { e.stopPropagation(); state.openHistoryModal(row); }} className="p-2 bg-slate-50 text-slate-600 rounded-xl hover:bg-slate-100 border border-slate-200" title="View History">
                            <ReceiptText size={16} />
                        </button>
                        {state.isManagerView && row.commissionStatus === CommissionStatus.PENDING && state.canAuditCommission && (
                            <>
                                <button onClick={(e) => { e.stopPropagation(); state.handleCommissionAudit(row.id, CommissionStatus.APPROVED); }} className="p-2 bg-emerald-50 text-emerald-600 rounded-xl hover:bg-emerald-100"><CheckCircle2 size={16} /></button>
                                <button onClick={(e) => { e.stopPropagation(); state.handleCommissionAudit(row.id, CommissionStatus.REJECTED); }} className="p-2 bg-rose-50 text-rose-600 rounded-xl hover:bg-rose-100"><XCircle size={16} /></button>
                            </>
                        )}
                        {!state.isManagerView && state.canCreateOrder && (
                            <>
                                {row.status === OrderStatus.PENDING && <button onClick={(e) => { e.stopPropagation(); state.handleStatusUpdate(row.id, OrderStatus.CONFIRMED); }} className="p-2 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100" title="Confirm Order"><Check size={16} /></button>}
                                {row.status === OrderStatus.CONFIRMED && (
                                    <button onClick={(e) => { e.stopPropagation(); state.handleQuickShip(row); }} className="p-2 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-100" title="Quick Ship">
                                        <Truck size={16} />
                                    </button>
                                )}
                                {row.fulfillmentStatus === 'delivered' && row.financialStatus === 'paid' && (currentUser?.role === 'admin' || currentUser?.role === 'manager') && (
                                    <button onClick={(e) => { e.stopPropagation(); state.handleManualComplete(row.id); }} className="p-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 shadow-xl animate-pulse" title="Complete Order">
                                        <CheckCircle2 size={16} />
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                )}
            />
            </div>

            <SalesOrderHistoryModal
                isOpen={state.isHistoryOpen}
                selectedOrder={state.selectedOrder}
                language={state.language}
                historyTab={state.historyTab}
                setHistoryTab={state.setHistoryTab}
                t={t}
                formatPrice={state.formatPrice}
                getOutstandingAmount={state.getOutstandingAmount}
                getCollectionView={state.getCollectionView}
                canVerifyPayment={state.canVerifyPayment}
                onClose={() => state.setIsHistoryOpen(false)}
                onOpenPromise={() => state.selectedOrder && state.openCollectionAction('promise', state.selectedOrder)}
                onOpenDispute={() => state.selectedOrder && state.openCollectionAction('dispute', state.selectedOrder)}
                onVerifyPayment={state.handleVerifyPayment}
            />

            <SalesOrderPaymentModal
                isOpen={state.isPaymentOpen}
                selectedOrder={state.selectedOrder}
                language={state.language}
                t={t}
                formatPrice={state.formatPrice}
                paymentForm={state.paymentForm}
                setPaymentForm={state.setPaymentForm}
                onClose={() => state.setIsPaymentOpen(false)}
                onConfirm={state.handleRecordPayment}
            />

            <SalesOrderEditorModal
                isOpen={state.isCreateOpen}
                isEditMode={state.isEditMode}
                isOffline={state.isOffline}
                draftAvailable={state.draftAvailable}
                language={state.language}
                t={t}
                customers={state.customers}
                contracts={state.contracts}
                formData={state.formData}
                ocrDocType={state.ocrDocType}
                setOcrDocType={state.setOcrDocType}
                ocrText={state.ocrText}
                setOcrText={state.setOcrText}
                ocrResult={state.ocrResult}
                handleSmartFill={state.handleSmartFill}
                handleOcrParse={state.handleOcrParse}
                handleApplyOcr={state.handleApplyOcr}
                handleProductScan={state.handleProductScan}
                syncOfflineData={state.syncOfflineData}
                loadDraft={state.loadDraft}
                clearDraft={state.clearDraft}
                onClose={() => state.setIsCreateOpen(false)}
                onSave={state.handleSaveOrder}
                totals={state.totals}
                formatPrice={state.formatPrice}
                priceSuggestions={state.priceSuggestions}
                inventoryInsights={state.inventoryInsights}
                isScanning={state.isScanning}
                updateOrderHeader={state.updateOrderHeader}
                updateOrderItem={state.updateOrderItem}
                addOrderItem={state.addOrderItem}
                duplicateOrderItem={state.duplicateOrderItem}
                removeOrderItem={state.removeOrderItem}
                importOrderItemsFromGrid={state.importOrderItemsFromGrid}
            />

            <CollectionActionModal
                mode={state.collectionActionMode}
                target={state.collectionActionTarget}
                open={state.collectionActionMode !== null && state.collectionActionTarget !== null}
                onClose={() => state.setCollectionActionMode(null)}
                onSubmitted={handleCollectionSubmitted}
            />
        </div>
    );
};

export default SalesOrders;
