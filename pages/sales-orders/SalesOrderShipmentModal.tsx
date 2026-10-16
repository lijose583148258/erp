import React from 'react';
import type { SalesOrder, Shipment } from '../../types';
import { orderService } from '../../src/services/order.service';
import ShipmentDraftDialog from '../shipping/ShipmentDraftDialog';
import { toShipmentDispatchTarget } from './salesOrderShipmentHelpers';

type Props = {
    orderId: string;
    canWrite: boolean;
    onClose: () => void;
    onCreated: (order: SalesOrder, shipment: Shipment) => void;
    language?: string;
};

// Sales owns its full-order reads; the shared shipping form only receives logistics facts.
export default function SalesOrderShipmentModal({ onCreated, ...props }: Props) {
    const readTarget = React.useCallback(async (orderId: string) => {
        const order = await orderService.getById(orderId);
        if (order.id !== orderId) throw Error('订单回读身份不一致，禁止发货。');
        return toShipmentDispatchTarget(order);
    }, []);
    const readCreated = React.useCallback(async (shipment: Shipment, isCurrent: () => boolean) => {
        const order = await orderService.getById(props.orderId);
        if (!isCurrent()) return;
        if (order.id !== props.orderId) throw Error('订单回读身份不一致，请重新读取原订单。');
        onCreated(order, shipment);
    }, [onCreated, props.orderId]);
    return <ShipmentDraftDialog {...props} readTarget={readTarget} onCreated={readCreated} testIdPrefix="sales-order-shipment" />;
}
