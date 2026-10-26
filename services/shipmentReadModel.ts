import type { Shipment } from '../types';
import { toApiRecord, toApiRecordArray, toNumberValue, toOptionalString, toStringValue } from '../utils/apiMapping';

// Shared API read mapping is pure so unknown facts can be checked without a
// browser transport. No display fixture may masquerade as logistics evidence.
export function mapShipment(value: unknown): Shipment {
    const item = toApiRecord(value);
    const firstItem = toApiRecordArray(item.items)[0] || {};
    const productName = toStringValue(item.productName || item.product || firstItem.productName, 'Chemical Goods');
    const quantity = toNumberValue(item.quantity ?? item.qty);
    return {
        ...item,
        id: toStringValue(item.id),
        orderId: toStringValue(item.orderNo || item.orderId),
        orderItemId: toOptionalString(item.orderItemId),
        materialId: toOptionalString(item.materialId),
        productBatchId: toOptionalString(item.productBatchId),
        customerId: toOptionalString(item.customerId),
        customerName: toStringValue(item.customerName || item.customerDisplayName || item.counterpartyName, 'Unknown'),
        sku: toStringValue(item.sku || item.productSku || firstItem.sku, productName),
        qty: quantity,
        quantity,
        shippedAt: item.shippedAt ? new Date(String(item.shippedAt)).toISOString().split('T')[0] : '-',
        deliveredAt: item.deliveredAt ? new Date(String(item.deliveredAt)).toISOString().split('T')[0] : undefined,
        status: toStringValue(item.status, 'pending'),
        productName,
        casNo: toOptionalString(item.casNo || item.cas || item.productCasNo || firstItem.casNo),
        msdsStatus: toStringValue(item.msdsStatus || item.msds_status || (item.msdsUrl || item.msdsDocumentUrl ? 'valid' : 'missing')),
        msdsUrl: toOptionalString(item.msdsUrl || item.msdsDocumentUrl),
        route: toOptionalString(item.route),
        isColdChain: typeof item.isColdChain === 'boolean' ? item.isColdChain : undefined,
        temperature: typeof item.temperature === 'number' && Number.isFinite(item.temperature) ? item.temperature : undefined,
        batchNo: toOptionalString(item.batchNo),
    };
}

export function shipmentTemperatureSamples(shipment: Shipment): number[] {
    return shipment.isColdChain && typeof shipment.temperature === 'number' && Number.isFinite(shipment.temperature) ? [shipment.temperature] : [];
}
