import type { Prisma } from '@prisma/client';
import { readOrderFulfillment } from './order-fulfillment.service';

type ShipmentOrderClient = Pick<Prisma.TransactionClient, 'order'>;

export type ShipmentOrderClaimInput = {
  orderId: number;
  customerId: number;
  orderItemId?: number | null;
  quantity: number;
};

// The caller owns the transaction. Claim the shared order row before examining
// status or allocating a new shipment, including order-item-only requests.
export async function claimShipmentOrder(db: ShipmentOrderClient, input: ShipmentOrderClaimInput): Promise<void> {
  const claim = await db.order.updateMany({
    where: { id: input.orderId },
    data: { updatedAt: new Date() },
  });
  if (claim.count !== 1) throw new Error('SHIPMENT_ORDER_NOT_FOUND');

  const order = await db.order.findUnique({
    where: { id: input.orderId },
    select: { status: true, customerId: true, shipmentHold: true },
  });
  if (!order) throw new Error('SHIPMENT_ORDER_NOT_FOUND');
  if (!['confirmed', 'shipped', 'delivered'].includes(order.status)) {
    throw new Error('SHIPMENT_ORDER_STATUS_INVALID');
  }
  if (order.customerId !== input.customerId) throw new Error('SHIPMENT_ORDER_CUSTOMER_MISMATCH');
  if (order.shipmentHold) throw new Error('SHIPMENT_ORDER_ON_HOLD');
  if (order.status !== 'delivered') return;

  // Old versions could label a 40/100 delivery as fully delivered. Permit only
  // a quantity-evidenced remainder; never reopen or overwrite historical status.
  const fulfillment = await readOrderFulfillment(db, input.orderId);
  const line = fulfillment.lines.find(item => item.orderItemId === input.orderItemId);
  if (fulfillment.needsReview || !line) throw new Error('SHIPMENT_ORDER_FULFILLMENT_REVIEW_REQUIRED');
  const tolerance = Math.min(0.000001, Math.abs(line.orderedQuantity) * Number.EPSILON * 16);
  if (!Number.isFinite(input.quantity) || input.quantity <= 0 || line.unallocatedQuantity <= 0
    || input.quantity - line.unallocatedQuantity > tolerance) {
    throw new Error('SHIPMENT_ORDER_ITEM_QUANTITY_EXCEEDED');
  }
}
