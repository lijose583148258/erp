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

export class ProductionMutationService {
  static async createBom(input: ProductionBomInput, createdBy: number) {
    const bomNo = buildNo('BOM');
    const items = (input.items || [])
      .map(item => ({
        ...item,
        materialName: String(item.materialName || item.materialCode || '').trim(),
        materialCode: item.materialCode ? String(item.materialCode).trim() : null,
      }))
      .filter(item => item.materialName && Number(item.quantityPerUnit || 0) > 0);

    return prisma.$transaction(async tx => {
      const created = await tx.productionBom.create({
        data: {
          bomNo,
          productName: input.productName,
          version: input.version || 'v1',
          outputUnit: input.outputUnit,
          notes: input.notes || null,
          createdBy,
          items: {
            create: items.map(item => ({
              materialName: item.materialName,
              quantityPerUnit: Number(item.quantityPerUnit || 0),
              unit: item.unit,
              lossRate: Number(item.lossRate || 0),
              notes: item.notes || null,
            })),
          },
        },
        include: {
          creator: { select: { id: true, username: true, role: true } },
          items: { orderBy: { id: 'asc' } },
        },
      });

      await tx.$executeRawUnsafe(
        `UPDATE production_boms
         SET bom_type = ?, status = ?, formulation_mode = ?, standard_batch_size = ?, batch_size_unit = ?, density = ?, solid_content = ?, effective_from = ?, effective_to = ?, process_json = ?, quality_spec_json = ?
         WHERE id = ?`,
        input.bomType || 'standard',
        input.status || 'draft',
        input.formulationMode || null,
        input.standardBatchSize ?? null,
        input.batchSizeUnit || null,
        input.density ?? null,
        input.solidContent ?? null,
        toDateOrNull(input.effectiveFrom)?.toISOString() || null,
        toDateOrNull(input.effectiveTo)?.toISOString() || null,
        input.processJson || null,
        input.qualitySpecJson || null,
        created.id,
      );

      for (const [index, createdItem] of created.items.entries()) {
        const item = items[index];
        if (!item) continue;

        await tx.$executeRawUnsafe(
          `UPDATE production_bom_items
           SET material_code = ?, ingredient_role = ?, dosage_mode = ?, percentage = ?, allowed_variance_rate = ?, process_stage = ?, substitute_group = ?, yield_contribution = ?
           WHERE id = ?`,
          item.materialCode || null,
          item.ingredientRole || null,
          item.dosageMode || null,
          item.percentage ?? null,
          item.allowedVarianceRate ?? null,
          item.processStage || null,
          item.substituteGroup || null,
          item.yieldContribution ?? null,
          createdItem.id,
        );
      }

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
          bom: { select: { id: true, bomNo: true, productName: true, version: true, outputUnit: true } },
          productBatch: { select: { id: true, batchNo: true, productName: true, stockQuantity: true, unit: true } },
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

      let bomItemsForValidation = workOrder.bom?.items || [];
      if (workOrder.bom?.items?.length) {
        const itemIds = workOrder.bom.items.map(item => item.id);
        const extraRows = await tx.$queryRawUnsafe<Array<{ id: number; allowed_variance_rate: number | null }>>(
          `SELECT id, allowed_variance_rate
           FROM production_bom_items
           WHERE id IN (${itemIds.map(() => '?').join(',')})`,
          ...itemIds,
        );
        const varianceByItemId = new Map(extraRows.map(row => [Number(row.id), row.allowed_variance_rate]));
        bomItemsForValidation = workOrder.bom.items.map(item => ({
          ...item,
          allowedVarianceRate: varianceByItemId.get(item.id) ?? null,
        }));
      }

      if (workOrder.status === status) {
        return tx.productionWorkOrder.findUnique({
          where: { id: workOrder.id },
          include: {
            bom: { select: { id: true, bomNo: true, productName: true, version: true, outputUnit: true } },
            productBatch: { select: { id: true, batchNo: true, productName: true, stockQuantity: true, unit: true } },
            steps: { orderBy: { stepNo: 'asc' } },
            qualityChecks: { orderBy: { createdAt: 'desc' } },
          },
        });
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
        const requiredMaterialCount = workOrder.bom?.items?.length || 0;
        const aggregatedRecords = new Map<number, number>();

        for (const record of consumptionRecords || []) {
          const stockBalanceId = Number(record.stockBalanceId);
          const quantity = Number(record.quantity);
          if (!Number.isFinite(stockBalanceId) || stockBalanceId <= 0 || !Number.isInteger(stockBalanceId)) {
            throw new Error('Invalid stock balance id in consumption records');
          }
          if (!Number.isFinite(quantity) || quantity <= 0) {
            throw new Error('Invalid material consumption quantity');
          }
          aggregatedRecords.set(stockBalanceId, (aggregatedRecords.get(stockBalanceId) || 0) + quantity);
        }

        if (requiredMaterialCount > 0 && aggregatedRecords.size === 0) {
          throw new Error('Completing a BOM work order requires confirmed material consumption records');
        }

        for (const [stockBalanceId, quantity] of aggregatedRecords.entries()) {
          const currentStock = await tx.stockBalance.findUnique({
            where: { id: stockBalanceId },
            include: { location: true },
          });

          if (!currentStock) {
            throw new Error(`Stock balance not found: ${stockBalanceId}`);
          }

          if (Number(currentStock.quantity || 0) < quantity) {
            throw new Error(`Insufficient stock for ${currentStock.productName} / ${currentStock.batchNo}`);
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

      const updated = await tx.productionWorkOrder.update({
        where: { id },
        data: updateData,
      });

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
              select: { id: true, batchNo: true, productName: true, stockQuantity: true, unit: true },
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
            const createdBatch = await tx.productBatch.create({
              data: {
        batchNo: buildNo(`WO-${workOrder.id}-BATCH`),
                productName: workOrder.productName,
                productionDate: new Date(),
                expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
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

              // 尝试匹配 ProductBatch 写入 CostLedger
              const matchBatch = await tx.productBatch.findFirst({
                where: {
                  productName: currentStock.productName,
                  batchNo: currentStock.batchNo,
                },
                select: { id: true, stockQuantity: true },
              });

              if (!matchBatch) {
                throw new Error(`Product batch not found for material consumption: ${currentStock.productName} / ${currentStock.batchNo}`);
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

      return tx.productionWorkOrder.findUnique({
        where: { id: updated.id },
        include: {
          bom: { select: { id: true, bomNo: true, productName: true, version: true, outputUnit: true } },
          productBatch: { select: { id: true, batchNo: true, productName: true, stockQuantity: true, unit: true } },
          steps: { orderBy: { stepNo: 'asc' } },
          qualityChecks: { orderBy: { createdAt: 'desc' } },
        },
      });
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


