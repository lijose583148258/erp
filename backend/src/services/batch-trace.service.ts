import prisma from '../config/database';

export class BatchTraceService {
  static async getBatchTrace(batchId: number) {
    const batch = await prisma.productBatch.findUnique({
      where: { id: batchId },
      select: {
        id: true,
        materialId: true,
        batchNo: true,
        productName: true,
        productionDate: true,
        expiryDate: true,
        stockQuantity: true,
        unit: true,
      },
    });
    if (!batch) throw new Error(`Product batch not found: ${batchId}`);

    const [upstream, downstream, shipments] = await Promise.all([
      prisma.batchGenealogyEdge.findMany({
        where: { outputBatchId: batch.id },
        orderBy: { id: 'asc' },
        include: { workOrder: { select: { id: true, workOrderNo: true, status: true } } },
      }),
      prisma.batchGenealogyEdge.findMany({
        where: batch.materialId
          ? { inputMaterialId: batch.materialId, inputBatchNo: batch.batchNo }
          : { inputProductName: batch.productName, inputBatchNo: batch.batchNo },
        orderBy: { id: 'asc' },
        include: {
          workOrder: { select: { id: true, workOrderNo: true, status: true } },
          outputBatch: { select: { id: true, materialId: true, batchNo: true, productName: true, stockQuantity: true, unit: true } },
        },
      }),
      prisma.shipment.findMany({
        where: {
          OR: [
            { productBatchId: batch.id },
            batch.materialId
              ? { materialId: batch.materialId, batchNo: batch.batchNo }
              : { productName: batch.productName, batchNo: batch.batchNo },
          ],
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          shipmentNo: true,
          quantity: true,
          unit: true,
          status: true,
          shippedAt: true,
          deliveredAt: true,
          order: { select: { id: true, orderNo: true } },
          customer: { select: { id: true, name: true, nameZh: true, nameEn: true, nameVi: true } },
        },
      }),
    ]);

    return {
      scope: 'direct-one-hop',
      batch,
      upstreamInputs: upstream,
      downstreamOutputs: downstream,
      downstreamShipments: shipments,
      summary: {
        upstreamLotCount: upstream.length,
        downstreamBatchCount: new Set(downstream.map(edge => edge.outputBatchId)).size,
        shipmentCount: shipments.length,
        customerCount: new Set(shipments.map(item => item.customer.id)).size,
      },
    };
  }
}
