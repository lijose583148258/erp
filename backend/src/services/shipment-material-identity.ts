import { resolveStockMaterialIdentity } from './stock-movement.material-identity';
import type { TransactionClient } from './stock-movement.service';

export type ShipmentIdentityInput = {
  customerId: number;
  orderId?: number | null;
  orderItemId?: number | null;
  materialId?: number | null;
  productName: string;
  quantity: number;
  unit: string;
  batchNo?: string | null;
};

export async function resolveShipmentIdentity(tx: TransactionClient, input: ShipmentIdentityInput) {
  const orderItem = input.orderItemId
    ? await tx.orderItem.findUnique({
      where: { id: input.orderItemId },
      select: {
        id: true,
        orderId: true,
        materialId: true,
        productName: true,
        quantity: true,
        unit: true,
        order: { select: { customerId: true } },
      },
    })
    : null;
  if (input.orderItemId && !orderItem) throw new Error('SHIPMENT_ORDER_ITEM_NOT_FOUND');
  if (orderItem && input.orderId && orderItem.orderId !== input.orderId) throw new Error('SHIPMENT_ORDER_ITEM_ORDER_MISMATCH');
  if (orderItem && orderItem.order.customerId !== input.customerId) throw new Error('SHIPMENT_ORDER_ITEM_CUSTOMER_MISMATCH');
  if (orderItem) {
    const alreadyAllocated = await tx.shipment.aggregate({
      where: { orderItemId: orderItem.id, status: { not: 'exception' } },
      _sum: { quantity: true },
    });
    if (Number(alreadyAllocated._sum.quantity || 0) + Number(input.quantity || 0) > Number(orderItem.quantity) + 0.000001) {
      throw new Error('SHIPMENT_ORDER_ITEM_QUANTITY_EXCEEDED');
    }
  }

  const materialId = orderItem?.materialId ?? input.materialId ?? null;
  if (orderItem?.materialId && input.materialId && orderItem.materialId !== input.materialId) {
    throw new Error('SHIPMENT_ORDER_ITEM_MATERIAL_MISMATCH');
  }
  const canonical = await resolveStockMaterialIdentity(tx, {
    materialId,
    productName: orderItem?.productName ?? input.productName,
    unit: orderItem?.unit ?? input.unit,
  });
  const productBatch = input.batchNo
    ? await tx.productBatch.findFirst({
      where: canonical.materialId
        ? { materialId: canonical.materialId, batchNo: input.batchNo }
        : { productName: canonical.productName, batchNo: input.batchNo },
      select: { id: true, materialId: true, batchNo: true },
    })
    : null;
  if (input.batchNo && !productBatch) throw new Error('SHIPMENT_PRODUCT_BATCH_NOT_FOUND');

  return {
    orderId: orderItem?.orderId ?? input.orderId ?? null,
    orderItemId: orderItem?.id ?? null,
    materialId: canonical.materialId,
    productName: canonical.productName,
    unit: canonical.unit,
    batchNo: productBatch?.batchNo ?? input.batchNo ?? null,
    productBatchId: productBatch?.id ?? null,
  };
}
