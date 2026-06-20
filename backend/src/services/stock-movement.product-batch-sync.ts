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
    select: { id: true, productName: true, stockQuantity: true },
  });

  if (batch && batch.productName !== line.productName) {
    throw new Error(`Product batch ${line.batchNo} belongs to ${batch.productName}, not ${line.productName}`);
  }

  if (!batch) {
    if (line.quantityDelta < 0) {
      throw new Error(`Product batch not found for outbound stock: ${line.productName} / ${line.batchNo}`);
    }

    const created = await tx.productBatch.create({
      data: {
        batchNo: line.batchNo,
        productName: line.productName,
        productionDate: new Date(),
        expiryDate: new Date(Date.now() + DEFAULT_BATCH_SHELF_LIFE_MS),
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
