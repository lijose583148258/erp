import prisma from '../config/database';

export type ProductionWorkOrderStatus = 'draft' | 'planned' | 'in_progress' | 'qc_pending' | 'completed' | 'cancelled';
export type ProductionQualityResult = 'pending' | 'pass' | 'fail';

export interface ProductionBomItemInput {
  materialName?: string | null;
  materialCode?: string | null;
  ingredientRole?: string | null;
  dosageMode?: string | null;
  percentage?: number | null;
  quantityPerUnit: number;
  unit: string;
  lossRate?: number | null;
  allowedVarianceRate?: number | null;
  processStage?: string | null;
  substituteGroup?: string | null;
  yieldContribution?: number | null;
  notes?: string | null;
}

export interface ProductionBomInput {
  productName: string;
  version?: string | null;
  bomType?: string | null;
  status?: string | null;
  formulationMode?: string | null;
  outputUnit: string;
  standardBatchSize?: number | null;
  batchSizeUnit?: string | null;
  density?: number | null;
  solidContent?: number | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  processJson?: string | null;
  qualitySpecJson?: string | null;
  notes?: string | null;
  items?: ProductionBomItemInput[];
}

export interface ProductionWorkOrderStepInput {
  stepNo?: number;
  title: string;
  operatorName?: string | null;
  note?: string | null;
}

export interface ProductionWorkOrderInput {
  bomId?: number | null;
  batchId?: number | null;
  productName: string;
  targetQuantity: number;
  producedQuantity?: number | null;
  lossQuantity?: number | null;
  plannedStartAt?: string | null;
  plannedEndAt?: string | null;
  note?: string | null;
  steps?: ProductionWorkOrderStepInput[];
}

export interface ProductionQualityCheckInput {
  result: ProductionQualityResult;
  defectRate?: number | null;
  note?: string | null;
  checkedBy?: string | null;
}

const serializeDate = (value: Date | null | undefined) => value ? value.toISOString() : null;
const normalizeMaterialLookupTokens = (...values: Array<unknown>) => (
  Array.from(new Set(values
    .map(value => String(value ?? '').trim())
    .filter(Boolean)))
);
const floorQuantity = (value: number, precision = 6) => {
  const factor = 10 ** precision;
  return Math.floor((value + Number.EPSILON) * factor) / factor;
};

const resolveEffectiveQuantityPerUnit = (item: {
  dosageMode?: string | null;
  percentage?: number | null;
  quantityPerUnit?: number | null;
}) => {
  const dosageMode = String(item.dosageMode || '').trim();
  const percentage = Number(item.percentage || 0);
  if (dosageMode === 'percentage' && Number.isFinite(percentage) && percentage > 0) {
    return percentage / 100;
  }

  const quantityPerUnit = Number(item.quantityPerUnit || 0);
  return Number.isFinite(quantityPerUnit) && quantityPerUnit > 0 ? quantityPerUnit : 0;
};

