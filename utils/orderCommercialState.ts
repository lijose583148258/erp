import type { OrderFinancialStatus, OrderFulfillmentStatus, SalesOrder } from '../types';

type OrderSnapshot = Pick<
  SalesOrder,
  'status' | 'paymentStatus' | 'paidAmount' | 'finalAmount' | 'dueDate' | 'orderDate' | 'paymentRecords'
> & {
  createdAt?: string | Date;
  paymentTermsDays?: number;
  paymentTerms?: number;
  shipments?: Array<{ status?: string; shippedAt?: string | Date | null; deliveredAt?: string | Date | null }>;
};

const toDate = (value?: string | Date | null) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const getOrderDueDate = (order: OrderSnapshot): string | undefined => {
  const explicitDueDate = toDate(order.dueDate);
  if (explicitDueDate) {
    return explicitDueDate.toISOString().split('T')[0];
  }

  const baseDate = toDate(order.orderDate) || toDate(order.createdAt);
  if (!baseDate) return undefined;

  const termsDays = Number(order.paymentTermsDays ?? order.paymentTerms ?? 0);
  const dueDate = new Date(baseDate.getTime());
  dueDate.setDate(dueDate.getDate() + termsDays);
  return dueDate.toISOString().split('T')[0];
};

export const deriveOrderFinancialStatus = (order: OrderSnapshot): OrderFinancialStatus => {
  if (String(order.status).toLowerCase() === 'cancelled') return 'cancelled';

  const finalAmount = Number(order.finalAmount || 0);
  const paidAmount = Number(order.paidAmount || 0);
  const outstanding = Math.max(0, finalAmount - paidAmount);
  const paymentStatus = String(order.paymentStatus || '').toLowerCase();
  const dueDate = toDate(getOrderDueDate(order));
  const hasPendingPayment = Array.isArray(order.paymentRecords)
    && order.paymentRecords.some(record => String(record.status || '').toLowerCase() === 'pending');

  if (paymentStatus === 'paid' || (finalAmount > 0 && outstanding <= 0)) return 'paid';
  if (dueDate && dueDate.getTime() < Date.now() && outstanding > 0) return 'overdue';
  if (hasPendingPayment && paidAmount <= 0) return 'payment_submitted';
  if (paymentStatus === 'partial' || paidAmount > 0) return 'partial';

  return 'unpaid';
};

export const deriveOrderFulfillmentStatus = (order: OrderSnapshot): OrderFulfillmentStatus => {
  if (String(order.status).toLowerCase() === 'cancelled') return 'cancelled';

  const shipments = Array.isArray(order.shipments) ? order.shipments : [];
  const hasShipments = shipments.length > 0;
  const allDelivered = hasShipments && shipments.every(shipment => String(shipment.status || '').toLowerCase() === 'delivered');
  const anyInTransit = shipments.some(shipment => {
    const status = String(shipment.status || '').toLowerCase();
    return status === 'in_transit' || status === 'shipped' || Boolean(shipment.shippedAt);
  });

  if (String(order.status).toLowerCase() === 'delivered' || allDelivered) return 'delivered';
  if (String(order.status).toLowerCase() === 'shipped' || anyInTransit) return 'in_transit';
  if (String(order.status).toLowerCase() === 'confirmed') return 'ready_to_ship';
  return 'pending_release';
};

export const decorateSalesOrder = <T extends OrderSnapshot>(order: T): T & {
  dueDate?: string;
  fulfillmentStatus: OrderFulfillmentStatus;
  financialStatus: OrderFinancialStatus;
} => {
  const dueDate = getOrderDueDate(order);
  return {
    ...order,
    dueDate,
    fulfillmentStatus: deriveOrderFulfillmentStatus({ ...order, dueDate }),
    financialStatus: deriveOrderFinancialStatus({ ...order, dueDate }),
  };
};
