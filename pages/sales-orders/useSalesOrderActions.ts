import { useState, type Dispatch, type SetStateAction } from 'react';
import { orderService } from '../../src/services/order.service';
import { CommissionStatus, OrderStatus, type SalesOrder, type Shipment } from '../../types';
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
    const [shipmentOrderId, setShipmentOrderId] = useState<string | null>(null);
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
        try {
            const updatedOrder = await orderService.updateStatus(id, newStatus);
            invalidateSalesOrderWorkspaceState();
            upsertOrder(updatedOrder);
            notify('success', '订单状态已更新为：' + newStatus);
        } catch (error) {
            notify('error', error instanceof Error ? error.message : '订单状态更新失败');
        }
    };

    const handleQuickShip = (order: SalesOrder) => {
        // Open a line-bound draft and re-read current quantities in the form.
        // URL quantities and sums across heterogeneous units are not authority.
        setShipmentOrderId(String(order.id));
    };

    const handleShipmentCreated = (order: SalesOrder, _shipment: Shipment) => {
        invalidateSalesOrderWorkspaceState();
        upsertOrder(order);
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
        shipmentOrderId,
        closeShipmentDraft: () => setShipmentOrderId(null),
        handleShipmentCreated,
        handleManualComplete,
    };
};
