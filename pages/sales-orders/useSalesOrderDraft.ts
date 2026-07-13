import { useEffect, useMemo, useRef, useState } from 'react';
import type { SalesOrderItem } from '../../types';
import {
    calculateOrderTotals,
    createEmptySalesOrderItem,
    initialOrderForm,
    normalizeOrderItem,
    parseOrderItemsFromGrid,
    type SalesOrderFormData,
} from './salesOrderFormHelpers';
import type { NotifyFn } from './useSalesOrderWorkspaceData';

type UseSalesOrderDraftOptions = {
    isCreateOpen: boolean;
    isEditMode: boolean;
    orderId?: string | null;
    userId: string;
    notify: NotifyFn;
};

const draftKeyFor = (userId: string, isEditMode: boolean, orderId?: string | null) =>
    `ailao.salesOrderDraft.${userId || 'anonymous'}.${isEditMode && orderId ? `edit.${orderId}` : 'create'}`;

export const useSalesOrderDraft = ({ isCreateOpen, isEditMode, orderId, userId, notify }: UseSalesOrderDraftOptions) => {
    const [draftAvailable, setDraftAvailable] = useState(false);
    const [formData, setFormData] = useState<SalesOrderFormData>(initialOrderForm);
    const totals = useMemo(() => calculateOrderTotals(formData), [formData]);
    const draftKey = draftKeyFor(userId, isEditMode, orderId);
    const baselineRef = useRef('');
    const formDataRef = useRef(formData);

    useEffect(() => {
        formDataRef.current = formData;
    }, [formData]);

    useEffect(() => {
        if (!isCreateOpen) return;
        baselineRef.current = JSON.stringify(formDataRef.current);
        const saved = localStorage.getItem(draftKey);
        setDraftAvailable(Boolean(saved));
    }, [draftKey, isCreateOpen]);

    useEffect(() => {
        if (!isCreateOpen) return;
        const serialized = JSON.stringify(formData);
        if (!baselineRef.current || serialized === baselineRef.current) return;
        const timer = window.setTimeout(() => {
            localStorage.setItem(draftKey, serialized);
            setDraftAvailable(true);
        }, 800);
        return () => window.clearTimeout(timer);
    }, [draftKey, formData, isCreateOpen]);

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

    const loadDraft = () => {
        const saved = localStorage.getItem(draftKey);
        if (!saved) return;
        try {
            const parsed = JSON.parse(saved);
            setFormData({ ...initialOrderForm, ...parsed });
        } catch {
            setDraftAvailable(false);
        }
    };

    const clearDraft = () => {
        localStorage.removeItem(draftKey);
        setDraftAvailable(false);
    };

    return {
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
    };
};
