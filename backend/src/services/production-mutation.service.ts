import type { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { buildBusinessNo } from '../utils/businessNo';
import { ProductionCostLedgerService } from './production-cost-ledger.service';
import { StockMovementService, type TransactionClient } from './stock-movement.service';
import {
  ProductionBomInput,
  ProductionQualityCheckInput,
  ProductionQualityResult,
  ProductionWorkOrderInput,
  ProductionWorkOrderStatus,
  ProductionWorkOrderStepInput,
} from './production-query.service';
import { assertBomConsumptionCoverage } from './production-completion.validation';

export { ProductionCompletionValidationError } from './production-completion.validation';

const DEFAULT_STEPS = ['备料', '生产', '质检'];

const toDateOrNull = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const buildNo = (prefix: string) => buildBusinessNo(prefix);
const toPositiveNumber = (value: unknown) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};
const roundQuantity = (value: number, precision = 6) => {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

export const calculateBatchExpiryDate = (productionDate: Date, shelfLifeDays: unknown) => {
  const days = Number(shelfLifeDays);
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new Error('BOM 缺少有效的保质期天数，禁止自动创建成品批次。');
  }
  return new Date(productionDate.getTime() + days * 24 * 60 * 60 * 1000);
};

const normalizeBomQuantityPerUnit = (item: NonNullable<ProductionBomInput['items']>[number]) => {
  const dosageMode = String(item.dosageMode || '').trim();
  const percentage = Number(item.percentage || 0);
  const rawQuantity = toPositiveNumber(item.quantityPerUnit);

  if (dosageMode === 'percentage' && Number.isFinite(percentage) && percentage > 0) {
    return roundQuantity(percentage / 100);
  }

  return rawQuantity;
};

