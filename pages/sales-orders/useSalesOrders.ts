import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useAppContext } from '../../app/AppContext';
import { orderService } from '../../services/order.service';
import { customerService } from '../../services/customer.service';
import { contractService } from '../../services/contract.service';
import freeAIService from '../../services/freeAIService';
import { assetService, ProductBatch } from '../../services/asset.service';
import { ExtractedFormData, DocumentType, OcrDocumentData, parseOcrDocument } from '../../services/smartFormService';
import { SalesOrder, OrderStatus, CommissionStatus, SalesOrderItem, Customer, PaymentRecord } from '../../types';
import type { CollectionActionMode, CollectionActionTarget } from '../../components/collections/CollectionActionModal';
import { applyOcrResultToForm, applySmartFillToForm, buildImportedSalesOrderPayloads, buildInventoryInsights, buildPriceSuggestions, calculateOrderTotals, createEmptySalesOrderItem, createInitialPaymentForm, createProductScanOrderItem, getCollectionView, getOfflineProductScanCount, getOutstandingAmount, initialOrderForm, mergeOrderItemIntoDraft, normalizeOrderItem, parseOrderItemsFromGrid, saveOfflineProductScan, toNumericId, updateDimensionalItem, type ImportedSalesOrderRow, type PaymentForm, type SalesOrderFormData } from './salesOrderFormHelpers';
import { useSalesOrderCommandShortcuts } from './useSalesOrderCommandShortcuts';
import { useSalesOrderNetworkStatus } from './useSalesOrderNetworkStatus';
import { getSalesOrderCustomerLabel, getSalesOrderCustomerLabelFromOrder } from './salesOrderLabels';
import { canAuditCommissionRole, canCreateOrderRole, canEditSalesOrderForUser, canRecordPaymentRole, canVerifyPaymentRole } from './salesOrderPermissions';

