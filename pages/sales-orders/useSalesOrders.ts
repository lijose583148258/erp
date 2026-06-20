import { useCallback, useMemo, useState, type ChangeEvent } from 'react';
import { useAppContext } from '../../app/AppContext';
import { orderService } from '../../services/order.service';
import freeAIService from '../../services/freeAIService';
import { ExtractedFormData, DocumentType, OcrDocumentData, parseOcrDocument } from '../../services/smartFormService';
import { SalesOrder, Customer, SalesOrderItem } from '../../types';
import type { CollectionActionMode, CollectionActionTarget } from '../../components/collections/CollectionActionModal';
import { applyOcrResultToForm, applySmartFillToForm, buildImportedSalesOrderPayloads, buildInventoryInsights, buildPriceSuggestions, buildSalesOrderSavePayload, createInitialPaymentForm, createProductScanOrderItem, getCollectionView, getFirstSalesOrderLineError, getOfflineProductScanCount, getOutstandingAmount, initialOrderForm, mergeOrderItemIntoDraft, saveOfflineProductScan, toNumericId, updateDimensionalItem, validateSalesOrderItems, type ImportedSalesOrderRow, type PaymentForm, type SalesOrderLineErrors } from './salesOrderFormHelpers';
import { useSalesOrderCommandShortcuts } from './useSalesOrderCommandShortcuts';
import { useSalesOrderNetworkStatus } from './useSalesOrderNetworkStatus';
import { getSalesOrderCustomerLabel, getSalesOrderCustomerLabelFromOrder } from './salesOrderLabels';
import { canAuditCommissionForUser, canCreateOrderForUser, canEditSalesOrderForUser, canRecordPaymentForUser, canVerifyPaymentForUser } from './salesOrderPermissions';
import { useSalesOrderWorkspaceData } from './useSalesOrderWorkspaceData';
import { useSalesOrderPayments } from './useSalesOrderPayments';
import { useSalesOrderActions } from './useSalesOrderActions';
import { useSalesOrderDraft } from './useSalesOrderDraft';
import { can } from '../../app/permissions';