export class ProductionQueryService {
  static async getSummary() {
    const [bomCount, workOrders, batches] = await Promise.all([
      prisma.productionBom.count(),
      prisma.productionWorkOrder.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          bom: { select: { id: true, bomNo: true, productName: true, version: true } },
          productBatch: { select: { id: true, batchNo: true, productName: true, stockQuantity: true, unit: true } },
        },
      }),
      prisma.productBatch.count(),
    ]);

    const allOrders = await prisma.productionWorkOrder.findMany({
      select: {
        targetQuantity: true,
        producedQuantity: true,
        lossQuantity: true,
        status: true,
      },
    });

    const completed = allOrders.filter(item => item.status === 'completed').length;
    const active = allOrders.filter(item => ['planned', 'in_progress', 'qc_pending'].includes(item.status)).length;
    const qcPending = allOrders.filter(item => item.status === 'qc_pending').length;
    const totalTarget = allOrders.reduce((sum, item) => sum + Number(item.targetQuantity || 0), 0);
    const totalProduced = allOrders.reduce((sum, item) => sum + Number(item.producedQuantity || 0), 0);
    const totalLoss = allOrders.reduce((sum, item) => sum + Number(item.lossQuantity || 0), 0);

    const qcChecks = await prisma.productionQualityCheck.findMany({
      select: { result: true },
    });

    const passCount = qcChecks.filter(item => item.result === 'pass').length;
    const failCount = qcChecks.filter(item => item.result === 'fail').length;

    return {
      bomCount,
      workOrderCount: allOrders.length,
      batchCount: batches,
      activeWorkOrders: active,
      completedWorkOrders: completed,
      qcPendingCount: qcPending,
      totalTargetQuantity: totalTarget,
      totalProducedQuantity: totalProduced,
      totalLossQuantity: totalLoss,
      passCount,
      failCount,
      recentWorkOrders: workOrders.map(order => ({
        ...order,
        plannedStartAt: serializeDate(order.plannedStartAt),
        plannedEndAt: serializeDate(order.plannedEndAt),
        actualStartAt: serializeDate(order.actualStartAt),
        actualEndAt: serializeDate(order.actualEndAt),
        createdAt: serializeDate(order.createdAt),
        updatedAt: serializeDate(order.updatedAt),
      })),
    };
  }

  static async listBoms() {
    const items = await prisma.productionBom.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        creator: { select: { id: true, username: true, role: true } },
        items: { orderBy: { id: 'asc' } },
        workOrders: {
          select: { id: true, workOrderNo: true, status: true, targetQuantity: true, producedQuantity: true, lossQuantity: true },
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });

    return items.map(item => ({
      ...item,
      effectiveFrom: serializeDate(item.effectiveFrom),
      effectiveTo: serializeDate(item.effectiveTo),
      createdAt: serializeDate(item.createdAt),
      updatedAt: serializeDate(item.updatedAt),
    }));
  }

  static async listWorkOrders(filters: { status?: string; bomId?: number; batchId?: number; keyword?: string } = {}) {
    const where: Record<string, any> = {};
    if (filters.status) where.status = filters.status;
    if (filters.bomId) where.bomId = filters.bomId;
    if (filters.batchId) where.batchId = filters.batchId;
    if (filters.keyword) {
      where.OR = [
        { workOrderNo: { contains: filters.keyword } },
        { productName: { contains: filters.keyword } },
      ];
    }

    const items = await prisma.productionWorkOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        bom: { select: { id: true, bomNo: true, productName: true, version: true, outputUnit: true } },
        productBatch: { select: { id: true, batchNo: true, productName: true, stockQuantity: true, unit: true } },
        steps: { orderBy: { stepNo: 'asc' } },
        qualityChecks: { orderBy: { createdAt: 'desc' } },
      },
    });

    return items.map(item => ({
      ...item,
      plannedStartAt: serializeDate(item.plannedStartAt),
      plannedEndAt: serializeDate(item.plannedEndAt),
      actualStartAt: serializeDate(item.actualStartAt),
      actualEndAt: serializeDate(item.actualEndAt),
      createdAt: serializeDate(item.createdAt),
      updatedAt: serializeDate(item.updatedAt),
      steps: item.steps.map(step => ({
        ...step,
        startedAt: serializeDate(step.startedAt),
        completedAt: serializeDate(step.completedAt),
        createdAt: serializeDate(step.createdAt),
        updatedAt: serializeDate(step.updatedAt),
      })),
      qualityChecks: item.qualityChecks.map(check => ({
        ...check,
        checkedAt: serializeDate(check.checkedAt),
        createdAt: serializeDate(check.createdAt),
        updatedAt: serializeDate(check.updatedAt),
      })),
    }));
  }

  static async previewWorkOrderConsumption(workOrderId: number) {
    const workOrder = await prisma.productionWorkOrder.findUnique({
      where: { id: workOrderId },
      include: {
        bom: { include: { items: true } },
      },
    });

    if (!workOrder || !workOrder.bom) {
      throw new Error(`Work order or BOM not found for ID: ${workOrderId}`);
    }

    const targetQuantity = Number(workOrder.targetQuantity || 0);
    const suggestions = [];

    for (const item of workOrder.bom.items) {
      const requiredQty = resolveEffectiveQuantityPerUnit(item) * targetQuantity * (1 + Number(item.lossRate || 0) / 100);
      if (requiredQty <= 0) continue;
      const lookupTokens = normalizeMaterialLookupTokens((item as any).materialCode, item.materialName);
      const lookupWhere = lookupTokens.length > 0
        ? {
            OR: lookupTokens.flatMap(token => [
              { productName: { contains: token } },
              { batchNo: { contains: token } },
            ]),
            quantity: { gt: 0 },
          }
        : { productName: item.materialName, quantity: { gt: 0 } };

      const stocks = await prisma.stockBalance.findMany({
        where: lookupWhere,
        orderBy: { createdAt: 'asc' }, // FIFO: 先进先出
        include: { location: { include: { warehouse: true } } },
      });

      let remainingToDeduct = requiredQty;
      const pickList = [];

      for (const stock of stocks) {
        if (remainingToDeduct <= 0) break;
        const available = Number(stock.quantity || 0);
        const deduct = floorQuantity(Math.min(available, remainingToDeduct));
        if (deduct <= 0) continue;
        pickList.push({
          stockBalanceId: stock.id,
          locationId: stock.locationId,
          locationName: `${stock.location.warehouse.name} - ${stock.location.name}`,
          batchNo: stock.batchNo,
          availableQty: available,
          deductQty: deduct,
        });
        remainingToDeduct -= deduct;
      }

      suggestions.push({
        materialName: (item as any).materialCode || item.materialName,
        requiredQty,
        shortageQty: remainingToDeduct > 0 ? remainingToDeduct : 0,
        pickList,
      });
    }

    return suggestions;
  }
}
