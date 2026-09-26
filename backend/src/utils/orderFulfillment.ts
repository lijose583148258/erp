// Fulfillment is measured per order line in its canonical unit, never by adding
// quantities from unrelated materials/units or trusting a shipment status alone.
export type FulfillmentLine = { id: number; productName?: string; quantity: number; unit: string };
export type FulfillmentShipment = {
  orderItemId?: number | null; quantity?: number; unit?: string; status?: string | null;
  shippedAt?: Date | string | null; deliveredAt?: Date | string | null;
  receipts?: Array<{ acceptedQuantity: number; rejectedQuantity: number; unit: string }>;
};
export type FulfillmentSnapshot = { items?: FulfillmentLine[] | null; shipments?: FulfillmentShipment[] | null };
// A fixed epsilon must never erase an entire valid micro-quantity line. Permit
// floating-point addition noise only, bounded by the business precision cap.
const tolerance = (quantity: number) => Math.min(0.000001, Math.abs(quantity) * Number.EPSILON * 16);
const unitKey = (unit?: string) => String(unit || '').trim().toLowerCase();
const validQuantity = (quantity: unknown) => typeof quantity === 'number' && Number.isFinite(quantity) && quantity >= 0;

export function getOrderFulfillment(order: FulfillmentSnapshot) {
  const items = order.items || [];
  const shipments = order.shipments || [];
  let needsReview = items.length === 0;
  const lines = items.map(item => ({ orderItemId: item.id, productName: item.productName || '', unit: item.unit,
    orderedQuantity: item.quantity, allocatedQuantity: 0, dispatchedQuantity: 0, acceptedQuantity: 0,
    outstandingQuantity: item.quantity, unallocatedQuantity: item.quantity }));
  const byId = new Map(lines.map(line => [line.orderItemId, line]));
  if (byId.size !== lines.length || items.some(item => !validQuantity(item.quantity) || item.quantity <= 0 || !unitKey(item.unit))) needsReview = true;

  for (const shipment of shipments) {
    const status = String(shipment.status || '').toLowerCase();
    if (['cancelled', 'reversed', 'void'].includes(status)) continue;
    const line = shipment.orderItemId ? byId.get(shipment.orderItemId) : undefined;
    if (!line || !validQuantity(shipment.quantity) || !unitKey(shipment.unit) || unitKey(shipment.unit) !== unitKey(line.unit)) {
      needsReview = true;
      continue;
    }
    const quantity = shipment.quantity!;
    if (!['pending', 'in_transit', 'shipped', 'delivered', 'exception'].includes(status)) { needsReview = true; continue; }
    // Exception shipments need governed resolution before replacement allocation;
    // accepted portions still count, rejected portions never count as delivered.
    line.allocatedQuantity += quantity;
    if (['in_transit', 'shipped', 'delivered', 'exception'].includes(status) && (status !== 'exception' || shipment.shippedAt)) line.dispatchedQuantity += quantity;
    if (status === 'exception') needsReview = true;
    let accepted = 0;
    let rejected = 0;
    for (const receipt of shipment.receipts || []) {
      if (!validQuantity(receipt.acceptedQuantity) || !validQuantity(receipt.rejectedQuantity) || unitKey(receipt.unit) !== unitKey(line.unit)) {
        needsReview = true;
        continue;
      }
      accepted += receipt.acceptedQuantity;
      rejected += receipt.rejectedQuantity;
    }
    if (accepted + rejected > quantity + tolerance(quantity) || rejected > 0 || (accepted > 0 && status === 'pending')) needsReview = true;
    if (status !== 'pending') line.acceptedQuantity += Math.min(accepted, quantity);
    if (status === 'delivered' && accepted + tolerance(quantity) < quantity) needsReview = true;
  }
  for (const line of lines) {
    const epsilon = tolerance(line.orderedQuantity);
    const remaining = (quantity: number) => quantity <= epsilon ? 0 : quantity;
    line.outstandingQuantity = remaining(line.orderedQuantity - line.acceptedQuantity);
    line.unallocatedQuantity = remaining(line.orderedQuantity - line.allocatedQuantity);
    if (line.allocatedQuantity > line.orderedQuantity + epsilon || line.acceptedQuantity > line.orderedQuantity + epsilon) needsReview = true;
  }
  const fullyDelivered = !needsReview && lines.every(line => line.acceptedQuantity > 0 && line.outstandingQuantity === 0)
    && shipments.filter(shipment => !['cancelled', 'reversed', 'void'].includes(String(shipment.status || '').toLowerCase()))
      .every(shipment => String(shipment.status || '').toLowerCase() === 'delivered');
  return { lines, fullyDelivered, needsReview,
    hasAccepted: lines.some(line => line.acceptedQuantity > 0),
    hasDispatched: lines.some(line => line.dispatchedQuantity > 0),
    hasUnallocated: lines.some(line => line.unallocatedQuantity > 0) };
}