const resolveFinishedGoodsLocationId = async (tx: TransactionClient) => {
  const finishedGoodsLocation = await tx.location.findFirst({
    where: { code: 'LOC-FG', status: 'active' },
    select: { id: true },
  });
  if (finishedGoodsLocation) return finishedGoodsLocation.id;

  const fallbackLocation = await tx.location.findFirst({
    where: { type: 'internal', status: 'active' },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  if (fallbackLocation) return fallbackLocation.id;

  throw new Error('Finished goods location is not configured');
};

const WORK_ORDER_STATUS_RANK: Record<ProductionWorkOrderStatus, number> = {
  draft: 0,
  planned: 1,
  in_progress: 2,
  qc_pending: 3,
  completed: 4,
  cancelled: 5,
};

const readWorkOrderDetail = (tx: TransactionClient, id: number) => tx.productionWorkOrder.findUnique({
  where: { id },
  include: {
    bom: { select: { id: true, bomNo: true, productName: true, version: true, outputUnit: true, shelfLifeDays: true } },
    productBatch: {
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
    },
    steps: { orderBy: { stepNo: 'asc' } },
    qualityChecks: { orderBy: { createdAt: 'desc' } },
  },
});

export class ProductionMutationService {
  static async createBom(input: ProductionBomInput, createdBy: number) {
    const bomNo = buildNo('BOM');
    const draftItems = (input.items || [])
      .map(item => ({
        ...item,
        materialName: String(item.materialName || item.materialCode || '').trim(),
        materialCode: item.materialCode ? String(item.materialCode).trim() : null,
        quantityPerUnit: normalizeBomQuantityPerUnit(item),
      }))
      .filter(item => (item.materialId || item.materialName) && Number(item.quantityPerUnit || 0) > 0);

    return prisma.$transaction(async tx => {
      const materialIds = Array.from(new Set(
        draftItems
          .map(item => Number(item.materialId || 0))
          .filter(id => Number.isInteger(id) && id > 0),
      ));
      const materials = materialIds.length > 0
        ? await tx.material.findMany({
          where: { id: { in: materialIds } },
          select: {
            id: true,
            code: true,
            nameZh: true,
            baseUnit: true,
            status: true,
            isTemporary: true,
          },
        })
        : [];
      if (materials.length !== materialIds.length) {
        throw new Error('BOM_MATERIAL_NOT_FOUND');
      }
      const materialById = new Map(materials.map(material => [material.id, material]));
      const controlledBom = (input.status || 'draft') !== 'draft';
      const items = draftItems.map((item, index) => {
        const materialId = item.materialId ? Number(item.materialId) : null;
        if (!materialId) {
          if (controlledBom) throw new Error(`BOM_MATERIAL_MASTER_REQUIRED:${index + 1}`);
          return { ...item, materialId: null };
        }
        const material = materialById.get(materialId);
        if (!material) throw new Error('BOM_MATERIAL_NOT_FOUND');
        if (material.status === 'blocked' || material.status === 'retired') {
          throw new Error(`BOM_MATERIAL_UNAVAILABLE:${material.code}`);
        }
        if (controlledBom && (material.status !== 'active' || material.isTemporary)) {
          throw new Error(`BOM_MATERIAL_NOT_RELEASED:${material.code}`);
        }
        if (item.unit.trim().toLocaleLowerCase() !== material.baseUnit.trim().toLocaleLowerCase()) {
          throw new Error(`BOM_MATERIAL_UNIT_MISMATCH:${material.code}:${item.unit}:${material.baseUnit}`);
        }
        return {
          ...item,
          materialId,
          materialCode: material.code,
          materialName: material.nameZh,
        };
      });

      const created = await tx.productionBom.create({
        data: {
          bomNo,
          productName: input.productName,
          version: input.version || 'v1',
          bomType: input.bomType || 'standard',
          status: input.status || 'draft',
          formulationMode: input.formulationMode || null,
          outputUnit: input.outputUnit,
          shelfLifeDays: input.shelfLifeDays,
          standardBatchSize: input.standardBatchSize ?? null,
          batchSizeUnit: input.batchSizeUnit || null,
          density: input.density ?? null,
          solidContent: input.solidContent ?? null,
          effectiveFrom: toDateOrNull(input.effectiveFrom),
          effectiveTo: toDateOrNull(input.effectiveTo),
          processJson: input.processJson || null,
          qualitySpecJson: input.qualitySpecJson || null,
          notes: input.notes || null,
          createdBy,
          items: {
            create: items.map(item => ({
              materialId: item.materialId,
              materialName: item.materialName,
              materialCode: item.materialCode || null,
              ingredientRole: item.ingredientRole || null,
              dosageMode: item.dosageMode || null,
              percentage: item.percentage ?? null,
              quantityPerUnit: Number(item.quantityPerUnit || 0),
              unit: item.unit,
              lossRate: Number(item.lossRate || 0),
              allowedVarianceRate: item.allowedVarianceRate ?? null,
              processStage: item.processStage || null,
              substituteGroup: item.substituteGroup || null,
              yieldContribution: item.yieldContribution ?? null,
              notes: item.notes || null,
            })),
          },
        },
        include: {
          creator: { select: { id: true, username: true, role: true } },
          items: { orderBy: { id: 'asc' } },
        },
      });

      const refreshed = await tx.productionBom.findUnique({
        where: { id: created.id },
        include: {
          creator: { select: { id: true, username: true, role: true } },
          items: { orderBy: { id: 'asc' } },
        },
      });

      if (!refreshed) {
        throw new Error(`Production BOM refresh failed: ${created.id}`);
      }

      return refreshed;
    });
  }

  static async createWorkOrder(input: ProductionWorkOrderInput, createdBy: number) {
    return prisma.$transaction(async tx => {
      const stepInputs: ProductionWorkOrderStepInput[] = input.steps && input.steps.length > 0
        ? input.steps
        : DEFAULT_STEPS.map((title, index) => ({ stepNo: index + 1, title }));

      const workOrder = await tx.productionWorkOrder.create({
        data: {
          workOrderNo: buildNo('WO'),
          bomId: input.bomId ?? null,
          batchId: input.batchId ?? null,
          productName: input.productName,
          targetQuantity: Number(input.targetQuantity || 0),
          producedQuantity: Number(input.producedQuantity || 0),
          lossQuantity: Number(input.lossQuantity || 0),
          status: 'planned',
          plannedStartAt: toDateOrNull(input.plannedStartAt),
          plannedEndAt: toDateOrNull(input.plannedEndAt),
          note: input.note || null,
          createdBy,
          steps: {
            create: stepInputs.map((step, index) => ({
              stepNo: step.stepNo || index + 1,
              title: step.title || (step as ProductionWorkOrderStepInput & { name?: string }).name || `工序 ${index + 1}`,
              operatorName: step.operatorName || null,
              note: step.note || null,
            })),
          },
        },
      });

      return tx.productionWorkOrder.findUnique({
        where: { id: workOrder.id },
        include: {
          bom: { select: { id: true, bomNo: true, productName: true, version: true, outputUnit: true, shelfLifeDays: true } },
          productBatch: {
            select: {
              id: true,
              batchNo: true,
              productName: true,
              productionDate: true,
              expiryDate: true,
              stockQuantity: true,
              unit: true,
            },
          },
          steps: { orderBy: { stepNo: 'asc' } },
          qualityChecks: true,
        },
      });
    });
  }

  static async updateWorkOrderStatus(id: number, status: ProductionWorkOrderStatus, consumptionRecords?: { stockBalanceId: number; quantity: number; }[]) {
    return prisma.$transaction(async tx => {
      const workOrder = await tx.productionWorkOrder.findUnique({
        where: { id },
        include: {
          bom: { include: { items: true } },
          productBatch: true,
        },
      });

      if (!workOrder) {
        throw new Error(`Work order not found: ${id}`);
      }

      const bomItemsForValidation = workOrder.bom?.items || [];

      if (workOrder.status === status) {
        return readWorkOrderDetail(tx, workOrder.id);
      }

      if (workOrder.status === 'completed' && status !== 'completed') {
        throw new Error('Completed work order cannot transition to another status');
      }

      if (workOrder.status === 'cancelled' && status !== 'cancelled') {
        throw new Error('Cancelled work order cannot transition to another status');
      }

      if (
        WORK_ORDER_STATUS_RANK[status] < WORK_ORDER_STATUS_RANK[workOrder.status as ProductionWorkOrderStatus]
        && status !== 'cancelled'
      ) {
        throw new Error(`Work order status cannot move backward: ${workOrder.status} -> ${status}`);
      }

      const validatedConsumptionRecords: Array<{
        stockBalanceId: number;
        quantity: number;
        stock: Awaited<ReturnType<typeof tx.stockBalance.findUnique>>;
      }> = [];

      if (status === 'completed') {
        const netOutput = Math.max(0, Number(workOrder.producedQuantity || 0) - Number(workOrder.lossQuantity || 0));
        if (netOutput > 0 && !workOrder.batchId) {
          calculateBatchExpiryDate(new Date(), workOrder.bom?.shelfLifeDays);
        }
        const requiredMaterialCount = workOrder.bom?.items?.length || 0;
        const aggregatedRecords = new Map<number, number>();

        for (const record of consumptionRecords || []) {
          const stockBalanceId = Number(record.stockBalanceId);
          const quantity = roundQuantity(Number(record.quantity));
          if (!Number.isFinite(stockBalanceId) || stockBalanceId <= 0 || !Number.isInteger(stockBalanceId)) {
            throw new Error('Invalid stock balance id in consumption records');
          }
          if (!Number.isFinite(quantity) || quantity <= 0) {
            throw new Error('Invalid material consumption quantity');
          }
          aggregatedRecords.set(stockBalanceId, roundQuantity((aggregatedRecords.get(stockBalanceId) || 0) + quantity));
        }

        if (requiredMaterialCount > 0 && aggregatedRecords.size === 0) {
          throw new Error('完工前必须先确认本工单的耗料记录。');
        }

        for (const [stockBalanceId, quantity] of aggregatedRecords.entries()) {
          const currentStock = await tx.stockBalance.findUnique({
            where: { id: stockBalanceId },
            include: { location: true },
          });

          if (!currentStock) {
            throw new Error(`Stock balance not found: ${stockBalanceId}`);
          }

          if (roundQuantity(Number(currentStock.quantity || 0)) + 0.000001 < quantity) {
            throw new Error(`库存不足：${currentStock.productName} / ${currentStock.batchNo}，请先核对库存余额。`);
          }

          validatedConsumptionRecords.push({ stockBalanceId, quantity, stock: currentStock });
        }

        if (requiredMaterialCount > 0) {
          const outputQuantity = Math.max(
            toPositiveNumber(workOrder.producedQuantity),
            toPositiveNumber(workOrder.targetQuantity),
          );
          assertBomConsumptionCoverage(bomItemsForValidation, validatedConsumptionRecords, outputQuantity);
        }
      }

      const updateData: Prisma.ProductionWorkOrderUpdateInput = { status };
      if (status === 'in_progress' && !workOrder.actualStartAt) {
        updateData.actualStartAt = new Date();
      }
      if (status === 'completed') {
        updateData.actualEndAt = new Date();
      }

      const claim = await tx.productionWorkOrder.updateMany({
        where: { id, status: workOrder.status },
        data: updateData,
      });

      if (claim.count !== 1) {
        const latest = await readWorkOrderDetail(tx, id);
        if (!latest) {
          throw new Error(`Work order not found: ${id}`);
        }
        if (latest.status === status) {
          return latest;
        }
        throw new Error(`Work order status changed by another operation: ${workOrder.status} -> ${latest.status}`);
      }

      if (status === 'completed') {
        const netOutput = Math.max(0, Number(workOrder.producedQuantity || 0) - Number(workOrder.lossQuantity || 0));
        let pendingOutputLedgerInput: {
          batchId: number;
          quantityBefore: number;
          quantityDelta: number;
          note: string;
        } | null = null;

        if (netOutput > 0) {
          const outputLocationId = await resolveFinishedGoodsLocationId(tx);
          if (workOrder.batchId) {
            const currentBatch = await tx.productBatch.findUnique({
              where: { id: workOrder.batchId },
              select: { id: true, materialId: true, batchNo: true, productName: true, stockQuantity: true, unit: true },
            });
            if (!currentBatch) {
              throw new Error(`Product batch not found: ${workOrder.batchId}`);
            }
            const quantityBefore = Number(currentBatch?.stockQuantity || 0);
            await tx.productBatch.update({
              where: { id: workOrder.batchId },
              data: {
                stockQuantity: { increment: netOutput },
              },
            });
            await StockMovementService.postStockEntry({
              sourceType: 'production_output',
              sourceRef: workOrder.workOrderNo,
              reason: 'work_order_finished_goods_output',
              note: `Finished goods output from work order ${workOrder.workOrderNo}`,
              createdBy: workOrder.createdBy,
              lines: [{
                locationId: outputLocationId,
                materialId: currentBatch.materialId,
                productName: currentBatch.productName,
                batchNo: currentBatch.batchNo,
                quantityDelta: netOutput,
                unit: currentBatch.unit || workOrder.bom?.outputUnit || 'kg',
              }],
            }, tx);
            pendingOutputLedgerInput = {
              batchId: workOrder.batchId,
              quantityBefore,
              quantityDelta: netOutput,
              note: `Generated from work order ${workOrder.workOrderNo}`,
            };
          } else {
            const productionDate = new Date();
            const createdBatch = await tx.productBatch.create({
              data: {
        batchNo: buildNo(`WO-${workOrder.id}-BATCH`),
                productName: workOrder.productName,
                productionDate,
                expiryDate: calculateBatchExpiryDate(productionDate, workOrder.bom?.shelfLifeDays),
                stockQuantity: netOutput,
                unit: workOrder.bom?.outputUnit || 'kg',
                isColdChain: false,
                notes: `Generated from work order ${workOrder.workOrderNo}`,
              },
            });

            await tx.productionWorkOrder.update({
              where: { id },
              data: { batchId: createdBatch.id },
            });
            await StockMovementService.postStockEntry({
              sourceType: 'production_output',
              sourceRef: workOrder.workOrderNo,
              reason: 'work_order_finished_goods_output',
              note: `Finished goods output from work order ${workOrder.workOrderNo}`,
              createdBy: workOrder.createdBy,
              lines: [{
                locationId: outputLocationId,
                productName: createdBatch.productName,
                batchNo: createdBatch.batchNo,
                quantityDelta: netOutput,
                unit: createdBatch.unit || workOrder.bom?.outputUnit || 'kg',
              }],
            }, tx);
            pendingOutputLedgerInput = {
              batchId: createdBatch.id,
              quantityBefore: 0,
              quantityDelta: netOutput,
              note: `Generated from work order ${workOrder.workOrderNo}`,
            };
          }
        }

        let materialCostAmount = 0;
        // 处理人工确认后的扣料：先落库存凭证，再保留原有成本台账。
        if (validatedConsumptionRecords.length > 0) {
          await StockMovementService.postStockEntry({
            sourceType: 'production_consumption',
            sourceRef: workOrder.workOrderNo,
            reason: 'work_order_material_consumption',
            note: `Material consumption from work order ${workOrder.workOrderNo}`,
            createdBy: workOrder.createdBy,
            lines: validatedConsumptionRecords.map(record => ({
              locationId: record.stock?.locationId || 0,
              materialId: record.stock?.materialId || null,
              productName: record.stock?.productName || '',
              batchNo: record.stock?.batchNo || '',
              quantityDelta: -record.quantity,
              unit: record.stock?.unit || 'kg',
            })),
          }, tx);

          for (const record of validatedConsumptionRecords) {
            const currentStock = record.stock;
            if (!currentStock) {
              throw new Error(`Confirmed consumption record is missing stock snapshot for work order ${workOrder.workOrderNo}`);
            }

              // Raw materials entered through warehouse/procurement may only
              // exist as StockBalance rows. ProductBatch is optional here; the
              // stock voucher above is the authoritative inventory deduction.
              const matchBatch = await tx.productBatch.findFirst({
                where: currentStock.materialId
                  ? { materialId: currentStock.materialId, batchNo: currentStock.batchNo }
                  : { productName: currentStock.productName, batchNo: currentStock.batchNo },
                select: { id: true, stockQuantity: true },
              });

              if (!matchBatch) {
                continue;
              }

              const batchQtyBefore = Number(matchBatch.stockQuantity || 0);
              await tx.productBatch.update({
                where: { id: matchBatch.id },
                data: { stockQuantity: { decrement: record.quantity } },
              });
              const materialLedger = await ProductionCostLedgerService.recordWorkOrderCompletion(tx, {
                batchId: matchBatch.id,
                workOrderId: workOrder.id,
                workOrderNo: workOrder.workOrderNo,
                quantityBefore: batchQtyBefore,
                quantityDelta: -record.quantity,
                note: `原料扣减: ${currentStock.productName} * ${record.quantity} (from WO ${workOrder.workOrderNo})`,
                createdBy: workOrder.createdBy,
              });
              materialCostAmount += Math.abs(Number(materialLedger.costAmountDelta || 0));
          }
        }

        if (pendingOutputLedgerInput) {
          await ProductionCostLedgerService.recordWorkOrderCompletion(tx, {
            batchId: pendingOutputLedgerInput.batchId,
            workOrderId: workOrder.id,
            workOrderNo: workOrder.workOrderNo,
            quantityBefore: pendingOutputLedgerInput.quantityBefore,
            quantityDelta: pendingOutputLedgerInput.quantityDelta,
            costAmountDelta: materialCostAmount > 0 ? materialCostAmount : null,
            note: pendingOutputLedgerInput.note,
            createdBy: workOrder.createdBy,
          });
        }
      }

      return readWorkOrderDetail(tx, id);
    });
  }

  static async updateWorkOrderStep(workOrderId: number, stepId: number, input: { status?: string; operatorName?: string | null; note?: string | null }) {
    const step = await prisma.productionProcessStep.findFirst({
      where: { id: stepId, workOrderId },
    });

    if (!step) {
      throw new Error(`Production step not found: ${stepId}`);
    }

    return prisma.productionProcessStep.update({
      where: { id: step.id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.operatorName !== undefined ? { operatorName: input.operatorName } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.status === 'in_progress' ? { startedAt: new Date() } : {}),
        ...(input.status === 'completed' ? { completedAt: new Date() } : {}),
      },
    });
  }

  static async createQualityCheck(workOrderId: number, input: ProductionQualityCheckInput) {
    return prisma.productionQualityCheck.create({
      data: {
        workOrderId,
        checkNo: buildNo('QC'),
        result: input.result,
        defectRate: input.defectRate ?? null,
        note: input.note || null,
        checkedBy: input.checkedBy || null,
        checkedAt: new Date(),
      },
    });
  }
}


