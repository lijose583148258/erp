const prismaMock = {
  productionBom: {
    count: jest.fn(),
    findMany: jest.fn(),
  },
  productionWorkOrder: {
    findMany: jest.fn(),
    groupBy: jest.fn(),
    aggregate: jest.fn(),
  },
  productBatch: {
    count: jest.fn(),
  },
  productionQualityCheck: {
    groupBy: jest.fn(),
  },
};

jest.mock('../config/database', () => ({
  __esModule: true,
  default: prismaMock,
}));

import { ProductionQueryService } from './production-query.service';

describe('ProductionQueryService.getSummary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.productionBom.count.mockResolvedValue(12);
    prismaMock.productionBom.findMany.mockResolvedValue([]);
    prismaMock.productionWorkOrder.findMany.mockResolvedValue([]);
    prismaMock.productBatch.count.mockResolvedValue(30);
    prismaMock.productionWorkOrder.groupBy.mockResolvedValue([
      { status: 'planned', _count: { _all: 3 } },
      { status: 'in_progress', _count: { _all: 4 } },
      { status: 'qc_pending', _count: { _all: 2 } },
      { status: 'completed', _count: { _all: 9 } },
    ]);
    prismaMock.productionWorkOrder.aggregate.mockResolvedValue({
      _sum: {
        targetQuantity: 1000,
        producedQuantity: 880,
        lossQuantity: 12,
      },
    });
    prismaMock.productionQualityCheck.groupBy.mockResolvedValue([
      { result: 'pass', _count: { _all: 8 } },
      { result: 'fail', _count: { _all: 1 } },
    ]);
  });

  it('uses database aggregation instead of loading every work order and quality row', async () => {
    const result = await ProductionQueryService.getSummary();

    expect(prismaMock.productionWorkOrder.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.productionWorkOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 20 }));
    expect(prismaMock.productionWorkOrder.groupBy).toHaveBeenCalledTimes(1);
    expect(prismaMock.productionWorkOrder.aggregate).toHaveBeenCalledTimes(1);
    expect(prismaMock.productionQualityCheck.groupBy).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      bomCount: 12,
      workOrderCount: 18,
      batchCount: 30,
      activeWorkOrders: 9,
      completedWorkOrders: 9,
      qcPendingCount: 2,
      totalTargetQuantity: 1000,
      totalProducedQuantity: 880,
      totalLossQuantity: 12,
      passCount: 8,
      failCount: 1,
    });
  });
});
