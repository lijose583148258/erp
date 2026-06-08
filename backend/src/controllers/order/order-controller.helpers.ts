export const ORDER_STATUS_TRANSITIONS: Record<string, string[]> = {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['shipped', 'cancelled'],
    shipped: ['delivered', 'completed'],
    delivered: ['completed'],
    completed: [],
    cancelled: [],
};

export const getCustomerDisplayName = (customer: {
    name?: string | null;
    nameZh?: string | null;
    nameEn?: string | null;
    nameVi?: string | null;
}) => customer.nameZh || customer.nameEn || customer.nameVi || customer.name || 'Unknown customer';

export const buildOrderItemsAndTotals = (items: any[]) => {
    let totalAmount = 0;
    const orderItems = items.map((item: any) => {
        const quantity = Number(item.quantity);
        const unitPrice = Number(item.unitPrice);
        const totalPrice = quantity * unitPrice;
        totalAmount += totalPrice;

        return {
            productName: item.productName,
            specification: item.specification || null,
            quantity,
            unit: item.unit || 'unit',
            unitPrice,
            totalPrice,
            itemType: item.itemType || 'normal',
            notes: item.notes || null,
        };
    });

    return { orderItems, totalAmount };
};

export const buildCreateOrderAuditDetails = (params: {
    orderNo: string;
    customer: {
        name?: string | null;
        nameZh?: string | null;
        nameEn?: string | null;
        nameVi?: string | null;
    };
    finalAmount: number;
}) => `Create order: ${params.orderNo}, customer: ${getCustomerDisplayName(params.customer)}, amount: ${params.finalAmount}`;
