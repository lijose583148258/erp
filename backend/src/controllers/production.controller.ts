import { Response } from 'express';
import { logger } from '../utils/logger';
import { AuthRequest } from '../middleware/auth';
import { ApiResponse } from '../types/api.types';
import { ProductionService, ProductionQualityResult, ProductionWorkOrderStatus } from '../services/production.service';
import { ProductionCompletionValidationError } from '../services/production-mutation.service';
import { createProductionAuditLog, toNumber } from './production.helpers';
import { canUseAnyOperationalDataScope, canUseOperationalDataScope } from '../utils/recordAccess';

const resolveProductionStatusCode = (message: string) => {
  if (message.toLowerCase().includes('not found')) return 404;
  if (
    message.includes('cannot') ||
    message.includes('Invalid') ||
    message.includes('Insufficient') ||
    message.includes('BOM material') ||
    message.includes('requires') ||
    message.includes('outside tolerance') ||
    message.includes('unit mismatch')
  ) {
    return 409;
  }
  return 500;
};

const canReadProduction = (req: AuthRequest) =>
  canUseAnyOperationalDataScope(req, ['warehouse_visible', 'finance_visible']);

const canWriteProduction = (req: AuthRequest) =>
  canUseOperationalDataScope(req, 'warehouse_visible');

const rejectProductionRead = (res: Response) =>
  res.status(403).json({ success: false, message: '无权查看生产数据' } as ApiResponse);

const rejectProductionWrite = (res: Response) =>
  res.status(403).json({ success: false, message: '无权管理生产数据' } as ApiResponse);

export class ProductionController {
  async getSummary(req: AuthRequest, res: Response) {
    try {
      if (!canReadProduction(req)) return rejectProductionRead(res);
      const data = await ProductionService.getSummary();
      res.json({ success: true, data } as ApiResponse);
    } catch (error) {
      logger.error('Failed to load production summary', error);
      res.status(500).json({ success: false, message: 'Failed to load production summary' } as ApiResponse);
    }
  }

  async getBoms(req: AuthRequest, res: Response) {
    try {
      if (!canReadProduction(req)) return rejectProductionRead(res);
      const data = await ProductionService.listBoms();
      res.json({ success: true, data } as ApiResponse);
    } catch (error) {
      logger.error('Failed to load production boms', error);
      res.status(500).json({ success: false, message: 'Failed to load production boms' } as ApiResponse);
    }
  }

  async createBom(req: AuthRequest, res: Response) {
    try {
      if (!canWriteProduction(req)) return rejectProductionWrite(res);
      const {
        productName,
        version,
        bomType,
        status,
        formulationMode,
        outputUnit,
        standardBatchSize,
        batchSizeUnit,
        density,
        solidContent,
        effectiveFrom,
        effectiveTo,
        processJson,
        qualitySpecJson,
        notes,
        items = [],
      } = req.body;
      if (!productName || !outputUnit) {
        return res.status(400).json({ success: false, message: 'Missing required fields' } as ApiResponse);
      }

      const created = await ProductionService.createBom({
        productName: String(productName),
        version: version ? String(version) : null,
        bomType: bomType ? String(bomType) : null,
        status: status ? String(status) : null,
        formulationMode: formulationMode ? String(formulationMode) : null,
        outputUnit: String(outputUnit),
        standardBatchSize: standardBatchSize !== undefined ? toNumber(standardBatchSize) : null,
        batchSizeUnit: batchSizeUnit ? String(batchSizeUnit) : null,
        density: density !== undefined ? toNumber(density) : null,
        solidContent: solidContent !== undefined ? toNumber(solidContent) : null,
        effectiveFrom: effectiveFrom ? String(effectiveFrom) : null,
        effectiveTo: effectiveTo ? String(effectiveTo) : null,
        processJson: processJson ? String(processJson) : null,
        qualitySpecJson: qualitySpecJson ? String(qualitySpecJson) : null,
        notes: notes ? String(notes) : null,
        items: Array.isArray(items) ? items : [],
      }, req.user!.userId);

      await createProductionAuditLog(req, 'CREATE_PRODUCTION_BOM', { bomNo: created.bomNo, productName: created.productName }, created.id);

      res.status(201).json({ success: true, data: created } as ApiResponse);
    } catch (error) {
      logger.error('Failed to create production bom', error);
      const message = error instanceof Error ? error.message : 'Failed to create production bom';
      res.status(500).json({ success: false, message } as ApiResponse);
    }
  }

  async getWorkOrders(req: AuthRequest, res: Response) {
    try {
      if (!canReadProduction(req)) return rejectProductionRead(res);
      const { status, bomId, batchId, keyword } = req.query;
      const items = await ProductionService.listWorkOrders({
        status: status ? String(status) : undefined,
        bomId: toNumber(bomId) ?? undefined,
        batchId: toNumber(batchId) ?? undefined,
        keyword: keyword ? String(keyword) : undefined,
      });

      res.json({ success: true, data: items } as ApiResponse);
    } catch (error) {
      logger.error('Failed to load production work orders', error);
      res.status(500).json({ success: false, message: 'Failed to load production work orders' } as ApiResponse);
    }
  }

  
  async previewConsumption(req: AuthRequest, res: Response) {
    try {
      if (!canReadProduction(req)) return rejectProductionRead(res);
      const { id } = req.params;
      const data = await ProductionService.previewWorkOrderConsumption(Number(id));
      res.json({ success: true, data } as ApiResponse);
    } catch (error) {
      logger.error('Failed to preview consumption', error);
      const message = error instanceof Error ? error.message : 'Failed to preview consumption';
      res.status(500).json({ success: false, message } as ApiResponse);
    }
  }
  async getBatchCostLedger(req: AuthRequest, res: Response) {
    try {
      if (!canReadProduction(req)) return rejectProductionRead(res);
      const { batchId } = req.params;
      const { page, pageSize } = req.query;
      const result = await ProductionService.getBatchCostLedger(Number(batchId), {
        page: toNumber(page) ?? undefined,
        pageSize: toNumber(pageSize) ?? undefined,
      });

      res.json({
        success: true,
        data: result,
      } as ApiResponse);
    } catch (error) {
      logger.error('Failed to load batch cost ledger', error);
      res.status(500).json({ success: false, message: 'Failed to load batch cost ledger' } as ApiResponse);
    }
  }

