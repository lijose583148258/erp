import { persistBatchGenealogyEdges } from './batch-genealogy-write.service';

describe('batch genealogy write', () => {
  it('persists actual input lot consumption against the governed output batch', async () => {
    const create = jest.fn().mockResolvedValue({ id: 1 });
    await persistBatchGenealogyEdges({ batchGenealogyEdge: { create } } as any, {
      workOrderId: 5,
      outputQuantity: 100,
      outputBatch: { id: 8, materialId: 20, batchNo: 'FG-001', productName: '成品乳液' },
      consumptions: [{
        stockBalanceId: 7,
        quantity: 37.5,
        stock: { materialId: 10, batchNo: 'RM-001', productName: '丙烯酸单体', unit: 'kg' },
      }],
    });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({
      workOrderId: 5,
      inputStockBalanceId: 7,
      inputMaterialId: 10,
      inputBatchNo: 'RM-001',
      quantityConsumed: 37.5,
      outputBatchId: 8,
      outputMaterialId: 20,
      outputBatchNo: 'FG-001',
      outputQuantity: 100,
    }) });
  });

  it('fails closed when the confirmed stock snapshot disappeared', async () => {
    await expect(persistBatchGenealogyEdges({ batchGenealogyEdge: { create: jest.fn() } } as any, {
      workOrderId: 5,
      outputQuantity: 100,
      outputBatch: { id: 8, materialId: 20, batchNo: 'FG-001', productName: '成品乳液' },
      consumptions: [{ stockBalanceId: 7, quantity: 1, stock: null }],
    })).rejects.toThrow('Genealogy input snapshot is missing');
  });
});
