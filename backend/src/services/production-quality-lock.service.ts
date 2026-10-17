import type { TransactionClient } from './stock-movement.types';

// Inspection revision allocation, review and completion share this parent
// lock on both SQLite and PostgreSQL. No revision or timestamp is rewritten.
export async function lockQualityWorkOrder(tx: TransactionClient, workOrderId: number) {
  await tx.$executeRaw`UPDATE "production_work_orders" SET "status" = "status" WHERE "id" = ${workOrderId}`;
}
