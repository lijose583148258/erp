import type { Prisma } from '@prisma/client';
import { getOrderFulfillment } from '../utils/orderFulfillment';
import { readShipmentReservationViews, SHIPMENT_RESERVATION_READ_SELECT, reservationMicros, type ReservationReadRow } from './shipment-stock-reservation.service';

export const ORDER_FULFILLMENT_SHIPMENT_SELECT = {
  ...SHIPMENT_RESERVATION_READ_SELECT,
  orderItemId: true, quantity: true, unit: true, status: true, shippedAt: true, deliveredAt: true,
  receipts: { select: { acceptedQuantity: true, rejectedQuantity: true, unit: true } },
} as const satisfies Prisma.ShipmentSelect;

// Additive read axis only. It never changes legacy allocation, receipt, money,
// closure calculations or write eligibility. Missing history stays unknown.
export async function addOrderReservationReadback<T extends { shipments?: readonly ReservationReadRow[];
  fulfillment: ReturnType<typeof getOrderFulfillment> }>(db: Pick<Prisma.TransactionClient, 'auditLog'>, orders: readonly T[]) {
  const views = await readShipmentReservationViews(db, orders.flatMap(order => [...order.shipments || []]));
  return orders.map(order => {
    const lineIds = new Set(order.fulfillment.lines.map(line => line.orderItemId));
    const unbound = (order.shipments || []).some(row => !row.orderItemId || !lineIds.has(row.orderItemId));
    const lines = order.fulfillment.lines.map(line => {
      let state: 'verified' | 'legacy_unknown' | 'needs_review' = unbound ? 'needs_review' : 'verified', total = 0n;
      for (const row of order.shipments || []) {
        if (row.orderItemId !== line.orderItemId) continue;
        const view = views.get(row.id!);
        if (String(row.unit || '').trim().toLowerCase() !== line.unit.trim().toLowerCase() || view?.state === 'needs_review') state = 'needs_review';
        else if (!view || view.state === 'legacy_unknown') { if (state !== 'needs_review') state = 'legacy_unknown'; }
        else total += reservationMicros(view.activeQuantity!);
      }
      if (total > BigInt(Number.MAX_SAFE_INTEGER) || Number(total) / 1e6 > line.orderedQuantity) state = 'needs_review';
      return { ...line, reservationEvidenceState: state, reservedQuantity: state === 'verified' ? Number(total) / 1e6 : null };
    });
    return { ...order, fulfillment: { ...order.fulfillment, lines } };
  });
}

export const ORDER_FULFILLMENT_CANCELLATION_SELECT = {
  id: true, adjustmentType: true, status: true, orderItemId: true, cancelledQuantity: true,
} as const satisfies Prisma.ReceivableAdjustmentSelect;

export async function readOrderFulfillment(db: Pick<Prisma.TransactionClient, 'order'>, orderId: number) {
  const snapshot = await db.order.findUnique({ where: { id: orderId }, select: {
    items: { select: { id: true, productName: true, quantity: true, unit: true } },
    shipments: { select: ORDER_FULFILLMENT_SHIPMENT_SELECT },
    receivableAdjustments: { select: ORDER_FULFILLMENT_CANCELLATION_SELECT },
  } });
  return getOrderFulfillment(snapshot || {});
}

export class OrderFulfillmentIncompleteError extends Error {
  readonly statusCode = 409;
  constructor(readonly details: ReturnType<typeof getOrderFulfillment>) {
    super('ORDER_FULFILLMENT_INCOMPLETE');
  }
}
