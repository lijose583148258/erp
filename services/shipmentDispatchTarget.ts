import { OrderStatus } from '../types';
import type { Shipment } from '../types';

type DispatchFulfillmentLine = {
    orderItemId: number; productName: string; unit: string; orderedQuantity: number;
    acceptedQuantity: number; unallocatedQuantity: number;
    allocatedQuantity?: number; dispatchedQuantity?: number; cancelledQuantity?: number;
    outstandingQuantity?: number; reservedQuantity?: number | null;
    reservationEvidenceState?: 'verified' | 'legacy_unknown' | 'needs_review';
};
type DispatchFulfillment = {
    fullyDelivered: boolean; needsReview: boolean; lines: DispatchFulfillmentLine[];
    fullyResolved?: boolean; hasCancelledQuantity?: boolean; hasAccepted?: boolean;
    hasDispatched?: boolean; hasUnallocated?: boolean;
};

// Frontend submission services use canonical decimal strings. This is not a SalesOrder.
export type ShipmentDispatchTarget = {
    id: string; orderNo?: string; status: OrderStatus; customerId: string;
    customer: { id: string; name?: string; nameZh?: string; nameEn?: string; nameVi?: string };
    items: Array<{ id: number; materialId: number | null; productName: string; quantity: number; unit: string }>;
    fulfillment: DispatchFulfillment;
};
export type ShipmentDraftLine = {
    orderItemId: number; materialId: number; productName: string; unit: string;
    orderedQuantity: number; acceptedQuantity: number; unallocatedQuantity: number;
};
export type ShipmentDraft = {
    orderItemId: string; quantity: string; batchNo: string; carrier?: string; trackingNo?: string;
};

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const positiveId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const canonicalId = (value: unknown): number | null => {
    if (positiveId(value)) return value;
    return typeof value === 'string' && /^[1-9]\d*$/.test(value) && positiveId(Number(value)) ? Number(value) : null;
};
const quantity = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const nonempty = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim());
const sameUnit = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const optionalQuantities = ['allocatedQuantity', 'dispatchedQuantity', 'cancelledQuantity', 'outstandingQuantity'] as const;
const optionalFlags = ['fullyResolved', 'hasCancelledQuantity', 'hasAccepted', 'hasDispatched', 'hasUnallocated'] as const;

function parseTarget(value: unknown, wire: boolean): ShipmentDispatchTarget | null {
    if (!record(value)) return null;
    const id = wire ? (positiveId(value.id) ? value.id : null) : canonicalId(value.id);
    const customerId = wire ? (positiveId(value.customerId) ? value.customerId : null) : canonicalId(value.customerId);
    if (!id || !customerId || !Object.values(OrderStatus).includes(value.status as OrderStatus)
        || (wire ? !nonempty(value.orderNo) : value.orderNo !== undefined && typeof value.orderNo !== 'string')
        || !record(value.customer) || !Array.isArray(value.items) || !value.items.length || !record(value.fulfillment)) return null;
    const customerIdentity = wire ? (positiveId(value.customer.id) ? value.customer.id : null) : canonicalId(value.customer.id);
    if (customerIdentity !== customerId) return null;
    const customer: ShipmentDispatchTarget['customer'] = { id: String(customerId) };
    for (const key of ['name', 'nameZh', 'nameEn', 'nameVi'] as const) {
        const name = value.customer[key];
        if (name !== undefined && name !== null && typeof name !== 'string') return null;
        if (typeof name === 'string') customer[key] = name;
    }
    const itemIds = new Set<number>();
    const items: ShipmentDispatchTarget['items'] = [];
    for (const item of value.items) {
        if (!record(item)) return null;
        const itemId = wire ? (positiveId(item.id) ? item.id : null) : canonicalId(item.id);
        const materialId = item.materialId == null ? null : wire
            ? (positiveId(item.materialId) ? item.materialId : null) : canonicalId(item.materialId);
        if (!itemId || itemIds.has(itemId) || (item.materialId != null && !materialId)
            || !nonempty(item.productName) || !nonempty(item.unit) || !quantity(item.quantity) || item.quantity <= 0) return null;
        itemIds.add(itemId);
        items.push({ id: itemId, materialId, productName: item.productName, quantity: item.quantity, unit: item.unit });
    }
    const source = value.fulfillment;
    if (typeof source.fullyDelivered !== 'boolean' || typeof source.needsReview !== 'boolean' || !Array.isArray(source.lines)) return null;
    const fulfillment: DispatchFulfillment = { fullyDelivered: source.fullyDelivered, needsReview: source.needsReview, lines: [] };
    for (const key of optionalFlags) {
        if (source[key] !== undefined && typeof source[key] !== 'boolean') return null;
        if (typeof source[key] === 'boolean') fulfillment[key] = source[key];
    }
    const lineIds = new Set<number>();
    for (const line of source.lines) {
        if (!record(line) || !positiveId(line.orderItemId) || lineIds.has(line.orderItemId) || !itemIds.has(line.orderItemId)
            || !nonempty(line.unit) || !quantity(line.orderedQuantity) || line.orderedQuantity <= 0
            || !quantity(line.acceptedQuantity) || !quantity(line.unallocatedQuantity)
            || line.unallocatedQuantity > line.orderedQuantity
            || (line.productName !== undefined && typeof line.productName !== 'string')) return null;
        const item = items.find(candidate => candidate.id === line.orderItemId)!;
        if (item.quantity !== line.orderedQuantity || !sameUnit(item.unit, line.unit)) return null;
        lineIds.add(line.orderItemId);
        const projected: DispatchFulfillmentLine = {
            orderItemId: line.orderItemId, productName: typeof line.productName === 'string' ? line.productName : item.productName,
            unit: line.unit, orderedQuantity: line.orderedQuantity, acceptedQuantity: line.acceptedQuantity,
            unallocatedQuantity: line.unallocatedQuantity,
        };
        for (const key of optionalQuantities) {
            if (line[key] !== undefined && !quantity(line[key])) return null;
            if (quantity(line[key])) projected[key] = line[key];
        }
        if (line.reservedQuantity !== undefined) {
            if (line.reservedQuantity !== null && !quantity(line.reservedQuantity)) return null;
            projected.reservedQuantity = line.reservedQuantity as number | null;
        }
        if (line.reservationEvidenceState !== undefined) {
            if (!['verified', 'legacy_unknown', 'needs_review'].includes(String(line.reservationEvidenceState))) return null;
            projected.reservationEvidenceState = line.reservationEvidenceState as DispatchFulfillmentLine['reservationEvidenceState'];
        }
        fulfillment.lines.push(projected);
    }
    if (lineIds.size !== itemIds.size) return null;
    return { id: String(id), customerId: String(customerId), status: value.status as OrderStatus,
        ...(typeof value.orderNo === 'string' ? { orderNo: value.orderNo } : {}), customer, items, fulfillment };
}

