import type { SalesOrder, Shipment } from '../../types';
import { buildShipmentDraftPayload, getEligibleShipmentLines as getDispatchLines, projectShipmentDispatchTarget } from '../../services/shipmentDispatchTarget';
import type { ShipmentDispatchTarget, ShipmentDraft, ShipmentDraftLine } from '../../services/shipmentDispatchTarget';

export type SalesOrderShipmentLine = ShipmentDraftLine;
export type SalesOrderShipmentDraft = ShipmentDraft;

/** Only logistics facts cross from the full SalesOrders model into Shipping. */
export function toShipmentDispatchTarget(order: SalesOrder | null | undefined): ShipmentDispatchTarget | null {
    if (!order) return null;
    return projectShipmentDispatchTarget({
        id: order.id, orderNo: order.orderNo, status: order.status, customerId: order.customerId,
        customer: { id: order.customerId, name: order.customerDisplayName || order.customerName,
            nameZh: order.customerNameZh, nameEn: order.customerNameEn, nameVi: order.customerNameVi },
        items: Array.isArray(order.items) ? order.items.map(item => ({
            id: item.id, materialId: item.materialId, productName: item.productName, quantity: item.quantity, unit: item.unit,
        })) : order.items,
        fulfillment: order.fulfillment,
    });
}

export function getEligibleShipmentLines(order: SalesOrder | null | undefined): SalesOrderShipmentLine[] {
    return getDispatchLines(toShipmentDispatchTarget(order));
}

export function buildSalesOrderShipmentPayload(order: SalesOrder, draft: SalesOrderShipmentDraft): Partial<Shipment> {
    const target = toShipmentDispatchTarget(order);
    if (!target) throw new Error('请选择有明确未分配数量的订单行；订单状态或履约证据可能已变化。');
    return buildShipmentDraftPayload(target, draft);
}
