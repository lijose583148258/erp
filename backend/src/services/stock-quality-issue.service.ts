import type { StockMovementLineInput, StockSourceType, TransactionClient } from './stock-movement.types';
import { StockMovementConflictError } from './stock-movement.errors';
import { assertLatestIncomingQualityRelease } from './incoming-quality.service';

const QUALITY_CONTROLLED_ISSUES = new Set<StockSourceType>(['production_consumption', 'shipping_issue', 'barter_issue']);

// Call after the StockBalance write, inside the same transaction, before
// batch/cost posting. Preserve the existing stock -> batch lock order. QC
// decisions also write this row; a preflight read alone cannot exclude a race.
export async function assertStockQualityForIssue(tx: TransactionClient, source: StockSourceType, line: StockMovementLineInput) {
  if (line.quantityDelta >= 0 || !QUALITY_CONTROLLED_ISSUES.has(source)) return;
  await tx.$executeRaw`UPDATE "product_batches" SET "quality_status" = "quality_status" WHERE "batch_no" = ${line.batchNo}`;
  const batch = await tx.productBatch.findUnique({
    where: { batchNo: line.batchNo },
    select: { id: true, materialId: true, productName: true, qualityStatus: true },
  });
  if (!batch || (line.materialId ? batch.materialId !== line.materialId : batch.productName !== line.productName)) {
    throw new StockMovementConflictError(`STOCK_QC_BATCH_IDENTITY_REQUIRED:${line.batchNo}`);
  }
  if (!['released', 'not_required'].includes(batch.qualityStatus)) {
    throw new StockMovementConflictError(`STOCK_QC_RELEASE_REQUIRED:${line.batchNo}:${batch.qualityStatus}：批次未放行，禁止发料或出库`);
  }
  const incoming = await tx.purchaseReceipt.findFirst({ where: { OR: [{ batchId: batch.id }, { batchNo: line.batchNo }] }, select: { id: true } });
  if (incoming) {
    await assertLatestIncomingQualityRelease(tx, batch.id);
  } else {
    // Legacy full-receive could post stock without a Receipt. A missing row
    // does not turn known procurement stock into exempt production/initial stock.
    const orphanIncoming = await tx.stockMovement.findFirst({ where: { batchNo: line.batchNo,
      entry: { is: { sourceType: 'procurement_receipt', status: 'posted' } } }, select: { id: true } });
    if (orphanIncoming) throw new StockMovementConflictError(`INCOMING_HISTORY_UNRECONCILED:${line.batchNo}`);
  }
}
