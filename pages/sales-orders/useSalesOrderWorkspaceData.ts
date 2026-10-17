import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { assetService, ProductBatch } from '../../services/asset.service';
import { contractService } from '../../services/contract.service';
import { customerService } from '../../src/services/customer.service';
import { orderService } from '../../src/services/order.service';
import { Customer, SalesOrder } from '../../types';
import { serverStateClient } from '../../app/serverState';
import { useAppContext } from '../../app/AppContext';
import { can } from '../../app/permissions';

type ListMeta = {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
};

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

const SALES_ORDER_WORKSPACE_TTL_MS = 20_000;
const ORDER_PAGE_QUERY_KEY = ['sales-orders', 'page', 1, 30] as const;
const CUSTOMER_LOOKUP_QUERY_KEY = ['customers', 'lookup', 1, 100] as const;
const ACTIVE_CONTRACTS_QUERY_KEY = ['contracts', 'active'] as const;

export const invalidateSalesOrderWorkspaceState = () => {
    serverStateClient.invalidateQueries(['sales-orders']);
    serverStateClient.invalidateQueries(['customers']);
    serverStateClient.invalidateQueries(['contracts']);
};

export const useSalesOrderWorkspaceData = ({
    notify,
    t,
    selectedOrder,
    setSelectedOrder,
}: UseSalesOrderWorkspaceDataOptions) => {
    const { currentUser } = useAppContext();
    const canReadContracts = can(currentUser, 'contracts.read');
    const canReadAssets = can(currentUser, 'assets.read');
    const scopeKey = JSON.stringify([currentUser.id, currentUser.role,
        [...(currentUser.permissions || [])].sort(), [...(currentUser.dataScopes || [])].sort()]);
    const scopeRef = useRef({ key: scopeKey });
    if (scopeRef.current.key !== scopeKey) scopeRef.current = { key: scopeKey };
    const selectedScopeRef = useRef(scopeKey);
    const [workspaceOwner, setWorkspaceOwner] = useState<object | null>(null);
    const [batchOwner, setBatchOwner] = useState<object | null>(null);
    const [orders, setOrders] = useState<SalesOrder[]>([]);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [batches, setBatches] = useState<ProductBatch[]>([]);
    const [contracts, setContracts] = useState<any[]>([]);
    const [orderPageMeta, setOrderPageMeta] = useState<ListMeta>({ page: 1, pageSize: 30, total: 0, totalPages: 1 });
    const [customerLookupMeta, setCustomerLookupMeta] = useState<ListMeta>({ page: 1, pageSize: 100, total: 0, totalPages: 1 });

    useEffect(() => () => { scopeRef.current = { key: scopeRef.current.key }; }, []);

    useEffect(() => {
        setOrders([]);
        setCustomers([]);
        setContracts([]);
        setBatches([]);
        if (selectedScopeRef.current !== scopeKey) setSelectedOrder(null);
        selectedScopeRef.current = scopeKey;
    }, [scopeKey, setSelectedOrder]);

    const upsertOrder = useCallback((nextOrder: SalesOrder) => {
        setOrders(prev => {
            const exists = prev.some(order => order.id === nextOrder.id);
            return exists
                ? prev.map(order => order.id === nextOrder.id ? nextOrder : order)
                : [nextOrder, ...prev];
        });
    }, []);

    const hydrateOrderDetail = useCallback(async (order: SalesOrder) => {
        const scope = scopeRef.current;
        if (scope.key !== scopeKey) return null;
        try {
            const detailedOrder = await orderService.getById(order.id);
            if (scopeRef.current !== scope) return null;
            upsertOrder(detailedOrder);
            return detailedOrder;
        } catch {
            if (scopeRef.current !== scope) return null;
            notify('warning', '订单详情拉取失败，当前先使用列表快照。');
            return order;
        }
    }, [notify, scopeKey, upsertOrder]);

    const refreshSelectedOrder = useCallback(async (orderId = selectedOrder?.id) => {
        if (!orderId) return null;
        const scope = scopeRef.current;
        if (scope.key !== scopeKey) return null;
        try {
            const detailedOrder = await orderService.getById(orderId);
            if (scopeRef.current !== scope) return null;
            upsertOrder(detailedOrder);
            setSelectedOrder(detailedOrder);
            return detailedOrder;
        } catch (error) {
            if (scopeRef.current !== scope) return null;
            throw error;
        }
    }, [scopeKey, selectedOrder?.id, setSelectedOrder, upsertOrder]);

    const loadOrderWorkspace = useCallback(async (options: { force?: boolean } = {}) => {
        const scope = scopeRef.current;
        if (scope.key !== scopeKey) return [];
        const force = Boolean(options.force);
        const [ordersResult, customersResult, contractsResult] = await Promise.allSettled([
            serverStateClient.fetchQuery({
                key: [...ORDER_PAGE_QUERY_KEY, scopeKey],
                ttlMs: SALES_ORDER_WORKSPACE_TTL_MS,
                force,
                queryFn: ({ signal }) => orderService.getPage({ page: 1, pageSize: 30 }, { signal }),
            }),
            serverStateClient.fetchQuery({
                key: [...CUSTOMER_LOOKUP_QUERY_KEY, scopeKey],
                ttlMs: SALES_ORDER_WORKSPACE_TTL_MS,
                force,
                queryFn: ({ signal }) => customerService.getPage({ page: 1, pageSize: 100 }, { signal }),
            }),
            canReadContracts ? serverStateClient.fetchQuery({
                key: [...ACTIVE_CONTRACTS_QUERY_KEY, scopeKey],
                ttlMs: SALES_ORDER_WORKSPACE_TTL_MS,
                force,
                queryFn: () => contractService.getContracts({ status: 'active' }),
            }) : Promise.resolve({ contracts: [] }),
        ]);

        if (scopeRef.current !== scope) return [];

        const nextOrders = ordersResult.status === 'fulfilled' ? ordersResult.value.rows : [];
        const nextCustomers = customersResult.status === 'fulfilled' ? customersResult.value.rows : [];
        const nextContracts = contractsResult.status === 'fulfilled' ? (contractsResult.value?.contracts || []) : [];

        setOrders(nextOrders);
        setCustomers(nextCustomers);
        setContracts(nextContracts);
        setWorkspaceOwner(scope);
        if (ordersResult.status === 'fulfilled') {
            setOrderPageMeta({
                page: ordersResult.value.page,
                pageSize: ordersResult.value.pageSize,
                total: ordersResult.value.total,
                totalPages: ordersResult.value.totalPages,
            });
        }
        if (customersResult.status === 'fulfilled') {
            setCustomerLookupMeta({
                page: customersResult.value.page,
                pageSize: customersResult.value.pageSize,
                total: customersResult.value.total,
                totalPages: customersResult.value.totalPages,
            });
        }

        if (ordersResult.status === 'rejected' || customersResult.status === 'rejected' || contractsResult.status === 'rejected') {
            notify('warning', t.orderWorkspacePartialLoadFailed || '订单工作台部分数据加载失败，已显示可用数据。');
        }

        return nextOrders;
    }, [canReadContracts, notify, scopeKey, t.orderWorkspacePartialLoadFailed]);

    useEffect(() => {
        loadOrderWorkspace().catch(() => {
            notify('error', t.orderWorkspaceLoadFailed || '订单工作台加载失败。');
        });
    }, [loadOrderWorkspace, notify, t.orderWorkspaceLoadFailed]);

    useEffect(() => {
        if (!canReadAssets) return;
        const scope = scopeRef.current;
        let cancelled = false;
        assetService.getBatches().then(rows => {
            if (cancelled || scopeRef.current !== scope) return;
            setBatches(rows);
            setBatchOwner(scope);
        }).catch(() => {
            if (cancelled || scopeRef.current !== scope) return;
            setBatches([]);
            notify('warning', t.orderWorkspacePartialLoadFailed || '订单工作台部分数据加载失败，已显示可用数据。');
        });
        return () => { cancelled = true; };
    }, [canReadAssets, notify, scopeKey, t.orderWorkspacePartialLoadFailed]);

    return {
        orders: workspaceOwner === scopeRef.current ? orders : [],
        setOrders,
        orderPageMeta,
        customers: workspaceOwner === scopeRef.current ? customers : [],
        customerLookupMeta,
        batches: canReadAssets && batchOwner === scopeRef.current ? batches : [],
        contracts: canReadContracts && workspaceOwner === scopeRef.current ? contracts : [],
        upsertOrder,
        hydrateOrderDetail,
        refreshSelectedOrder,
        loadOrderWorkspace,
    };
};
