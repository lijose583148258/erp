import type { Dispatch, SetStateAction } from 'react';
import { orderService } from '../../src/services/order.service';
import { CommissionStatus, OrderStatus, type SalesOrder } from '../../types';
import { invalidateSalesOrderWorkspaceState, type NotifyFn } from './useSalesOrderWorkspaceData';

type UseSalesOrderActionsOptions = {
    canAuditCommission: boolean;
    notify: NotifyFn;
    setOrders: Dispatch<SetStateAction<SalesOrder[]>>;
    upsertOrder: (order: SalesOrder) => void;
};

export const useSalesOrderActions = ({
    canAuditCommission,
    notify,
    setOrders,
    upsertOrder,
}: UseSalesOrderActionsOptions) => {
    const handleCommissionAudit = async (id: string, status: CommissionStatus) => {
        if (!canAuditCommission) {
            notify('error', '权限不足：仅管理员和业务经理可审核佣金。');
            return;
        }
        await orderService.auditCommission(id, status);
        invalidateSalesOrderWorkspaceState();
        setOrders(prev => prev.map(order => order.id === id ? { ...order, commissionStatus: status } : order));
        notify(status === CommissionStatus.APPROVED ? 'success' : 'warning', '佣金审核状态已更新：' + status);
    };

    const handleStatusUpdate = async (id: string, newStatus: OrderStatus) => {
        const updatedOrder = await orderService.updateStatus(id, newStatus);
        invalidateSalesOrderWorkspaceState();
        upsertOrder(updatedOrder);
        notify('success', '订单状态已更新为：' + newStatus);
    };

    const handleQuickShip = (order: SalesOrder) => {
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
            const completed = await orderService.complete(id);
            invalidateSalesOrderWorkspaceState();
            upsertOrder(completed);
            notify('success', '订单结案成功。');
        } catch (error) {
            notify('error', error instanceof Error ? error.message : '结案请求失败，请检查网络。');
        }
    };

    return {
        handleCommissionAudit,
        handleStatusUpdate,
        handleQuickShip,
        handleManualComplete,
    };
};
