import { Prisma } from '@prisma/client';

// Creating a work order and changing a BOM's material identity must acquire the
// same parent locks. An existence check alone races with the first work order.
// Raw self-assignment obtains a write lock on SQLite and PostgreSQL without
// changing the revision, timestamp, formula, or historical audit fields.
export async function lockBomRevisions(tx: Prisma.TransactionClient, bomIds: number[]) {
  const ids = [...new Set(bomIds)].sort((a, b) => a - b);
  for (const id of ids) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('WORK_ORDER_BOM_ID_INVALID');
    await tx.$executeRaw`UPDATE "production_boms" SET "version" = "version" WHERE "id" = ${id}`;
  }
}

export async function assertBomRevisionsUnused(tx: Prisma.TransactionClient, bomIds: number[]) {
  await lockBomRevisions(tx, bomIds);
  if (!bomIds.length) return;
  // Completed and cancelled work orders also retain their historical recipe.
  const referenced = await tx.productionWorkOrder.count({ where: { bomId: { in: [...new Set(bomIds)] } } });
  if (referenced > 0) throw new Error('MATERIAL_BOM_REVISION_FROZEN');
}
