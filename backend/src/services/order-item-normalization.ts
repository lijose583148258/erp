import { addMoney, maxMoney, multiplyMoney, subtractMoney } from '../utils/money';

export const calculateOrderFinalAmount = (totalAmount: number, discountAmount: number): number =>
    subtractMoney(totalAmount, discountAmount);

export const calculateOrderOutstanding = (finalAmount: number, paidAmount: number): number =>
    maxMoney(0, subtractMoney(finalAmount, paidAmount));

export const buildOrderItemsAndTotals = (items: any[]) => {
    let totalAmount = 0;
    const orderItems = items.map((item: any) => {
        const quantity = Number(item.quantity);
        const unitPrice = Number(item.unitPrice);
        const totalPrice = multiplyMoney(quantity, unitPrice);
        totalAmount = addMoney(totalAmount, totalPrice);

        return {
            materialId: item.materialId ? Number(item.materialId) : null,
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
