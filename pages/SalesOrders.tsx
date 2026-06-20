import React, { useCallback, useMemo, useState } from 'react';
import { BookOpen, ClipboardList, Pencil, CheckCircle2, XCircle, Check, Truck, ReceiptText, CreditCard, ShieldCheck } from 'lucide-react';
import type { EnterpriseColumn } from '../components/ui';
import { WorkspaceTaskNavigator, type WorkspaceTaskNavigatorItem } from '../components/ui/WorkspaceTaskNavigator';
import { OperatingDataGrid } from '../components/operatingTable/OperatingDataGrid';
import {
    createSalesOrderOperatingColumns,
    getSalesOrderRiskTone,
    type SalesOrderOperatingRow,
} from '../components/operatingTable/salesOrderOperatingTable';
import { useSalesOrders } from './sales-orders/useSalesOrders';
import SalesOrderHistoryModal from './sales-orders/SalesOrderHistoryModal';
import SalesOrderPaymentModal from './sales-orders/SalesOrderPaymentModal';
import SalesOrderEditorModal from './sales-orders/SalesOrderEditorModal';
import CollectionActionModal from '../components/collections/CollectionActionModal';
import { OrderStatus, CommissionStatus, type SalesOrder } from '../types';
import { useAppContext } from '../app/AppContext';
import { getOperatingTableLabels } from '../i18n/operatingTable';

const makeSalesOrderTestId = (id: unknown) => String(id ?? 'unknown').replace(/[^a-zA-Z0-9_-]/g, '-');
type SalesOrderDesk = 'orders' | 'payments' | 'fulfillment' | 'commission' | 'principle';
type OperatingSalesOrderRow = SalesOrderOperatingRow & { sourceOrder: SalesOrder };