/** Parse one dispatch-view response. Wire identities must be actual numeric IDs. */
export function parseShipmentDispatchTarget(value: unknown): ShipmentDispatchTarget | null {
    return parseTarget(value, true);
}

/** Never silently present a partial candidate list when a response is malformed. */
export function parseShipmentDispatchTargets(value: unknown): ShipmentDispatchTarget[] {
    if (!Array.isArray(value)) throw new Error('可发货订单响应格式无效，请刷新后重试。');
    const targets: ShipmentDispatchTarget[] = [];
    const ids = new Set<string>();
    for (const entry of value) {
        const target = parseShipmentDispatchTarget(entry);
        if (!target || ids.has(target.id)) throw new Error('可发货订单身份或履约证据无效，请刷新后重试。');
        ids.add(target.id); targets.push(target);
    }
    return targets;
}

/** Whitelist projection for already-mapped frontend identities; no financial fields survive. */
export function projectShipmentDispatchTarget(value: unknown): ShipmentDispatchTarget | null {
    return parseTarget(value, false);
}

export function getEligibleShipmentLines(target: ShipmentDispatchTarget | null | undefined): ShipmentDraftLine[] {
    const current = projectShipmentDispatchTarget(target);
    if (!current || ![OrderStatus.CONFIRMED, OrderStatus.SHIPPED, OrderStatus.DELIVERED].includes(current.status)
        || current.fulfillment.needsReview || current.fulfillment.fullyDelivered) return [];
    return current.fulfillment.lines.flatMap(line => {
        const item = current.items.find(candidate => candidate.id === line.orderItemId)!;
        if (!item.materialId || line.unallocatedQuantity <= 0) return [];
        return [{ orderItemId: line.orderItemId, materialId: item.materialId, productName: item.productName,
            unit: item.unit, orderedQuantity: line.orderedQuantity, acceptedQuantity: line.acceptedQuantity,
            unallocatedQuantity: line.unallocatedQuantity }];
    });
}

export function buildShipmentDraftPayload(target: ShipmentDispatchTarget, draft: ShipmentDraft): Partial<Shipment> {
    const line = getEligibleShipmentLines(target).find(item => String(item.orderItemId) === draft.orderItemId);
    if (!line) throw new Error('请选择有明确未分配数量的订单行；订单状态或履约证据可能已变化。');
    const requested = Number(draft.quantity);
    if (!draft.quantity.trim() || !quantity(requested) || requested <= 0 || requested > line.unallocatedQuantity) {
        throw new Error(`本次数量必须大于 0，且不超过该行未分配量 ${line.unallocatedQuantity} ${line.unit}。`);
    }
    return {
        orderId: target.id, orderItemId: String(line.orderItemId), customerId: target.customerId,
        materialId: String(line.materialId), productName: line.productName, unit: line.unit, quantity: requested,
        batchNo: draft.batchNo.trim() || undefined, carrier: draft.carrier?.trim() || undefined, trackingNo: draft.trackingNo?.trim() || undefined,
    };
}
