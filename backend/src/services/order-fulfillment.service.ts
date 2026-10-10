import type { Prisma } from '@prisma/client';
import { getOrderFulfillment } from '../utils/orderFulfillment';

export const ORDER_FULFILLMENT_SHIPMENT_SELECT = {
  orderItemId: true, quantity: true, unit: true, status: true, shippedAt: true, deliveredAt: true,
  receipts: { select: { acceptedQuantity: true, rejectedQuantity: true, unit: true } },
} as const satisfies Prisma.ShipmentSelect;

export async function readOrderFulfillment(db: Pick<Prisma.TransactionClient, 'order'>, orderId: number) {
  const snapshot = await db.order.findUnique({ where: { id: orderId }, select: {
    items: { select: { id: true, productName: true, quantity: true, unit: true } },
    shipments: { select: ORDER_FULFILLMENT_SHIPMENT_SELECT },
  } });
  return getOrderFulfillment(snapshot || {});
}

export class OrderFulfillmentIncompleteError extends Error {
  readonly statusCode = 409;
  constructor(readonly details: ReturnType<typeof getOrderFulfillment>) {
    super('ORDER_FULFILLMENT_INCOMPLETE');
  }
}
