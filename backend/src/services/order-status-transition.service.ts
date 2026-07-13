import type { Prisma } from '@prisma/client';

type OrderStatusClient = Pick<Prisma.TransactionClient, 'order'>;

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

  return result.count === 1;
}
