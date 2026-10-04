import type { SalesOrder, Shipment } from '../../types';

export type SalesOrderShipmentLine = {
    orderItemId: number;
    materialId: number;
    productName: string;
    unit: string;
    orderedQuantity: number;
    acceptedQuantity: number;
    unallocatedQuantity: number;
};

const positiveId = (value: unknown) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const positiveQuantity = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const sameUnit = (a: string, b: string) => Boolean(a.trim()) && a.trim().toLowerCase() === b.trim().toLowerCase();

export function getEligibleShipmentLines(order: SalesOrder | null | undefined): SalesOrderShipmentLine[] {
    if (!order || !positiveId(order.id) || !positiveId(order.customerId)
        || !['confirmed', 'shipped', 'delivered'].includes(order.status)
        || !order.fulfillment || order.fulfillment.needsReview || order.fulfillment.fullyDelivered) return [];
    const items = order.items as Array<SalesOrder['items'][number] & { id?: number | string }>;
    return order.fulfillment.lines.flatMap(line => {
        const matching = items.filter(item => Number(item.id) === line.orderItemId);
        if (matching.length !== 1 || !positiveId(line.orderItemId)
            || order.fulfillment!.lines.filter(other => other.orderItemId === line.orderItemId).length !== 1) return [];
        const item = matching[0];
        if (!positiveId(item.materialId) || !item.productName?.trim() || !sameUnit(item.unit || '', line.unit || '')
            || !positiveQuantity(line.unallocatedQuantity) || !positiveQuantity(line.orderedQuantity)
            || line.unallocatedQuantity > line.orderedQuantity || item.quantity !== line.orderedQuantity) return [];
        return [{ orderItemId: line.orderItemId, materialId: Number(item.materialId), productName: item.productName,
            unit: item.unit, orderedQuantity: line.orderedQuantity, acceptedQuantity: line.acceptedQuantity,
            unallocatedQuantity: line.unallocatedQuantity }];
    });
}

export type SalesOrderShipmentDraft = {
    orderItemId: string;
    quantity: string;
    batchNo: string;
    carrier?: string;
    trackingNo?: string;
};

export function buildSalesOrderShipmentPayload(order: SalesOrder, draft: SalesOrderShipmentDraft): Partial<Shipment> {
    const line = getEligibleShipmentLines(order).find(item => String(item.orderItemId) === draft.orderItemId);
    if (!line) throw new Error('请选择有明确未分配数量的订单行；订单状态或履约证据可能已变化。');
    const quantity = Number(draft.quantity);
    if (!draft.quantity.trim() || !positiveQuantity(quantity) || quantity > line.unallocatedQuantity) {
        throw new Error(`本次数量必须大于 0，且不超过该行未分配量 ${line.unallocatedQuantity} ${line.unit}。`);
    }
    if (!draft.batchNo.trim()) throw new Error('请输入实际出库批号，物料身份与 QC 放行状态由服务器校验。');
    return {
        orderId: order.id, orderItemId: String(line.orderItemId), customerId: order.customerId,
        materialId: String(line.materialId), productName: line.productName, unit: line.unit, quantity,
        batchNo: draft.batchNo.trim(), carrier: draft.carrier?.trim() || undefined, trackingNo: draft.trackingNo?.trim() || undefined,
    };
}
