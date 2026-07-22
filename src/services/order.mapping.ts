import type { SalesOrder } from '../../types';
import { toApiRecord, toNumberValue, toOptionalString, toStringValue } from '../../utils/apiMapping';

export const mapSalesOrderItem = (value: unknown): SalesOrder['items'][number] => {
    const orderItem = toApiRecord(value);
    return {
        ...orderItem,
        sku: toStringValue(orderItem.sku),
        productName: toStringValue(orderItem.productName || orderItem.name),
        packagingSpec: toStringValue(orderItem.packagingSpec || orderItem.specification),
        quantity: toNumberValue(orderItem.quantity),
        unit: toStringValue(orderItem.unit, 'kg'),
        unitPrice: toNumberValue(orderItem.unitPrice),
        discount: toNumberValue(orderItem.discount),
        taxAmount: toNumberValue(orderItem.taxAmount),
        amount: toNumberValue(orderItem.amount ?? orderItem.totalPrice),
        notes: toOptionalString(orderItem.notes),
    };
};

export const buildSalesOrderUpdatePayload = (order: SalesOrder) => ({
    ...order,
    customerId: Number(order.customerId),
    paymentTerms: order.paymentTermsDays,
    items: order.items.map((item) => ({ ...item, specification: item.packagingSpec })),
    contractId: order.contractId ? Number(order.contractId) : null,
});