export { createEmptySalesOrderItem, initialOrderForm, type SalesOrderFormData } from './salesOrderFormHelpers';
export const useSalesOrders = () => {
    const { t, formatPrice, currentUser, notify, language } = useAppContext();
    const [ocrDocType, setOcrDocType] = useState<DocumentType>('invoice');
    const [ocrText, setOcrText] = useState('');
    const [ocrResult, setOcrResult] = useState<OcrDocumentData | null>(null);
    const [isScanning, setIsScanning] = useState(false);
    const [creditInfo] = useState<{ limit: number; exposure: number; usage: number; status: string } | null>(null);
    const isOffline = useSalesOrderNetworkStatus();

    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);
    const [isPaymentOpen, setIsPaymentOpen] = useState(false);
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const [historyTab, setHistoryTab] = useState<'payments' | 'audit'>('payments');
    const [collectionActionMode, setCollectionActionMode] = useState<CollectionActionMode | null>(null);
    const [collectionActionTarget, setCollectionActionTarget] = useState<CollectionActionTarget | null>(null);
    const [selectedOrder, setSelectedOrder] = useState<SalesOrder | null>(null);
    const [isManagerView, setIsManagerView] = useState(false);
    const [paymentForm, setPaymentForm] = useState<PaymentForm>(createInitialPaymentForm());
    const [orderLineErrors, setOrderLineErrors] = useState<SalesOrderLineErrors>({});
    const [isSavingOrder, setIsSavingOrder] = useState(false);

    const {
        orders,
        setOrders,
        customers,
        batches,
        contracts,
        upsertOrder,
        hydrateOrderDetail,
        refreshSelectedOrder,
        loadOrderWorkspace,
    } = useSalesOrderWorkspaceData({
        notify,
        t,
        selectedOrder,
        setSelectedOrder,
    });

    const getCustomerLabel = (customer?: Pick<Customer, 'name' | 'nameZh' | 'nameEn' | 'nameVi' | 'displayName'> | null) => getSalesOrderCustomerLabel(customer, language);
    const getOrderCustomerLabel = getSalesOrderCustomerLabelFromOrder;

    const {
        draftAvailable,
        formData,
        setFormData,
        totals,
        updateOrderHeader,
        replaceOrderItems,
        updateOrderItem,
        addOrderItem,
        duplicateOrderItem,
        removeOrderItem,
        importOrderItemsFromGrid,
        loadDraft,
        clearDraft,
    } = useSalesOrderDraft({
        isCreateOpen,
        isEditMode,
        orderId: selectedOrder?.id,
        userId: currentUser.id,
        notify,
    });

    const canAuditCommission = canAuditCommissionForUser(currentUser);
    const canRecordPayment = canRecordPaymentForUser(currentUser);
    const canVerifyPayment = canVerifyPaymentForUser(currentUser);
    const canCreateOrder = canCreateOrderForUser(currentUser);
    const canOpenCollectionPromise = can(currentUser, 'collections.promise.write');
    const canOpenCollectionDispute = can(currentUser, 'collections.dispute.write');
    const canEditOrder = (order: SalesOrder) => canEditSalesOrderForUser(currentUser, order);
    const {
        handleCommissionAudit,
        handleStatusUpdate,
        handleQuickShip,
        handleManualComplete,
    } = useSalesOrderActions({
        canAuditCommission,
        notify,
        setOrders,
        upsertOrder,
    });
    const {
        openPaymentModal,
        handleVerifyPayment,
        handleRecordPayment,
    } = useSalesOrderPayments({
        selectedOrder,
        paymentForm,
        currentUser,
        canVerifyPayment,
        formatPrice,
        notify,
        setSelectedOrder,
        setPaymentForm,
        setIsPaymentOpen,
        hydrateOrderDetail,
        upsertOrder,
    });

    const displayedOrders = useMemo(() => orders, [orders]);

    const priceSuggestions = useMemo(() => {
        return buildPriceSuggestions(formData.items, formData.paymentTermsDays, t.unknownProduct, (index, unitPrice) => {
            setFormData(prev => ({
                ...prev,
                items: prev.items.map((item, itemIndex) => itemIndex === index ? { ...item, unitPrice } : item),
            }));
        });
    }, [formData.items, formData.paymentTermsDays, setFormData, t.unknownProduct]);

    const inventoryInsights = useMemo(() => {
        return buildInventoryInsights(formData.items, batches, t.unknownProduct);
    }, [formData.items, batches, t.unknownProduct]);

    const clearOrderLineError = (index?: number) => {
        if (index === undefined) {
            setOrderLineErrors({});
            return;
        }
        setOrderLineErrors(prev => {
            if (!prev[index]) return prev;
            const next = { ...prev };
            delete next[index];
            return next;
        });
    };

    const handleUpdateOrderItem = (index: number, patch: Partial<SalesOrderItem>) => {
        clearOrderLineError(index);
        updateOrderItem(index, patch);
    };

    const handleAddOrderItem = (seed?: Partial<SalesOrderItem>) => {
        clearOrderLineError();
        addOrderItem(seed);
    };

    const handleDuplicateOrderItem = (index: number) => {
        clearOrderLineError();
        duplicateOrderItem(index);
    };

    const handleRemoveOrderItem = (index: number) => {
        clearOrderLineError();
        removeOrderItem(index);
    };

    const handleImportOrderItemsFromGrid = (rawText: string) => {
        clearOrderLineError();
        importOrderItemsFromGrid(rawText);
    };

    const handleSmartFill = (data: ExtractedFormData) => {
        setFormData(prev => applySmartFillToForm(prev, data));
    };

    const handleOcrParse = () => {
        if (!ocrText.trim()) {
            notify('warning', t.ocrMissingText);
            return;
        }
        if (ocrText.length > 10000) {
            notify('error', `OCR 文本已超出 ${ocrText.length - 10000} 个字符，请精简后再解析。`);
            return;
        }
        const parsed = parseOcrDocument(ocrText, ocrDocType);
        setOcrResult(parsed);
    };

    const handleApplyOcr = () => {
        if (!ocrResult) return;
        setFormData(prev => applyOcrResultToForm(prev, ocrResult, customers));
        setOcrResult(null);
        setOcrText('');
        notify('success', t.ocrApplied);
    };

    const handleProductScan = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setIsScanning(true);
        try {
            if (!navigator.onLine) {
                notify('warning', t.offlineMode || '当前为离线模式，已记录文件名；请联网后重新上传图片完成识别。');
                saveOfflineProductScan(file.name, currentUser.id);
                return;
            }
            const result = await freeAIService.analyzeProductLabel(file);
            const newItem = createProductScanOrderItem(result);
            setFormData(prev => ({ ...prev, items: mergeOrderItemIntoDraft(prev.items, newItem) }));
            notify('success', t.scanSuccess || '扫描成功');
        } catch {
            notify('error', t.scanFail || '扫描失败');
        } finally {
            setIsScanning(false);
        }
    };

    const syncOfflineData = () => {
        const offlineScanCount = getOfflineProductScanCount(currentUser.id);
        if (offlineScanCount === 0) {
            notify('info', t.noOfflineData || '没有可同步的离线数据');
            return;
        }
        if (!navigator.onLine) {
            notify('warning', '当前离线，无法同步离线扫描记录。');
            return;
        }
        notify('warning', '发现 ' + offlineScanCount + ' 条离线扫描记录；离线模式只保存文件名，请重新上传原图完成识别。');
    };

    const handleImport = async (newData: ImportedSalesOrderRow[]) => {
        try {
            const importPayloads = buildImportedSalesOrderPayloads(newData, customers, getCustomerLabel, currentUser.id);
            const newOrdersPromises = importPayloads.map((payload) => orderService.create(payload));
            const createdOrders = await Promise.all(newOrdersPromises);
            setOrders(prev => [...createdOrders, ...prev]);
            notify('success', '已成功导入 ' + createdOrders.length + ' 条订单。');
        } catch {
            notify('error', '订单导入失败，请检查 Excel 格式。');
        }
    };

    const handleSaveOrder = async () => {
        if (isSavingOrder) return;
        if (!formData.customerId) {
            notify('error', '请选择客户。');
            return;
        }
        if (formData.notes.length > 1000) {
            notify('error', `订单备注已超出 ${formData.notes.length - 1000} 个字符，请精简后再保存。`);
            return;
        }
        const nextLineErrors = validateSalesOrderItems(formData.items);
        if (Object.keys(nextLineErrors).length) {
            setOrderLineErrors(nextLineErrors);
            const firstError = getFirstSalesOrderLineError(nextLineErrors);
            const firstMessage = firstError?.messages[0] || '请补全订单明细';
            notify('error', firstError ? `第 ${firstError.index + 1} 行未完成：${firstMessage}` : '请补全订单明细');
            return;
        }
        const normalizedCustomerId = Number(formData.customerId);
        const customer = customers.find(c => Number(c.id) === normalizedCustomerId);
        const orderPayload = buildSalesOrderSavePayload({
            formData,
            isEditMode,
            selectedOrder,
            customer,
            customerLabel: getCustomerLabel(customer) || '',
            currentUser,
            totals,
        });

        setIsSavingOrder(true);
        try {
            let savedOrder: SalesOrder;
            if (isEditMode) {
                savedOrder = await orderService.update(orderPayload, currentUser.name);
                upsertOrder(savedOrder);
                notify('success', '订单更新成功，变更已记录。');
            } else {
                savedOrder = await orderService.create(orderPayload);
                upsertOrder(savedOrder);
                notify('success', '销售订单创建成功。');
            }
            clearDraft();
            setOrderLineErrors({});
            setIsCreateOpen(false);
            setFormData(initialOrderForm);
        } catch (error) {
            notify('error', error instanceof Error ? `订单保存失败：${error.message}` : '订单保存失败，请检查网络或稍后重试。');
        } finally {
            setIsSavingOrder(false);
        }
    };

    const openCreateModal = useCallback(() => {
        setFormData(initialOrderForm);
        setOrderLineErrors({});
        setIsEditMode(false);
        setIsCreateOpen(true);
    }, [setFormData]);

    const openEditModal = async (order: SalesOrder) => {
        const detailedOrder = await hydrateOrderDetail(order);
        setSelectedOrder(detailedOrder);
        setFormData({
            id: detailedOrder.id,
            customerId: detailedOrder.customerId,
            taxInclusive: detailedOrder.taxInclusive,
            paymentTermsDays: detailedOrder.paymentTermsDays,
            items: detailedOrder.items.map(i => ({ ...i })),
            extraItems: detailedOrder.extraItems ? detailedOrder.extraItems.map(i => ({ ...i })) : [],
            notes: detailedOrder.notes || '',
            contractId: detailedOrder.contractId ?? '',
            commissionRateSubmitted: 3,
            commissionAmount: detailedOrder.commissionAmount || 0,
        });
        setOrderLineErrors({});
        setIsEditMode(true);
        setIsCreateOpen(true);
    };

    useSalesOrderCommandShortcuts({ openCreateModal, setOcrDocType, setOcrText, setOcrResult });

    const openHistoryModal = async (order: SalesOrder) => {
        const detailedOrder = await hydrateOrderDetail(order);
        setSelectedOrder(detailedOrder);
        setHistoryTab('payments');
        setIsHistoryOpen(true);
    };

    const openCollectionAction = (mode: CollectionActionMode, order: SalesOrder) => {
        setCollectionActionMode(mode);
        setCollectionActionTarget({
            customerId: toNumericId(order.customerId),
            customerName: getOrderCustomerLabel(order) || order.customerName,
            orderId: toNumericId(order.id),
            orderNo: order.id,
            outstanding: getOutstandingAmount(order),
        });
    };

    return {
        t,
        language,
        formatPrice,
        currentUser,
        notify,
        loadOrderWorkspace,
        orders,
        customers,
        batches,
        ocrDocType,
        setOcrDocType,
        ocrText,
        setOcrText,
        ocrResult,
        setOcrResult,
        contracts,
        isScanning,
        creditInfo,
        draftAvailable,
        isOffline,
        isCreateOpen,
        setIsCreateOpen,
        isEditMode,
        setIsEditMode,
        isPaymentOpen,
        setIsPaymentOpen,
        isHistoryOpen,
        setIsHistoryOpen,
        historyTab,
        setHistoryTab,
        collectionActionMode,
        setCollectionActionMode,
        collectionActionTarget,
        setCollectionActionTarget,
        selectedOrder,
        setSelectedOrder,
        isManagerView,
        setIsManagerView,
        paymentForm,
        setPaymentForm,
        formData,
        setFormData,
        updateOrderHeader,
        replaceOrderItems,
        updateOrderItem: handleUpdateOrderItem,
        addOrderItem: handleAddOrderItem,
        duplicateOrderItem: handleDuplicateOrderItem,
        removeOrderItem: handleRemoveOrderItem,
        importOrderItemsFromGrid: handleImportOrderItemsFromGrid,
        orderLineErrors,
        isSavingOrder,
        displayedOrders,
        canAuditCommission,
        canRecordPayment,
        canVerifyPayment,
        canCreateOrder,
        canOpenCollectionPromise,
        canOpenCollectionDispute,
        canEditOrder,
        getOutstandingAmount,
        getCollectionView,
        totals,
        priceSuggestions,
        inventoryInsights,
        handleSmartFill,
        handleOcrParse,
        handleApplyOcr,
        handleProductScan,
        syncOfflineData,
        loadDraft,
        clearDraft,
        handleCommissionAudit,
        handleStatusUpdate,
        handleImport,
        handleSaveOrder,
        openCreateModal,
        openEditModal,
        openPaymentModal,
        openHistoryModal,
        handleVerifyPayment,
        handleRecordPayment,
        openCollectionAction,
        refreshSelectedOrder,
        updateDimensionalItem,
        handleQuickShip,
        handleManualComplete,
    };
};