const toOperatingSalesOrderRow = (order: SalesOrder): OperatingSalesOrderRow => {
    const orderedQuantity = (order.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const productSummary = (order.items || [])
        .map((item) => [item.productName, item.packagingSpec].filter(Boolean).join(' '))
        .filter(Boolean)
        .join(' / ');

    return {
        sourceOrder: order,
        id: order.id,
        orderNo: order.orderNo || `#${order.id}`,
        customerName: order.customerDisplayName || order.customerNameZh || order.customerNameEn || order.customerNameVi || order.customerName,
        customerCode: order.customerId,
        ownerName: order.creatorName || order.salespersonId,
        orderDate: order.orderDate,
        deliveryDate: order.dueDate,
        productSummary,
        totalAmount: Number(order.finalAmount || order.totalAmount || 0),
        paidAmount: Number(order.paidAmount || 0),
        currency: order.currency,
        orderedQuantity,
        shippedQuantity: order.fulfillmentStatus === 'delivered' ? orderedQuantity : 0,
        quantityUnit: order.items?.[0]?.unit,
        orderStatus: order.status,
        fulfillmentStatus: order.fulfillmentStatus,
        paymentStatus: order.financialStatus || order.paymentStatus,
        overdueDays: order.financialStatus === 'overdue' ? 1 : 0,
        creditRisk: (order as any).creditRisk || (order.financialStatus === 'overdue' ? 'blocked' : 'normal'),
        stockRisk: (order as any).stockRisk || (order as any).inventoryRisk || 'normal',
    };
};

const SalesOrders = () => {
    const { t, currentUser } = useAppContext();
    const state = useSalesOrders();
    const [activeDesk, setActiveDesk] = useState<SalesOrderDesk>('orders');

    const operatingLabels = useMemo(() => getOperatingTableLabels(state.language), [state.language]);
    const operatingRows = useMemo(
        () => state.displayedOrders.map((order: SalesOrder) => toOperatingSalesOrderRow(order)),
        [state.displayedOrders],
    );
    const columns = useMemo(
        () => createSalesOrderOperatingColumns(
            operatingLabels,
            (value, currency) => state.formatPrice(value, currency as any),
        ) as EnterpriseColumn<OperatingSalesOrderRow>[],
        [operatingLabels, state.formatPrice],
    );

    const handleCollectionSubmitted = async () => {
        const selectedId = state.selectedOrder?.id;
        await state.loadOrderWorkspace();
        if (selectedId) {
            await state.refreshSelectedOrder(selectedId);
        }
    };

    const salesDeskCopy = useMemo(() => {
        if (state.language === 'en') {
            return {
                eyebrow: 'Sales order flow',
                title: 'Order-centered task navigation',
                description: 'Use the order list as the source of truth, then open payment, fulfillment, history, or commission actions from the exact order row.',
                orders: { title: 'Order ledger', subtitle: 'Create and edit', purpose: 'Maintain order header and item lines. Payments and fulfillment are separate actions.' },
                payments: { title: 'Payment shortcut', subtitle: 'From exact order row', purpose: 'Use this only as an order-row shortcut. The collections center remains the primary receipt verification workspace.' },
                fulfillment: { title: 'Fulfillment action', subtitle: 'Confirm and ship', purpose: 'Confirm orders and trigger shipment from eligible rows only.' },
                commission: { title: 'Commission audit', subtitle: 'Manager only', purpose: 'Review pending commissions separately from daily order entry.' },
                principle: { title: 'Boundary rules', subtitle: 'Avoid mixed actions', purpose: 'Clarify what belongs to order drafting, payment, fulfillment, and audit.' },
                principleCards: [
                    ['Order is the parent object', 'Customer, items, price, terms, and totals belong to the order.'],
                    ['Payments are child records', 'One order may have many payments, promises, disputes, and verification steps.'],
                    ['Fulfillment is not finance', 'Shipping and delivery should update fulfillment status, not paid amount.'],
                ],
            };
        }
        if (state.language === 'vi') {
            return {
                eyebrow: 'Luồng đơn bán',
                title: 'Điều hướng theo đơn hàng',
                description: 'Danh sách đơn là nguồn dữ liệu chính; thu tiền, giao hàng, lịch sử và hoa hồng đều mở từ đúng dòng đơn.',
                orders: { title: 'Sổ đơn hàng', subtitle: 'Tạo và sửa', purpose: 'Quản lý đầu đơn và dòng hàng. Thu tiền và giao hàng là thao tác riêng.' },
                payments: { title: 'Lối tắt thu tiền', subtitle: 'Từ đúng dòng đơn', purpose: 'Chỉ dùng như lối tắt từ dòng đơn. Trung tâm thu tiền vẫn là nơi xác minh và đối soát chính.' },
                fulfillment: { title: 'Giao hàng', subtitle: 'Xác nhận và xuất hàng', purpose: 'Chỉ xác nhận và tạo giao hàng từ các dòng đủ điều kiện.' },
                commission: { title: 'Duyệt hoa hồng', subtitle: 'Chỉ quản lý', purpose: 'Tách duyệt hoa hồng khỏi nhập đơn hằng ngày.' },
                principle: { title: 'Quy tắc ranh giới', subtitle: 'Không trộn thao tác', purpose: 'Phân biệt soạn đơn, thu tiền, giao hàng và kiểm toán.' },
                principleCards: [
                    ['Đơn hàng là đối tượng cha', 'Khách hàng, hàng hóa, giá, điều khoản và tổng tiền thuộc về đơn.'],
                    ['Thu tiền là bản ghi con', 'Một đơn có thể có nhiều lần thu, cam kết, tranh chấp và xác minh.'],
                    ['Giao hàng không phải tài chính', 'Vận chuyển và ký nhận cập nhật trạng thái giao hàng, không cập nhật số đã thu.'],
                ],
            };
        }
        return {
            eyebrow: '销售订单职责分流',
            title: '先找订单，再做动作',
            description: '订单列表是主对象入口，回款、发货、历史、提成审核都必须从具体订单行进入，避免把订单、收款、物流和审核混成一个输入区。',
            orders: { title: '订单台账', subtitle: '新建 / 编辑', purpose: '维护订单头和明细行，回款和履约不直接写在订单编辑区。' },
            payments: { title: '订单行回款快捷入口', subtitle: '从准确订单进入', purpose: '这里只是从订单行登记或查看子记录；批量核销、承诺、争议和拦截仍以回款中心为主入口。' },
            fulfillment: { title: '履约动作', subtitle: '确认 / 发货', purpose: '只对符合条件的订单推进确认、发货和完成，不混入财务。' },
            commission: { title: '提成审核', subtitle: '经理视图', purpose: '把提成审核和日常开单分开，避免业务员误触审核动作。' },
            principle: { title: '边界规则', subtitle: '避免动作混写', purpose: '说明订单、回款、履约、审核各自写入什么数据。' },
            principleCards: [
                ['订单是父对象', '客户、商品明细、价格、账期、总额属于订单主对象。'],
                ['回款是子记录', '一笔订单可以有多笔回款、承诺、争议和核验，不覆盖订单本身。'],
                ['履约不是财务', '发货和签收推进履约状态，不直接改变已收款金额。'],
            ],
        };
    }, [state.language]);

    const switchSalesDesk = useCallback((desk: SalesOrderDesk) => {
        setActiveDesk(desk);
        if (desk === 'commission' && state.canAuditCommission) {
            state.setIsManagerView(true);
            return;
        }
        if (state.isManagerView && desk !== 'commission') {
            state.setIsManagerView(false);
        }
    }, [state]);

    const salesDeskItems = useMemo<WorkspaceTaskNavigatorItem<SalesOrderDesk>[]>(() => {
        const paymentCount = state.displayedOrders.filter((order: any) => order.financialStatus !== 'paid').length;
        const fulfillmentCount = state.displayedOrders.filter((order: any) => order.fulfillmentStatus !== 'delivered').length;
        const commissionCount = state.displayedOrders.filter((order: any) => order.commissionStatus === CommissionStatus.PENDING).length;
        return [
            {
                id: 'orders',
                title: salesDeskCopy.orders.title,
                subtitle: salesDeskCopy.orders.subtitle,
                purpose: salesDeskCopy.orders.purpose,
                count: state.displayedOrders.length,
                icon: ClipboardList,
                testId: 'sales-desk-orders',
            },
            {
                id: 'payments',
                title: salesDeskCopy.payments.title,
                subtitle: salesDeskCopy.payments.subtitle,
                purpose: salesDeskCopy.payments.purpose,
                count: paymentCount,
                icon: CreditCard,
                testId: 'sales-desk-payments',
            },
            {
                id: 'fulfillment',
                title: salesDeskCopy.fulfillment.title,
                subtitle: salesDeskCopy.fulfillment.subtitle,
                purpose: salesDeskCopy.fulfillment.purpose,
                count: fulfillmentCount,
                icon: Truck,
                testId: 'sales-desk-fulfillment',
            },
            ...(state.canAuditCommission ? [{
                id: 'commission' as const,
                title: salesDeskCopy.commission.title,
                subtitle: salesDeskCopy.commission.subtitle,
                purpose: salesDeskCopy.commission.purpose,
                count: commissionCount,
                icon: ShieldCheck,
                testId: 'sales-desk-commission',
            }] : []),
            {
                id: 'principle',
                title: salesDeskCopy.principle.title,
                subtitle: salesDeskCopy.principle.subtitle,
                purpose: salesDeskCopy.principle.purpose,
                count: salesDeskCopy.principleCards.length,
                icon: BookOpen,
                testId: 'sales-desk-principle',
            },
        ];
    }, [salesDeskCopy, state.canAuditCommission, state.displayedOrders]);

    const activeDeskNotice = useMemo(() => {
        if (activeDesk === 'principle') return null;
        if (state.language === 'en') {
            const copy = {
                orders: ['Order entry boundary', 'Edit customer, items, price, terms, and document status here. Do not record receipts or shipment completion inside the order editor.'],
                payments: ['Payment shortcut boundary', 'This area starts from a precise order row only. Batch verification, promises, disputes, and credit holds still belong to the collections center.'],
                fulfillment: ['Fulfillment boundary', 'Confirm and ship eligible orders here. Delivery status does not change paid amount.'],
                commission: ['Commission audit boundary', 'Manager review is separated from daily order entry so sales staff do not accidentally approve commissions.'],
            } as const;
            return copy[activeDesk];
        }
        if (state.language === 'vi') {
            const copy = {
                orders: ['Ranh giới lập đơn', 'Chỉ sửa khách hàng, dòng hàng, giá, điều khoản và trạng thái chứng từ. Không ghi thu tiền hoặc hoàn tất giao hàng trong trình sửa đơn.'],
                payments: ['Ranh giới lối tắt thu tiền', 'Khu vực này chỉ bắt đầu từ đúng dòng đơn. Đối soát hàng loạt, cam kết, tranh chấp và khóa tín dụng vẫn thuộc trung tâm thu tiền.'],
                fulfillment: ['Ranh giới giao hàng', 'Chỉ xác nhận và giao các đơn đủ điều kiện. Trạng thái giao hàng không làm thay đổi số tiền đã thu.'],
                commission: ['Ranh giới duyệt hoa hồng', 'Duyệt của quản lý tách khỏi nhập đơn hằng ngày để nhân viên bán hàng không duyệt nhầm.'],
            } as const;
            return copy[activeDesk];
        }
        const copy = {
            orders: ['订单录入边界', '这里维护客户、明细、价格、账期和单据状态，不在订单编辑器里直接登记回款或完成发货。'],
            payments: ['订单行回款快捷入口', '这里只能从准确订单行发起登记或查看。批量核销、承诺付款、争议处理、信用/发货拦截仍回到回款中心。'],
            fulfillment: ['履约动作边界', '这里只推进符合条件的确认、发货和签收；发货状态不直接改变已收款金额。'],
            commission: ['提成审核边界', '经理审核与日常开单分离，避免业务员误触审批动作。'],
        } as const;
        return copy[activeDesk];
    }, [activeDesk, state.language]);

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-end">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight uppercase">
                        {state.isManagerView ? t.commPending : t.orders}
                    </h1>
                </div>
                <div className="flex gap-4">
                    {activeDesk === 'orders' && state.canCreateOrder && (
                        <button data-testid="sales-order-create-button" onClick={state.openCreateModal} className="flex items-center px-10 py-4 bg-blue-600 text-white rounded-[28px] font-black text-sm shadow-2xl hover:bg-blue-700 transition-all active:scale-95">
                            <Pencil size={20} className="mr-3" /> {t.newOrder}
                        </button>
                    )}
                </div>
            </div>

            <WorkspaceTaskNavigator
                eyebrow={salesDeskCopy.eyebrow}
                title={salesDeskCopy.title}
                description={salesDeskCopy.description}
                items={salesDeskItems}
                activeId={activeDesk}
                onChange={switchSalesDesk}
                columns="four"
            />

            {activeDeskNotice ? (
                <section data-testid={`sales-order-${activeDesk}-boundary-notice`} className="rounded-[30px] border border-blue-100 bg-blue-50/80 p-5 shadow-sm dark:border-blue-900/60 dark:bg-blue-950/30">
                    <div className="flex items-start gap-4">
                        <div className="mt-0.5 rounded-2xl bg-white p-2 text-blue-600 shadow-sm dark:bg-slate-900 dark:text-blue-300">
                            <ShieldCheck size={18} />
                        </div>
                        <div>
                            <h3 className="text-sm font-black tracking-tight text-slate-950 dark:text-white">{activeDeskNotice[0]}</h3>
                            <p className="mt-2 text-sm font-bold leading-6 text-slate-600 dark:text-slate-300">{activeDeskNotice[1]}</p>
                        </div>
                    </div>
                </section>
            ) : null}

            {activeDesk === 'principle' && (
                <section data-testid="sales-order-principle-panel" className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    {salesDeskCopy.principleCards.map(([title, body]) => (
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

            <div className="app-card p-6">
            <OperatingDataGrid
                labels={operatingLabels}
                titleKey="order.title"
                titleFallback={state.isManagerView ? t.commPending : t.orders}
                descriptionKey="order.description"
                descriptionFallback=""
                data={operatingRows}
                columns={columns}
                rowKey={(row) => String(row.id)}
                getRowTestId={(row) => `sales-order-row-${makeSalesOrderTestId(row.id)}`}
                preferenceKey="sales-order-operating-table"
                exportFileName={state.isManagerView ? '销售订单_提成审核' : '销售订单'}
                exportSheetName="销售订单"
                onImport={state.handleImport}
                searchInputTestId="sales-order-search"
                rowTone={getSalesOrderRiskTone}
                renderRowActions={(row) => {
                    const order = row.sourceOrder;
                    const showOrderActions = activeDesk === 'orders';
                    const showPaymentActions = activeDesk === 'payments';
                    const showFulfillmentActions = activeDesk === 'fulfillment';
                    const showCommissionActions = activeDesk === 'commission';
                    return (
                    <div className="flex flex-wrap justify-end gap-2">
                        {showOrderActions && state.canEditOrder(order) && (
                            <button data-testid="sales-order-edit-button" aria-label={t.editOrder} onClick={(e) => { e.stopPropagation(); state.openEditModal(order); }} className="min-h-11 min-w-11 p-2 bg-amber-50 text-amber-600 rounded-xl hover:bg-amber-100 border border-amber-200" title={t.editOrder}>
                                <Pencil size={16} />
                            </button>
                        )}
                        {showPaymentActions && state.canRecordPayment && 
                            <button data-testid="sales-order-payment-button" aria-label={t.recordPayment} onClick={(e) => { e.stopPropagation(); state.openPaymentModal(order); }} className="min-h-11 min-w-11 p-2 bg-emerald-50 text-emerald-600 rounded-xl hover:bg-emerald-100 border border-emerald-200" title={t.recordPayment}>
                                <CreditCard size={16} />
                            </button>
                        }
                        <button data-testid="sales-order-history-button" aria-label={t.viewHistory || '查看历史'} onClick={(e) => { e.stopPropagation(); state.openHistoryModal(order); }} className="min-h-11 min-w-11 p-2 bg-slate-50 text-slate-600 rounded-xl hover:bg-slate-100 border border-slate-200" title={t.viewHistory || '查看历史'}>
                            <ReceiptText size={16} />
                        </button>
                        {showCommissionActions && state.isManagerView && order.commissionStatus === CommissionStatus.PENDING && state.canAuditCommission && (
                            <>
                                <button aria-label={t.approve || '通过'} title={t.approve || '通过'} onClick={(e) => { e.stopPropagation(); state.handleCommissionAudit(order.id, CommissionStatus.APPROVED); }} className="min-h-11 min-w-11 p-2 bg-emerald-50 text-emerald-600 rounded-xl hover:bg-emerald-100"><CheckCircle2 size={16} /></button>
                                <button aria-label={t.reject || '驳回'} title={t.reject || '驳回'} onClick={(e) => { e.stopPropagation(); state.handleCommissionAudit(order.id, CommissionStatus.REJECTED); }} className="min-h-11 min-w-11 p-2 bg-rose-50 text-rose-600 rounded-xl hover:bg-rose-100"><XCircle size={16} /></button>
                            </>
                        )}
                        {showFulfillmentActions && !state.isManagerView && state.canCreateOrder && (
                            <>
                                {order.status === OrderStatus.PENDING && <button aria-label={t.confirmOrder || '确认订单'} onClick={(e) => { e.stopPropagation(); state.handleStatusUpdate(order.id, OrderStatus.CONFIRMED); }} className="min-h-11 min-w-11 p-2 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100" title={t.confirmOrder || '确认订单'}><Check size={16} /></button>}
                                {order.status === OrderStatus.CONFIRMED && (
                                    <button aria-label={t.quickShip || '快速发货'} onClick={(e) => { e.stopPropagation(); state.handleQuickShip(order); }} className="min-h-11 min-w-11 p-2 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-100" title={t.quickShip || '快速发货'}>
                                        <Truck size={16} />
                                    </button>
                                )}
                                {order.fulfillmentStatus === 'delivered' && order.financialStatus === 'paid' && (currentUser?.role === 'admin' || currentUser?.role === 'manager') && (
                                    <button aria-label={t.completeOrder || '完成订单'} onClick={(e) => { e.stopPropagation(); state.handleManualComplete(order.id); }} className="min-h-11 min-w-11 p-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 hover:ring-2 hover:ring-emerald-300 shadow-lg" title={t.completeOrder || '完成订单'}>
                                        <CheckCircle2 size={16} />
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                    );
                }}
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
                canOpenPromise={state.canOpenCollectionPromise}
                canOpenDispute={state.canOpenCollectionDispute}
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
                userId={state.currentUser.id}
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
                isSaving={state.isSavingOrder}
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
                orderLineErrors={state.orderLineErrors}
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
