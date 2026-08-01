import type { Prisma } from '@prisma/client';
import { assertMaterialReleaseReadiness } from './material-release-readiness.service';

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
      ],
    },
    data: { status: input.targetStatus },
  });

  if (result.count !== 1) return false;

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
