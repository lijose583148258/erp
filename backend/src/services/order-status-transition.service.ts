import type { Prisma } from '@prisma/client';
import { assertMaterialReleaseReadiness } from './material-release-readiness.service';
import { OrderFulfillmentIncompleteError, readOrderFulfillment } from './order-fulfillment.service';

type OrderStatusClient = Pick<Prisma.TransactionClient, 'order' | 'orderItem' | 'material'>;

export async function compareAndSetOrderStatus(
  db: OrderStatusClient,
  input: {
    orderId: number;
    expectedStatus: string;
    targetStatus: string;
    requiredWhere?: Prisma.OrderWhereInput;
  },
) {
  const result = await db.order.updateMany({
    where: {
      AND: [
        { id: input.orderId, status: input.expectedStatus },
        input.requiredWhere || {},
        ...(input.targetStatus === 'completed' ? [{ paymentStatus: 'paid' }] : []),
      ],
    },
    data: { status: input.targetStatus },
  });

  if (result.count !== 1) return false;

  // Must run inside the caller's transaction: a failed quantity check rolls the
  // row claim back, including both manual status and dedicated completion APIs.
  if (['delivered', 'completed'].includes(input.targetStatus)) {
    const fulfillment = await readOrderFulfillment(db, input.orderId);
    if (!fulfillment.fullyDelivered) throw new OrderFulfillmentIncompleteError(fulfillment);
  }

  // Claim the order row first. Any readiness failure then rolls the surrounding
  // transaction back, while concurrent item replacement cannot slip between
  // the check and confirmation.
  if (input.targetStatus === 'confirmed') {
    const lines = await db.orderItem.findMany({
      where: { orderId: input.orderId },
      select: { id: true, materialId: true, productName: true, unit: true },
      orderBy: { id: 'asc' },
    });
    await assertMaterialReleaseReadiness(db, {
      entityType: 'sales_order',
      entityId: input.orderId,
      action: 'confirm',
      lines: lines.map((line, index) => ({
        lineKey: line.id,
        rowNumber: index + 1,
        materialId: line.materialId,
        displayName: line.productName,
        unit: line.unit,
      })),
    });
  }

  return true;
}
