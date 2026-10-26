import type { Prisma } from '@prisma/client';
import type { AuthRequest } from '../middleware/auth';
import prisma from '../config/database';
import { casbinAllowsAllPermissions } from '../permissions/casbinAuthorization';
import { buildOrderDataScopeWhere, mergeWhereAnd } from '../utils/recordAccess';
import { getOrderFulfillment } from '../utils/orderFulfillment';
import { ORDER_FULFILLMENT_SHIPMENT_SELECT, ORDER_FULFILLMENT_CANCELLATION_SELECT, addOrderReservationReadback } from './order-fulfillment.service';

const ITEM_SELECT = { id: true, materialId: true, productName: true, quantity: true, unit: true } as const satisfies Prisma.OrderItemSelect;
const LEGACY_SELECT = { id: true, orderNo: true,
  customer: { select: { id: true, nameZh: true, nameEn: true, nameVi: true } }, items: true,
  shipments: { select: ORDER_FULFILLMENT_SHIPMENT_SELECT },
  receivableAdjustments: { select: ORDER_FULFILLMENT_CANCELLATION_SELECT },
} as const satisfies Prisma.OrderSelect;
const DISPATCH_SELECT = { ...LEGACY_SELECT, status: true, customerId: true,
  customer: { select: { id: true, name: true, nameZh: true, nameEn: true, nameVi: true } }, items: { select: ITEM_SELECT },
} as const satisfies Prisma.OrderSelect;

type QuantitySnapshot = {
  items: Array<{ id: number; productName: string; quantity: number; unit: string }>;
  shipments: Prisma.ShipmentGetPayload<{ select: typeof ORDER_FULFILLMENT_SHIPMENT_SELECT }>[];
  receivableAdjustments: Prisma.ReceivableAdjustmentGetPayload<{ select: typeof ORDER_FULFILLMENT_CANCELLATION_SELECT }>[];
};
async function eligibleQuantities<T extends QuantitySnapshot>(orders: T[]) {
  return (await addOrderReservationReadback(prisma, orders.map(order => ({ ...order, fulfillment: getOrderFulfillment(order) }))))
    .filter(order => order.fulfillment.hasUnallocated && !order.fulfillment.needsReview);
}
const logisticsItem = (item: Prisma.OrderItemGetPayload<{ select: typeof ITEM_SELECT }>) => ({
  id: item.id, materialId: item.materialId, productName: item.productName, quantity: item.quantity, unit: item.unit,
});

// One business candidate/quantity calculation, two explicit response contracts.
// Logistics visibility is not permission to read the full order's item scalars.
export async function getOrdersForShipment(req: AuthRequest, view?: 'dispatch') {
  const where = mergeWhereAnd({ status: { in: ['confirmed', 'shipped', 'delivered'] }, paymentStatus: { in: ['paid', 'partial'] } },
    buildOrderDataScopeWhere(req, { includeFinanceAll: true, includeWarehouseAll: true }));
  if (view === 'dispatch') {
    const orders = await eligibleQuantities(await prisma.order.findMany({ where, select: DISPATCH_SELECT }));
    return orders.map(order => ({ id: order.id, orderNo: order.orderNo, status: order.status, customerId: order.customerId,
      customer: { id: order.customer.id, name: order.customer.name, nameZh: order.customer.nameZh,
        nameEn: order.customer.nameEn, nameVi: order.customer.nameVi },
      items: order.items.map(logisticsItem), fulfillment: order.fulfillment }));
  }

  const orders = await eligibleQuantities(await prisma.order.findMany({ where, select: LEGACY_SELECT }));
  const fullIds = new Set<number>();
  if (orders.length && req.user && await casbinAllowsAllPermissions(req.user.role, ['orders.read'])) {
    const visible = await prisma.order.findMany({ where: mergeWhereAnd({ id: { in: orders.map(order => order.id) } },
      buildOrderDataScopeWhere(req, { includeFinanceAll: true })), select: { id: true } });
    visible.forEach(order => fullIds.add(order.id));
  }
  return orders.map(order => ({ ...order, items: fullIds.has(order.id) ? order.items : order.items.map(logisticsItem) }));
}
