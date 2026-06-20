export type CommercialFulfillmentStatus =
  | 'pending_release'
  | 'ready_to_ship'
  | 'in_transit'
  | 'delivered'
  | 'cancelled';

export type CommercialFinancialStatus =
  | 'unpaid'
  | 'payment_submitted'
  | 'partial'
  | 'paid'
  | 'overdue'
  | 'cancelled';

type ShipmentSnapshot = { status?: string | null; shippedAt?: Date | string | null; deliveredAt?: Date | string | null };
type PaymentSnapshot = { status?: string | null };

type OrderCommercialSnapshot = {
  status?: string | null;
  paymentStatus?: string | null;
  paidAmount?: number | string | null;
  finalAmount?: number | string | null;
  createdAt?: Date | string | null;
  dueDate?: Date | string | null;
  paymentTerms?: number | string | null;
  paymentRecords?: PaymentSnapshot[] | null;
  shipments?: ShipmentSnapshot[] | null;
};

const toDate = (value?: Date | string | null) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const getCommercialDueDate = (order: OrderCommercialSnapshot) => {
  const explicit = toDate(order.dueDate);
  if (explicit) return explicit.toISOString();

  const createdAt = toDate(order.createdAt);
  if (!createdAt) return null;

  const paymentTerms = Number(order.paymentTerms || 0);
  const dueDate = new Date(createdAt.getTime());
  dueDate.setDate(dueDate.getDate() + paymentTerms);
  return dueDate.toISOString();
};

export const getCommercialFinancialStatus = (order: OrderCommercialSnapshot): CommercialFinancialStatus => {
  if (String(order.status || '').toLowerCase() === 'cancelled') return 'cancelled';

  const finalAmount = Number(order.finalAmount || 0);
  const paidAmount = Number(order.paidAmount || 0);
  const outstanding = Math.max(0, finalAmount - paidAmount);
  const paymentStatus = String(order.paymentStatus || '').toLowerCase();
  const dueDate = toDate(order.dueDate) || toDate(getCommercialDueDate(order));
  const hasPendingPayment = Array.isArray(order.paymentRecords)
    && order.paymentRecords.some(record => String(record.status || '').toLowerCase() === 'pending');

  if (paymentStatus === 'paid' || (finalAmount > 0 && outstanding <= 0)) return 'paid';
  if (hasPendingPayment && outstanding > 0) return 'payment_submitted';
  if (dueDate && dueDate.getTime() < Date.now() && outstanding > 0) return 'overdue';
  if (paymentStatus === 'partial' || paidAmount > 0) return 'partial';

  return 'unpaid';
};

export const getCommercialFulfillmentStatus = (order: OrderCommercialSnapshot): CommercialFulfillmentStatus => {
  if (String(order.status || '').toLowerCase() === 'cancelled') return 'cancelled';

  const shipments = Array.isArray(order.shipments) ? order.shipments : [];
  const hasShipments = shipments.length > 0;
  const allDelivered = hasShipments && shipments.every(shipment => String(shipment.status || '').toLowerCase() === 'delivered');
  const anyInTransit = shipments.some(shipment => {
    const status = String(shipment.status || '').toLowerCase();
    return status === 'in_transit' || status === 'shipped' || Boolean(shipment.shippedAt);
  });

  if (String(order.status || '').toLowerCase() === 'delivered' || allDelivered) return 'delivered';
  if (String(order.status || '').toLowerCase() === 'shipped' || anyInTransit) return 'in_transit';
  if (String(order.status || '').toLowerCase() === 'confirmed') return 'ready_to_ship';
  return 'pending_release';
};

export const decorateCommercialOrderState = <T extends OrderCommercialSnapshot>(order: T) => {
  const dueDate = getCommercialDueDate(order);
  return {
    ...order,
    dueDate,
    fulfillmentStatus: getCommercialFulfillmentStatus({ ...order, dueDate }),
    financialStatus: getCommercialFinancialStatus({ ...order, dueDate }),
  };
};