  async createWorkOrder(req: AuthRequest, res: Response) {
    try {
      if (!canWriteProduction(req)) return rejectProductionWrite(res);
      const {
        bomId,
        batchId,
        productName,
        targetQuantity,
        producedQuantity,
        lossQuantity,
        plannedStartAt,
        plannedEndAt,
        note,
        steps,
      } = req.body;

      if (!productName || targetQuantity === undefined) {
        return res.status(400).json({ success: false, message: 'Missing required fields' } as ApiResponse);
      }

      const created = await ProductionService.createWorkOrder({
        bomId: toNumber(bomId) ?? null,
        batchId: toNumber(batchId) ?? null,
        productName: String(productName),
        targetQuantity: Number(targetQuantity),
        producedQuantity: toNumber(producedQuantity) ?? 0,
        lossQuantity: toNumber(lossQuantity) ?? 0,
        plannedStartAt: plannedStartAt ? String(plannedStartAt) : null,
        plannedEndAt: plannedEndAt ? String(plannedEndAt) : null,
        note: note ? String(note) : null,
        steps: Array.isArray(steps) ? steps : undefined,
      }, req.user!.userId);

      await createProductionAuditLog(req, 'CREATE_PRODUCTION_WORK_ORDER', {
        workOrderNo: (created as any)?.workOrderNo,
        productName: (created as any)?.productName,
      }, (created as any)?.id);

      res.status(201).json({ success: true, data: created } as ApiResponse);
    } catch (error) {
      logger.error('Failed to create production work order', error);
      const message = error instanceof Error ? error.message : 'Failed to create production work order';
      res.status(500).json({ success: false, message } as ApiResponse);
    }
  }

  async updateWorkOrderStatus(req: AuthRequest, res: Response) {
    try {
      if (!canWriteProduction(req)) return rejectProductionWrite(res);
      const { id } = req.params;
      const { status, consumptionRecords } = req.body;
      if (!status) {
        return res.status(400).json({ success: false, message: 'Missing status' } as ApiResponse);
      }

      const updated = await ProductionService.updateWorkOrderStatus(Number(id), String(status) as ProductionWorkOrderStatus, consumptionRecords);
      await createProductionAuditLog(req, 'UPDATE_PRODUCTION_WORK_ORDER_STATUS', {
        workOrderId: Number(id),
        status,
      }, Number(id));

      res.json({ success: true, data: updated } as ApiResponse);
    } catch (error) {
      logger.error('Failed to update production work order status', error);
      const message = error instanceof Error ? error.message : 'Failed to update production work order status';
      res.status(resolveProductionStatusCode(message)).json({
        success: false,
        message,
        issues: error instanceof ProductionCompletionValidationError ? error.issues : undefined,
      } as ApiResponse & { issues?: unknown[] });
    }
  }

  async updateStep(req: AuthRequest, res: Response) {
    try {
      if (!canWriteProduction(req)) return rejectProductionWrite(res);
      const { id, stepId } = req.params;
      const { status, operatorName, note } = req.body;
      const updated = await ProductionService.updateWorkOrderStep(Number(id), Number(stepId), {
        status: status ? String(status) : undefined,
        operatorName: operatorName !== undefined ? String(operatorName) : undefined,
        note: note !== undefined ? String(note) : undefined,
      });

      await createProductionAuditLog(req, 'UPDATE_PRODUCTION_STEP', {
        workOrderId: Number(id),
        stepId: Number(stepId),
        status,
      }, Number(stepId));

      res.json({ success: true, data: updated } as ApiResponse);
    } catch (error) {
      logger.error('Failed to update production step', error);
      const message = error instanceof Error ? error.message : 'Failed to update production step';
      res.status(500).json({ success: false, message } as ApiResponse);
    }
  }

  async createQualityCheck(req: AuthRequest, res: Response) {
    try {
      if (!canWriteProduction(req)) return rejectProductionWrite(res);
      const { id } = req.params;
      const { result, defectRate, note, checkedBy } = req.body;
      if (!result) {
        return res.status(400).json({ success: false, message: 'Missing result' } as ApiResponse);
      }

      const created = await ProductionService.createQualityCheck(Number(id), {
        result: String(result) as ProductionQualityResult,
        defectRate: toNumber(defectRate) ?? null,
        note: note ? String(note) : null,
        checkedBy: checkedBy ? String(checkedBy) : null,
      });

      await createProductionAuditLog(req, 'CREATE_PRODUCTION_QC', {
        workOrderId: Number(id),
        checkNo: created.checkNo,
        result: created.result,
      }, created.id);

      res.status(201).json({ success: true, data: created } as ApiResponse);
    } catch (error) {
      logger.error('Failed to create production qc', error);
      const message = error instanceof Error ? error.message : 'Failed to create production qc';
      res.status(500).json({ success: false, message } as ApiResponse);
    }
  }
}

