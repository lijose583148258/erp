import {
  DEFAULT_BATCH_SHELF_LIFE_MS,
  PRODUCT_BATCH_SYNC_SOURCE_TYPES,
} from './stock-movement.policy';
import type {
  StockMovementLineInput,
  StockSourceType,
  TransactionClient,
} from './stock-movement.types';

export const syncProductBatchForOperationalStock = async (
  tx: TransactionClient,
  sourceType: StockSourceType,
  line: StockMovementLineInput,
) => {
  if (!PRODUCT_BATCH_SYNC_SOURCE_TYPES.has(sourceType)) {
    return null;
  }

  const batch = await tx.productBatch.findUnique({
    where: { batchNo: line.batchNo },
    select: { id: true, materialId: true, productName: true, stockQuantity: true },
  });

  if (batch && line.materialId && batch.materialId && batch.materialId !== line.materialId) {
    throw new Error(`Product batch ${line.batchNo} belongs to material ${batch.materialId}, not ${line.materialId}`);
  }

  if (batch && !line.materialId && batch.productName !== line.productName) {
    throw new Error(`Product batch ${line.batchNo} belongs to ${batch.productName}, not ${line.productName}`);
  }

  if (batch && line.materialId && !batch.materialId && batch.productName !== line.productName) {
    throw new Error(`Legacy product batch ${line.batchNo} must be governed before assigning material ${line.materialId}`);
  }

  if (!batch) {
    if (line.quantityDelta < 0) {
      throw new Error(`Product batch not found for outbound stock: ${line.productName} / ${line.batchNo}`);
    }

    const governedShelfLifeDays = Number(line.shelfLifeDays || 0);
    if (line.materialId && (!Number.isInteger(governedShelfLifeDays) || governedShelfLifeDays < 1 || governedShelfLifeDays > 3650)) {
      throw new Error(`STOCK_MATERIAL_SHELF_LIFE_REQUIRED:${line.materialId}`);
    }
    const expiryDurationMs = line.materialId
      ? governedShelfLifeDays * 24 * 60 * 60 * 1000
      : DEFAULT_BATCH_SHELF_LIFE_MS;

    const created = await tx.productBatch.create({
      data: {
        materialId: line.materialId || null,
        batchNo: line.batchNo,
        productName: line.productName,
        productionDate: new Date(),
        expiryDate: new Date(Date.now() + expiryDurationMs),
        stockQuantity: line.quantityDelta,
        unit: line.unit || 'kg',
        isColdChain: false,
        notes: `Created from stock entry ${sourceType}`,
      },
      select: { id: true, stockQuantity: true },
    });
    return {
      batchId: created.id,
      quantityBefore: 0,
      quantityAfter: Number(created.stockQuantity || 0),
    };
  }

  const quantityBefore = Number(batch.stockQuantity || 0);

  if (line.quantityDelta < 0) {
    const updated = await tx.productBatch.updateMany({
      where: {
        id: batch.id,
        stockQuantity: { gte: Math.abs(line.quantityDelta) },
      },
      data: {
        stockQuantity: { decrement: Math.abs(line.quantityDelta) },
        materialId: line.materialId || batch.materialId,
        productName: line.productName,
        unit: line.unit || 'kg',
      },
    });

    if (updated.count !== 1) {
      throw new Error(`Insufficient product batch stock for ${line.productName} / ${line.batchNo}`);
    }
    return {
      batchId: batch.id,
      quantityBefore,
      quantityAfter: quantityBefore + line.quantityDelta,
    };
  }

  const updated = await tx.productBatch.update({
    where: { id: batch.id },
    data: {
      stockQuantity: { increment: line.quantityDelta },
      materialId: line.materialId || batch.materialId,
      productName: line.productName,
      unit: line.unit || 'kg',
    },
    select: { id: true, stockQuantity: true },
  });
  return {
    batchId: updated.id,
    quantityBefore,
    quantityAfter: Number(updated.stockQuantity || 0),
  };
};
