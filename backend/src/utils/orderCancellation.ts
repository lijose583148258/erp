import { Prisma } from '@prisma/client';
import { addMoney, compareMoney, prorateMoney, subtractMoney } from './money';
import { getOrderFulfillment, ORDER_QUANTITY_CANCELLATION, type FulfillmentCancellation, type FulfillmentSnapshot } from './orderFulfillment';

export type CancellationOrderSnapshot = Omit<FulfillmentSnapshot, 'items' | 'receivableAdjustments'> & {
  items: Array<{ id: number; quantity: number; unit: string; totalPrice: number }>;
  receivableAdjustments: Array<FulfillmentCancellation & { amount: number; baseAmount?: number }>;
  totalAmount: number; discountAmount: number; finalAmount: number; paidAmount: number; receivableAdjustmentAmount: number;
  currency?: string; baseAmount?: number | null; lockedExchangeRate?: number | null;
};

// Used both at request and posting under the shared order lock. The client never
// chooses a credit amount, exchange rate or a replacement original quantity.
export function quoteOrderQuantityCancellation(order: CancellationOrderSnapshot, orderItemId: number, quantity: number) {
  const fail = (code: string): never => { throw new Error(code); };
  const fulfillment = getOrderFulfillment(order);
  const line = fulfillment.lines.find(row => row.orderItemId === orderItemId);
  if (fulfillment.needsReview || !line) return fail('ORDER_CANCELLATION_FULFILLMENT_REVIEW_REQUIRED');
  const epsilon = Math.min(0.000001, Math.abs(line.orderedQuantity) * Number.EPSILON * 16);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity - line.unallocatedQuantity > epsilon) {
    return fail('ORDER_CANCELLATION_QUANTITY_EXCEEDED');
  }
  const amounts = [order.totalAmount, order.discountAmount, order.finalAmount, order.paidAmount, order.receivableAdjustmentAmount,
    ...order.items.map(item => item.totalPrice)];
  if (amounts.some(amount => !Number.isFinite(amount) || amount < 0)
    || compareMoney(addMoney(...order.items.map(item => item.totalPrice)), order.totalAmount) !== 0
    || compareMoney(subtractMoney(order.totalAmount, order.discountAmount), order.finalAmount) !== 0) {
    return fail('ORDER_CANCELLATION_PRICING_REVIEW_REQUIRED');
  }
  const foreign = Boolean(order.currency && order.currency !== 'CNY');
  if (foreign && (!Number.isFinite(order.lockedExchangeRate) || order.lockedExchangeRate! <= 0
    || !Number.isFinite(order.baseAmount) || order.baseAmount! < 0
    || compareMoney(order.baseAmount, prorateMoney(order.finalAmount, 1, order.lockedExchangeRate)) !== 0)) {
    return fail('ORDER_CANCELLATION_PRICING_REVIEW_REQUIRED');
  }
  const baseTotal = foreign ? order.baseAmount! : order.finalAmount;
  const exchangeRate = foreign ? 1 / order.lockedExchangeRate! : 1;

  // Stable line-ID cumulative proration conserves every cent of the original
  // order discount, including repeated partial cancellations and the last cent.
  const sorted = [...order.items].sort((a, b) => a.id - b.id);
  let gross = 0, previousNet = 0, lineNet = 0, previousBase = 0, lineBase = 0;
  for (const item of sorted) {
    gross = addMoney(gross, item.totalPrice);
    const cumulativeNet = order.totalAmount === 0 ? 0 : prorateMoney(order.finalAmount, gross, order.totalAmount);
    const cumulativeBase = order.totalAmount === 0 ? 0 : prorateMoney(baseTotal, gross, order.totalAmount);
    if (item.id === orderItemId) { lineNet = subtractMoney(cumulativeNet, previousNet); lineBase = subtractMoney(cumulativeBase, previousBase); }
    previousNet = cumulativeNet;
    previousBase = cumulativeBase;
  }
  const prior = order.receivableAdjustments.filter(record => record.adjustmentType === ORDER_QUANTITY_CANCELLATION
    && record.status === 'posted' && record.orderItemId === orderItemId);
  if (prior.some(record => !Number.isFinite(record.amount) || record.amount < 0
    || !Number.isFinite(record.baseAmount) || record.baseAmount! < 0)) return fail('ORDER_CANCELLATION_PRICING_REVIEW_REQUIRED');
  const priorCredit = addMoney(...prior.map(record => record.amount));
  const priorBase = addMoney(...prior.map(record => record.baseAmount));
  if (compareMoney(priorCredit, prorateMoney(lineNet, line.cancelledQuantity, line.orderedQuantity)) !== 0
    || compareMoney(priorBase, prorateMoney(lineBase, line.cancelledQuantity, line.orderedQuantity)) !== 0) {
    return fail('ORDER_CANCELLATION_PRICING_REVIEW_REQUIRED');
  }
  const cumulativeQuantity = new Prisma.Decimal(line.cancelledQuantity).plus(quantity).toNumber();
  const amount = subtractMoney(prorateMoney(lineNet, Math.min(cumulativeQuantity, line.orderedQuantity), line.orderedQuantity), priorCredit);
  const baseAmount = subtractMoney(prorateMoney(lineBase, Math.min(cumulativeQuantity, line.orderedQuantity), line.orderedQuantity), priorBase);
  if (compareMoney(amount, subtractMoney(order.finalAmount, order.paidAmount, order.receivableAdjustmentAmount)) > 0) {
    return fail('ORDER_CANCELLATION_REFUND_REQUIRED');
  }
  return { orderItemId, quantity, unit: line.unit, amount, baseAmount, exchangeRate, lineNetAmount: lineNet,
    originalQuantity: line.orderedQuantity, previouslyCancelledQuantity: line.cancelledQuantity, fulfillment };
}
