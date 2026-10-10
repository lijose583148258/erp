import type { TransactionClient } from './stock-movement.service';

export type GenealogyConsumption = {
  stockBalanceId: number;
  quantity: number;
  stock: {
    materialId: number | null;
    batchNo: string;
    productName: string;
    unit: string;
  } | null;
};

export type GenealogyOutput = {
  id: number;
  materialId: number | null;
  batchNo: string;
  productName: string;
};

export async function persistBatchGenealogyEdges(
  tx: TransactionClient,
  input: {
    workOrderId: number;
    outputQuantity: number;
    outputBatch: GenealogyOutput;
    consumptions: GenealogyConsumption[];
  },
) {
  for (const record of input.consumptions) {
    if (!record.stock) throw new Error(`Genealogy input snapshot is missing: ${record.stockBalanceId}`);
    await tx.batchGenealogyEdge.create({
      data: {
        workOrderId: input.workOrderId,
        inputStockBalanceId: record.stockBalanceId,
        inputMaterialId: record.stock.materialId,
        inputBatchNo: record.stock.batchNo,
        inputProductName: record.stock.productName,
        quantityConsumed: record.quantity,
        inputUnit: record.stock.unit,
        outputBatchId: input.outputBatch.id,
        outputMaterialId: input.outputBatch.materialId,
        outputBatchNo: input.outputBatch.batchNo,
        outputProductName: input.outputBatch.productName,
        outputQuantity: input.outputQuantity,
      },
    });
  }
}
