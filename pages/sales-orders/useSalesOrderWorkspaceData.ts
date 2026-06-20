import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { assetService, ProductBatch } from '../../services/asset.service';
import { contractService } from '../../services/contract.service';
import { customerService } from '../../services/customer.service';
import { orderService } from '../../services/order.service';
import { Customer, SalesOrder } from '../../types';

type NotifyLevel = 'success' | 'error' | 'warning' | 'info';
export type NotifyFn = (level: NotifyLevel, message: string) => void;

type SalesOrderWorkspaceTranslations = {
    orderWorkspacePartialLoadFailed?: string;
    orderWorkspaceLoadFailed?: string;
};

type UseSalesOrderWorkspaceDataOptions = {
    notify: NotifyFn;
    t: SalesOrderWorkspaceTranslations;
    selectedOrder: SalesOrder | null;
    setSelectedOrder: Dispatch<SetStateAction<SalesOrder | null>>;
};

export const useSalesOrderWorkspaceData = ({
    notify,
    t,
    selectedOrder,
    setSelectedOrder,
}: UseSalesOrderWorkspaceDataOptions) => {
    const [orders, setOrders] = useState<SalesOrder[]>([]);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [batches, setBatches] = useState<ProductBatch[]>([]);
    const [contracts, setContracts] = useState<any[]>([]);

    const upsertOrder = useCallback((nextOrder: SalesOrder) => {
        setOrders(prev => {
            const exists = prev.some(order => order.id === nextOrder.id);
            return exists
                ? prev.map(order => order.id === nextOrder.id ? nextOrder : order)
                : [nextOrder, ...prev];
        });
    }, []);

    const hydrateOrderDetail = useCallback(async (order: SalesOrder) => {
        try {
            const detailedOrder = await orderService.getById(order.id);
            upsertOrder(detailedOrder);
            return detailedOrder;
        } catch {
            notify('warning', '订单详情拉取失败，当前先使用列表快照。');
            return order;
        }
    }, [notify, upsertOrder]);

    const refreshSelectedOrder = useCallback(async (orderId = selectedOrder?.id) => {
        if (!orderId) return null;
        const detailedOrder = await orderService.getById(orderId);
        upsertOrder(detailedOrder);
        setSelectedOrder(detailedOrder);
        return detailedOrder;
    }, [selectedOrder?.id, setSelectedOrder, upsertOrder]);

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

    return {
        orders,
        setOrders,
        customers,
        batches,
        contracts,
        upsertOrder,
        hydrateOrderDetail,
        refreshSelectedOrder,
        loadOrderWorkspace,
    };
};
