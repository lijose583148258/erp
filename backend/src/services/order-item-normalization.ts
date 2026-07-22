export const buildOrderItemsAndTotals = (items: any[]) => {
    let totalAmount = 0;
    const orderItems = items.map((item: any) => {
        const quantity = Number(item.quantity);
        const unitPrice = Number(item.unitPrice);
        const totalPrice = quantity * unitPrice;
        totalAmount += totalPrice;

        return {
            productName: item.productName,
            specification: item.specification || item.packagingSpec || null,
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
