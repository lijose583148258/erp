import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { logger } from '../utils/logger';
import { ApiResponse } from '../types/api.types';
import { ReceiptDiscrepancyService, ReceiptDiscrepancyStatus } from '../services/receipt-discrepancy.service';
import { canUseAnyOperationalDataScope, canUseOperationalDataScope, hasDataScope } from '../utils/recordAccess';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const toNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const canReadDiscrepancy = (req: AuthRequest) =>
  canUseAnyOperationalDataScope(req, ['warehouse_visible', 'finance_visible']);

const canResolveDiscrepancy = (req: AuthRequest) =>
  canUseOperationalDataScope(req, 'warehouse_visible');

const canManageToleranceRules = (req: AuthRequest) =>
  req.user?.role === 'admin' || req.user?.role === 'manager' || hasDataScope(req, 'all');

const rejectDiscrepancyRead = (res: Response) =>
  res.status(403).json({ success: false, message: '无权查看收发货差异' } as ApiResponse);

export class ReceiptDiscrepancyController {
  async getToleranceRules(req: AuthRequest, res: Response) {
    try {
      if (!canReadDiscrepancy(req)) return rejectDiscrepancyRead(res);
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(Number(req.query.pageSize) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
      const result = await ReceiptDiscrepancyService.listToleranceRules(prisma, {
        page,
        pageSize,
        sourceType: req.query.sourceType ? String(req.query.sourceType) : undefined,
        discrepancyType: req.query.discrepancyType ? String(req.query.discrepancyType) : undefined,
        counterpartyType: req.query.counterpartyType ? String(req.query.counterpartyType) : undefined,
        status: req.query.status ? String(req.query.status) : undefined,
      });

      return res.json({
        success: true,
        data: result.items,
        meta: {
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          totalPages: Math.ceil(result.total / result.pageSize),
        },
      } as ApiResponse);
    } catch (error) {
      logger.error('Failed to list receipt tolerance rules', error);
      const message = error instanceof Error ? error.message : 'Failed to list receipt tolerance rules';
      return res.status(400).json({ success: false, message } as ApiResponse);
    }
  }

  async createToleranceRule(req: AuthRequest, res: Response) {
    try {
      if (!canManageToleranceRules(req)) {
        return res.status(403).json({ success: false, message: '当前角色无权维护收发货容差规则' } as ApiResponse);
      }

      const rule = await ReceiptDiscrepancyService.createToleranceRule(prisma, req.body, req.user?.userId || null);
      await prisma.auditLog.create({
        data: {
          userId: req.user!.userId,
          action: 'CREATE_RECEIPT_TOLERANCE_RULE',
          resource: 'receipt_tolerance_rule',
          resourceId: rule?.id || null,
          details: `创建收发货容差规则 ${rule?.ruleNo || ''}`,
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        },
      });

      return res.status(201).json({
        success: true,
        data: rule,
        message: '收发货容差规则已创建',
      } as ApiResponse);
    } catch (error) {
      logger.error('Failed to create receipt tolerance rule', error);
      const message = error instanceof Error ? error.message : 'Failed to create receipt tolerance rule';
      return res.status(400).json({ success: false, message } as ApiResponse);
    }
  }

  async getCases(req: AuthRequest, res: Response) {
    try {
      if (!canReadDiscrepancy(req)) return rejectDiscrepancyRead(res);
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(Number(req.query.pageSize) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
      const result = await ReceiptDiscrepancyService.listCases(prisma, {
        page,
        pageSize,
        sourceType: req.query.sourceType ? String(req.query.sourceType) : undefined,
        sourceRef: req.query.sourceRef ? String(req.query.sourceRef) : undefined,
        status: req.query.status ? String(req.query.status) : undefined,
        relatedModule: req.query.relatedModule ? String(req.query.relatedModule) : undefined,
        relatedId: toNumber(req.query.relatedId),
        counterpartyType: req.query.counterpartyType ? String(req.query.counterpartyType) : undefined,
        counterpartyId: toNumber(req.query.counterpartyId),
      });

      return res.json({
        success: true,
        data: result.items,
        meta: {
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          totalPages: Math.ceil(result.total / result.pageSize),
        },
      } as ApiResponse);
    } catch (error) {
      logger.error('Failed to list receipt discrepancy cases', error);
      const message = error instanceof Error ? error.message : 'Failed to list receipt discrepancy cases';
      return res.status(400).json({ success: false, message } as ApiResponse);
    }
  }

  async resolveCase(req: AuthRequest, res: Response) {
    try {
      if (!canResolveDiscrepancy(req)) {
        return res.status(403).json({ success: false, message: '当前角色无权处理收发货差异' } as ApiResponse);
      }

      const id = Number(req.params.id);
      const status = String(req.body.status || 'resolved') as ReceiptDiscrepancyStatus;
      const updated = await ReceiptDiscrepancyService.resolveCase(prisma, {
        id,
        status,
        resolution: req.body.resolution ? String(req.body.resolution) : null,
        actionRef: req.body.actionRef ? String(req.body.actionRef) : null,
        note: req.body.note ? String(req.body.note) : null,
        resolvedBy: req.user?.userId || null,
      });

      if (!updated) {
        return res.status(404).json({ success: false, message: '收发货差异单不存在' } as ApiResponse);
      }

      await prisma.auditLog.create({
        data: {
          userId: req.user!.userId,
          action: 'RESOLVE_RECEIPT_DISCREPANCY',
          resource: 'receipt_discrepancy',
          resourceId: updated.id,
          details: `处理收发货差异 ${updated.caseNo} -> ${updated.status}`,
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        },
      });

      return res.json({
        success: true,
        data: updated,
        message: '收发货差异已更新',
      } as ApiResponse);
    } catch (error) {
      logger.error('Failed to resolve receipt discrepancy case', error);
      const message = error instanceof Error ? error.message : 'Failed to resolve receipt discrepancy case';
      return res.status(400).json({ success: false, message } as ApiResponse);
    }
  }

  async getCaseActions(req: AuthRequest, res: Response) {
    try {
      if (!canReadDiscrepancy(req)) return rejectDiscrepancyRead(res);
      const id = Number(req.params.id);
      const actions = await ReceiptDiscrepancyService.listActions(prisma, id);
      return res.json({
        success: true,
        data: actions,
        meta: {
          total: actions.length,
        },
      } as ApiResponse);
    } catch (error) {
      logger.error('Failed to list receipt discrepancy actions', error);
      const message = error instanceof Error ? error.message : 'Failed to list receipt discrepancy actions';
      return res.status(400).json({ success: false, message } as ApiResponse);
    }
  }

  async createCaseAction(req: AuthRequest, res: Response) {
    try {
      if (!canResolveDiscrepancy(req)) {
        return res.status(403).json({ success: false, message: '当前角色无权创建收发货差异处置动作' } as ApiResponse);
      }

      if (req.body.actionType === 'customer_rma' && !['admin', 'manager'].includes(req.user?.role || '') && !hasDataScope(req, 'all')) {
        return res.status(403).json({ success: false, message: '客户 RMA 处置动作需要管理员或经理确认' } as ApiResponse);
      }

      const id = Number(req.params.id);
      const action = await ReceiptDiscrepancyService.createAction(prisma, id, {
        ...req.body,
        createdBy: req.user?.userId || null,
      });

      if (!action) {
        return res.status(404).json({ success: false, message: '收发货差异单不存在' } as ApiResponse);
      }

      await prisma.auditLog.create({
        data: {
          userId: req.user!.userId,
          action: 'CREATE_RECEIPT_DISCREPANCY_ACTION',
          resource: 'receipt_discrepancy_action',
          resourceId: action.id,
          details: `创建收发货差异处置动作 ${action.actionNo} -> ${action.actionType}`,
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        },
      });

      return res.status(201).json({
        success: true,
        data: action,
        message: '收发货差异处置动作已创建',
      } as ApiResponse);
    } catch (error) {
      logger.error('Failed to create receipt discrepancy action', error);
      const message = error instanceof Error ? error.message : 'Failed to create receipt discrepancy action';
      return res.status(400).json({ success: false, message } as ApiResponse);
    }
  }
}