export { createEmptySalesOrderItem, initialOrderForm, type SalesOrderFormData } from './salesOrderFormHelpers';
export const useSalesOrders = () => {
    const { t, formatPrice, currentUser, notify, language } = useAppContext();
    const [orders, setOrders] = useState<SalesOrder[]>([]);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [batches, setBatches] = useState<ProductBatch[]>([]);
    const [ocrDocType, setOcrDocType] = useState<DocumentType>('invoice');
    const [ocrText, setOcrText] = useState('');
    const [ocrResult, setOcrResult] = useState<OcrDocumentData | null>(null);
    const [contracts, setContracts] = useState<any[]>([]);
    const [isScanning, setIsScanning] = useState(false);
    const [creditInfo] = useState<{ limit: number; exposure: number; usage: number; status: string } | null>(null);
    const [draftAvailable, setDraftAvailable] = useState(false);
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
    const [formData, setFormData] = useState<SalesOrderFormData>(initialOrderForm);

    const getCustomerLabel = (customer?: Pick<Customer, 'name' | 'nameZh' | 'nameEn' | 'nameVi' | 'displayName'> | null) => getSalesOrderCustomerLabel(customer, language);
    const getOrderCustomerLabel = getSalesOrderCustomerLabelFromOrder;

    const upsertOrder = (nextOrder: SalesOrder) => {
        setOrders(prev => {
            const exists = prev.some(order => order.id === nextOrder.id);
            return exists
                ? prev.map(order => order.id === nextOrder.id ? nextOrder : order)
                : [nextOrder, ...prev];
        });
    };

    const hydrateOrderDetail = async (order: SalesOrder) => {
        try {
            const detailedOrder = await orderService.getById(order.id);
            upsertOrder(detailedOrder);
            return detailedOrder;
        } catch {
            notify('warning', '订单详情拉取失败，当前先使用列表快照。');
            return order;
        }
    };

    const refreshSelectedOrder = async (orderId = selectedOrder?.id) => {
        if (!orderId) return null;
        const detailedOrder = await orderService.getById(orderId);
        upsertOrder(detailedOrder);
        setSelectedOrder(detailedOrder);
        return detailedOrder;
    };

    const loadOrderWorkspace = useCallback(async () => {
        const [ordersResult, customersResult, contractsResult] = await Promise.allSettled([
            orderService.getAll(),
            customerService.getAll(),
            contractService.getContracts({ status: 'active' }),
        ]);

        const nextOrders = ordersResult.status === 'fulfilled' ? ordersResult.value : [];
        const nextCustomers = customersResult.status === 'fulfilled' ? customersResult.value : [];
        const nextContracts = contractsResult.status === 'fulfilled' ? (contractsResult.value?.contracts || []) : [];

        setOrders(nextOrders);
        setCustomers(nextCustomers);
        setContracts(nextContracts);

        if (ordersResult.status === 'rejected' || customersResult.status === 'rejected' || contractsResult.status === 'rejected') {
            notify('warning', t.orderWorkspacePartialLoadFailed || '订单工作台部分数据加载失败，已显示可用数据。');
        }

        return nextOrders;
    }, [notify, t.orderWorkspacePartialLoadFailed]);

    useEffect(() => {
        loadOrderWorkspace().catch(() => {
            notify('error', t.orderWorkspaceLoadFailed || '订单工作台加载失败。');
        });
    }, [loadOrderWorkspace, notify, t.orderWorkspaceLoadFailed]);

    useEffect(() => {
        assetService.getBatches().then(setBatches).catch(() => setBatches([]));
    }, []);

    useEffect(() => {
        if (!isCreateOpen) return;
        const saved = localStorage.getItem('orderDraft');
        setDraftAvailable(Boolean(saved));
    }, [isCreateOpen]);

    const canAuditCommission = canAuditCommissionRole(currentUser.role);
    const canRecordPayment = canRecordPaymentRole(currentUser.role);
    const canVerifyPayment = canVerifyPaymentRole(currentUser.role);
    const canCreateOrder = canCreateOrderRole(currentUser.role);
    const canEditOrder = (order: SalesOrder) => canEditSalesOrderForUser(currentUser, order);

    const displayedOrders = useMemo(() => orders, [orders]);

    const totals = useMemo(() => calculateOrderTotals(formData), [formData]);

    const updateOrderHeader = <K extends keyof SalesOrderFormData>(field: K, value: SalesOrderFormData[K]) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const replaceOrderItems = (items: SalesOrderItem[]) => {
        setFormData(prev => ({
            ...prev,
            items: (items.length ? items : [createEmptySalesOrderItem()]).map(normalizeOrderItem),
        }));
    };

    const updateOrderItem = (index: number, patch: Partial<SalesOrderItem>) => {
        setFormData(prev => {
            const items = [...prev.items];
            const current = items[index] || createEmptySalesOrderItem();
            items[index] = normalizeOrderItem({ ...current, ...patch });
            return { ...prev, items };
        });
    };

    const addOrderItem = (seed?: Partial<SalesOrderItem>) => {
        setFormData(prev => ({
            ...prev,
            items: [...prev.items, normalizeOrderItem({ ...createEmptySalesOrderItem(), ...seed })],
        }));
    };

    const duplicateOrderItem = (index: number) => {
        setFormData(prev => {
            const source = prev.items[index];
            if (!source) return prev;
            const duplicated = normalizeOrderItem({ ...source });
            const items = [...prev.items];
            items.splice(index + 1, 0, duplicated);
            return { ...prev, items };
        });
    };

    const removeOrderItem = (index: number) => {
        setFormData(prev => {
            const items = prev.items.filter((_, itemIndex) => itemIndex !== index);
            return {
                ...prev,
                items: items.length ? items : [createEmptySalesOrderItem()],
            };
        });
    };

    const importOrderItemsFromGrid = (rawText: string) => {
        if (!rawText.trim()) {
            notify('warning', '请先粘贴 Excel 行数据。');
            return;
        }

        const parsedItems = parseOrderItemsFromGrid(rawText);

        if (!parsedItems.length) {
            notify('warning', '未识别到可导入的明细行。');
            return;
        }

        replaceOrderItems(parsedItems);
        notify('success', '已导入 ' + parsedItems.length + ' 条订单明细。');
    };

    const priceSuggestions = useMemo(() => {
        return buildPriceSuggestions(formData.items, formData.paymentTermsDays, t.unknownProduct, (index, unitPrice) => {
            setFormData(prev => ({
                ...prev,
                items: prev.items.map((item, itemIndex) => itemIndex === index ? { ...item, unitPrice } : item),
            }));
        });
    }, [formData.items, formData.paymentTermsDays, t.unknownProduct]);

    const inventoryInsights = useMemo(() => {
        return buildInventoryInsights(formData.items, batches, t.unknownProduct);
    }, [formData.items, batches, t.unknownProduct]);

    const handleSmartFill = (data: ExtractedFormData) => {
        setFormData(prev => applySmartFillToForm(prev, data));
    };

    const handleOcrParse = () => {
        if (!ocrText.trim()) {
            notify('warning', t.ocrMissingText);
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
                saveOfflineProductScan(file.name);
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
        const offlineScanCount = getOfflineProductScanCount();
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

    const loadDraft = () => {
        const saved = localStorage.getItem('orderDraft');
        if (!saved) return;
        try {
            const parsed = JSON.parse(saved);
            setFormData({ ...initialOrderForm, ...parsed });
            setDraftAvailable(false);
        } catch {
            setDraftAvailable(false);
        }
    };

    const clearDraft = () => {
        localStorage.removeItem('orderDraft');
        setDraftAvailable(false);
    };

    const handleCommissionAudit = async (id: string, status: CommissionStatus) => {
        if (!canAuditCommission) {
            notify('error', '权限不足：仅管理员和业务经理可审核佣金。');
            return;
        }
        await orderService.auditCommission(id, status);
        setOrders(prev => prev.map(o => o.id === id ? { ...o, commissionStatus: status } : o));
        notify(status === CommissionStatus.APPROVED ? 'success' : 'warning', '佣金审核状态已更新：' + status);
    };

    const handleStatusUpdate = async (id: string, newStatus: OrderStatus) => {
        const updatedOrder = await orderService.updateStatus(id, newStatus);
                upsertOrder(updatedOrder);
                notify('success', '订单状态已更新为：' + newStatus);
    };

    const handleQuickShip = (order: SalesOrder) => {
        // Route to shipping with enough context for the creation page to prefill.
        const params = new URLSearchParams({
            sourceOrderId: order.id,
            customerId: String(order.customerId),
            orderNo: order.id,
            productName: order.items[0]?.productName || '',
            quantity: String(order.items.reduce((sum, item) => sum + (item.quantity || 0), 0)),
        });
        window.location.hash = '#/shipping?' + params.toString();
        notify('info', '正在跳转到发货单创建页面，已携带订单信息。');
    };

    const handleManualComplete = async (id: string) => {
        try {
            const res = await fetch('/api/orders/' + id + '/complete', {
                method: 'PUT',
                headers: {
                    'Authorization': 'Bearer ' + localStorage.getItem('token'),
                    'Content-Type': 'application/json'
                }
            });
            const result = await res.json();
            if (result.success) {
                setOrders(prev => prev.map(o => o.id === id ? result.data ?? { ...o, status: OrderStatus.DELIVERED } : o));
                notify('success', '订单结案成功。');
            } else {
                notify('error', '结案失败: ' + result.message);
            }
        } catch {
            notify('error', '结案请求失败，请检查网络。');
        }
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
        if (!formData.customerId) {
            notify('error', '请选择客户。');
            return;
        }
        const normalizedCustomerId = Number(formData.customerId);
        const customer = customers.find(c => Number(c.id) === normalizedCustomerId);
        const orderPayload: SalesOrder = {
            id: isEditMode ? formData.id : '',
            customerId: String(normalizedCustomerId),
            customerName: getCustomerLabel(customer) || customer?.name || 'Unknown',
            customerNameZh: customer?.nameZh,
            customerNameEn: customer?.nameEn,
            customerNameVi: customer?.nameVi,
            customerDisplayName: customer ? getCustomerLabel(customer) : undefined,
            orderDate: isEditMode && selectedOrder ? selectedOrder.orderDate : new Date().toISOString().split('T')[0],
            items: formData.items.map(it => ({ ...it, amount: (it.unitPrice * it.quantity) - (it.discount || 0) })),
            extraItems: formData.extraItems,
            notes: formData.notes,
            taxInclusive: formData.taxInclusive,
            discountTotal: totals.totalDiscount,
            taxTotal: totals.totalTax,
            paymentTermsDays: formData.paymentTermsDays,
            totalAmount: totals.grandTotal,
            paidAmount: isEditMode && selectedOrder ? selectedOrder.paidAmount : 0,
            paymentRecords: isEditMode && selectedOrder ? selectedOrder.paymentRecords : [],
            status: isEditMode && selectedOrder ? selectedOrder.status : OrderStatus.PENDING,
            paymentStatus: isEditMode && selectedOrder ? selectedOrder.paymentStatus : 'unpaid',
            commissionAmount: totals.estComm,
            commissionStatus: isEditMode && selectedOrder ? selectedOrder.commissionStatus : CommissionStatus.PENDING,
            salespersonId: isEditMode && selectedOrder ? selectedOrder.salespersonId : currentUser.id,
            historyLogs: isEditMode && selectedOrder ? selectedOrder.historyLogs : [],
        };

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
            localStorage.removeItem('orderDraft');
            setIsCreateOpen(false);
            setFormData(initialOrderForm);
        } catch {
            notify('error', '订单保存失败。');
        }
    };

    const openCreateModal = useCallback(() => {
        setFormData(initialOrderForm);
        setIsEditMode(false);
        setIsCreateOpen(true);
    }, []);

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
            commissionRateSubmitted: 3,
            commissionAmount: detailedOrder.commissionAmount || 0,
        });
        setIsEditMode(true);
        setIsCreateOpen(true);
    };

    useSalesOrderCommandShortcuts({ openCreateModal, setOcrDocType, setOcrText, setOcrResult });

    const openPaymentModal = async (order: SalesOrder) => {
        const detailedOrder = await hydrateOrderDetail(order);
        setSelectedOrder(detailedOrder);
        setPaymentForm({
            amount: Math.max(0, Number(detailedOrder.finalAmount || detailedOrder.totalAmount || 0) - Number(detailedOrder.paidAmount || 0)),
            date: new Date().toISOString().split('T')[0],
            method: 'Bank Transfer',
            isProxy: false,
            payerName: getOrderCustomerLabel(detailedOrder),
            note: '',
        });
        setIsPaymentOpen(true);
    };

    const openHistoryModal = async (order: SalesOrder) => {
        const detailedOrder = await hydrateOrderDetail(order);
        setSelectedOrder(detailedOrder);
        setHistoryTab('payments');
        setIsHistoryOpen(true);
    };

    const handleVerifyPayment = async (paymentId: string) => {
        if (!selectedOrder) return;
        try {
            const updatedOrder = await orderService.verifyPayment(selectedOrder.id, paymentId);
            upsertOrder(updatedOrder);
            setSelectedOrder(updatedOrder);
            notify('success', '收款已核验并同步到账本。');
        } catch {
            notify('error', '核验失败。');
        }
    };

    const handleRecordPayment = async () => {
        if (!selectedOrder) return;
        if (paymentForm.amount <= 0) {
            notify('error', '金额无效。');
            return;
        }
        const payment: PaymentRecord = {
            id: 'PAY-' + Date.now(),
            date: paymentForm.date,
            amount: Number(paymentForm.amount),
            method: paymentForm.method,
            isProxy: paymentForm.isProxy,
            payerName: paymentForm.isProxy ? paymentForm.payerName : getOrderCustomerLabel(selectedOrder),
            note: paymentForm.note,
            recordedBy: currentUser.name,
            status: 'pending',
            createdByRole: currentUser.role,
        };
        try {
            const updatedOrder = await orderService.recordPayment(selectedOrder.id, payment);
            upsertOrder(updatedOrder);
            setSelectedOrder(updatedOrder);
            setIsPaymentOpen(false);
            if (canVerifyPayment) {
                notify('success', '收款已登记，并已模拟通知管理员。');
            } else {
                notify('success', '收款已提交审核。');
            }
        } catch {
            notify('error', '收款登记失败。');
        }
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
        updateOrderItem,
        addOrderItem,
        duplicateOrderItem,
        removeOrderItem,
        importOrderItemsFromGrid,
        displayedOrders,
        canAuditCommission,
        canRecordPayment,
        canVerifyPayment,
        canCreateOrder,
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
