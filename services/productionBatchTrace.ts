export interface ProductionGenealogyEdge {
  id: number;
  inputBatchNo: string;
  inputProductName: string;
  quantityConsumed: number;
  inputUnit: string;
  outputBatchId: number;
  outputBatchNo: string;
  outputProductName: string;
  workOrder: { id: number; workOrderNo: string; status: string };
}

export interface ProductionBatchTrace {
  scope: 'direct-one-hop';
  batch: { id: number; batchNo: string };
  upstreamInputs: ProductionGenealogyEdge[];
  downstreamOutputs: ProductionGenealogyEdge[];
}

export function readProductionBatchTrace(batchId: number, response: { success?: boolean; data?: ProductionBatchTrace }): ProductionBatchTrace {
  const data = response?.data;
  if (!response?.success || data?.batch?.id !== batchId || data.scope !== 'direct-one-hop'
    || !Array.isArray(data.upstreamInputs) || !Array.isArray(data.downstreamOutputs)
    || ![...data.upstreamInputs, ...data.downstreamOutputs].every(edge => edge && Number.isSafeInteger(edge.id)
      && typeof edge.inputBatchNo === 'string' && typeof edge.outputBatchNo === 'string'
      && Number.isFinite(edge.quantityConsumed) && edge.quantityConsumed > 0 && typeof edge.inputUnit === 'string'
      && edge.workOrder && typeof edge.workOrder.workOrderNo === 'string')) {
    throw new Error('批次追溯回读不完整，请重试');
  }
  return data;
}
