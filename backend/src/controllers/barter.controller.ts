import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { ApiResponse } from '../types/api.types';
import { logger } from '../utils/logger';
import {
  BarterService,
  type CreateBarterAgreementInput,
  type CreateBarterBatchInput,
  type CreateBarterSettlementInput,
} from '../services/barter.service';
import {
  buildBarterDataScopeWhere,
  canUseAnyOperationalDataScope,
  canUseBarterRecord,
  canUseCustomerForBusinessWrite,
} from '../utils/recordAccess';

const parseOptionalDate = (value: unknown): Date | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const resolveBarterStatusCode = (message: string) => {
  if (message.includes('not found')) return 404;
  return 409;
};

const canAccessBarterMeta = (req: AuthRequest, meta: {
  createdBy: number;
  customer?: { salespersonId: number | null; poolState: string | null; segment: string | null } | null;
  order?: { createdBy: number; customer?: { salespersonId: number | null; poolState: string | null; segment: string | null } | null } | null;
}) => {
  return canUseBarterRecord(req, meta);
};

const loadAgreementMeta = (id: number) => prisma.barterAgreement.findUnique({
  where: { id },
  select: {
    id: true,
    createdBy: true,
    counterpartyType: true,
    customer: { select: { salespersonId: true, poolState: true, segment: true } },
    order: {
      select: {
        createdBy: true,
        customer: { select: { salespersonId: true, poolState: true, segment: true } },
      },
    },
  },
});

const loadSettlementMeta = (id: number) => prisma.barterSettlement.findUnique({
  where: { id },
  select: {
    id: true,
    createdBy: true,
    counterpartyType: true,
    customer: { select: { salespersonId: true, poolState: true, segment: true } },
    order: {
      select: {
        createdBy: true,
        customer: { select: { salespersonId: true, poolState: true, segment: true } },
      },
    },
    agreement: {
      select: {
        createdBy: true,
        customer: { select: { salespersonId: true, poolState: true, segment: true } },
        order: {
          select: {
            createdBy: true,
            customer: { select: { salespersonId: true, poolState: true, segment: true } },
          },
        },
      },
    },
  },
});

async function validateSalesBarterPayload(
  req: AuthRequest,
  body: { counterpartyType?: unknown; customerId?: unknown; orderId?: unknown },
) {
  if (canUseAnyOperationalDataScope(req, ['finance_visible', 'warehouse_visible', 'procurement_visible'])) {
    return { ok: true as const };
  }

  if (body.counterpartyType !== 'customer') {
    return { ok: false as const, status: 403, message: '当前角色只能为有权管理的客户创建货抵记录' };
  }

  const customerId = Number(body.customerId);
  if (!customerId) {
    return { ok: false as const, status: 400, message: '客户货抵必须选择客户' };
  }

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, status: true, salespersonId: true, poolState: true, segment: true },
  });
  if (!customer) {
    return { ok: false as const, status: 404, message: '客户不存在' };
  }
  if (customer.status !== 'active') {
    return { ok: false as const, status: 409, message: '只能为 active 客户创建货抵记录' };
  }
  if (!canUseCustomerForBusinessWrite(req, customer)) {
    return { ok: false as const, status: 403, message: '无权为该客户创建货抵记录' };
  }

  if (body.orderId) {
    const order = await prisma.order.findUnique({
      where: { id: Number(body.orderId) },
      select: { id: true, customerId: true, createdBy: true, status: true },
    });
    if (!order) {
      return { ok: false as const, status: 404, message: '关联订单不存在' };
    }
    if (order.status === 'cancelled') {
      return { ok: false as const, status: 409, message: '已取消订单不能关联货抵记录' };
    }
    if (order.customerId !== customerId) {
      return { ok: false as const, status: 403, message: '关联订单不属于当前货抵客户' };
    }
    if (!canUseCustomerForBusinessWrite(req, customer) && order.createdBy !== req.user?.userId) {
      return { ok: false as const, status: 403, message: '无权将该订单关联到货抵记录' };
    }
  }

  return { ok: true as const };
}

export class BarterController {
  private async writeAuditLog(req: AuthRequest, action: string, resourceId: number, details: string) {
    if (!req.user?.userId) return;
    try {
      await prisma.auditLog.create({
        data: {
          userId: req.user.userId,
          action,
          resource: 'barter_settlement',
          resourceId,
          details,
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        },
      });
    } catch (error) {
      logger.error('写入货抵审计失败', error);
    }
  }

  async getSummary(req: AuthRequest, res: Response) {
    try {
      const data = await BarterService.getSummary(buildBarterDataScopeWhere(req));
      res.json({ success: true, data } as ApiResponse);
    } catch (error) {
      logger.error('加载货抵概览失败', error);
      res.status(500).json({ success: false, message: '加载货抵概览失败' } as ApiResponse);
    }
  }

  async getSettlements(req: AuthRequest, res: Response) {
    try {
      const { page, pageSize, search, status, counterpartyType } = req.query;
      const data = await BarterService.listSettlements({
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
        search: search ? String(search) : undefined,
          status: status ? String(status) : undefined,
          counterpartyType: counterpartyType ? String(counterpartyType) : undefined,
          where: buildBarterDataScopeWhere(req),
      });
      res.json({ success: true, data } as ApiResponse);
    } catch (error) {
      logger.error('加载货抵列表失败', error);
      res.status(500).json({ success: false, message: '加载货抵列表失败' } as ApiResponse);
    }
  }

  async getAgreements(req: AuthRequest, res: Response) {
    try {
      const { page, pageSize, search, status, counterpartyType } = req.query;
      const data = await BarterService.listAgreements({
        page: page ? Number(page) : undefined,
        pageSize: pageSize ? Number(pageSize) : undefined,
        search: search ? String(search) : undefined,
          status: status ? String(status) : undefined,
          counterpartyType: counterpartyType ? String(counterpartyType) : undefined,
          where: buildBarterDataScopeWhere(req),
      });
      res.json({ success: true, data } as ApiResponse);
    } catch (error) {
      logger.error('加载货抵协议列表失败', error);
      res.status(500).json({ success: false, message: '加载货抵协议列表失败' } as ApiResponse);
    }
  }

  async getAgreement(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const meta = await loadAgreementMeta(Number(id));
      if (!meta || !canAccessBarterMeta(req, meta)) {
        return res.status(404).json({ success: false, message: '未找到货抵协议，请刷新后重新选择。' } as ApiResponse);
      }
      const data = await BarterService.getAgreement(Number(id));
      res.json({ success: true, data } as ApiResponse);
    } catch (error) {
      const message = error instanceof Error ? error.message : '加载货抵协议详情失败';
      const statusCode = message.includes('未找到') || message.includes('not found') ? 404 : 500;
      logger.error('加载货抵协议详情失败', error);
      res.status(statusCode).json({ success: false, message } as ApiResponse);
    }
  }

  async getSettlement(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const meta = await loadSettlementMeta(Number(id));
      if (!meta || !canAccessBarterMeta(req, meta) || (meta.agreement && !canAccessBarterMeta(req, meta.agreement))) {
        return res.status(404).json({ success: false, message: '未找到货抵批次，请刷新后重新选择。' } as ApiResponse);
      }
      const data = await BarterService.getSettlement(Number(id));
      res.json({ success: true, data } as ApiResponse);
    } catch (error) {
      const message = error instanceof Error ? error.message : '加载货抵详情失败';
      const statusCode = message.includes('未找到') || message.includes('not found') ? 404 : 500;
      logger.error('加载货抵详情失败', error);
      res.status(statusCode).json({ success: false, message } as ApiResponse);
    }
  }

  async preview(req: AuthRequest, res: Response) {
    try {
      const { items, settlementMode } = req.body;
      const data = BarterService.preview({
        items,
        settlementMode,
      });
      res.json({ success: true, data } as ApiResponse);
    } catch (error) {
      logger.error('货抵预览失败', error);
      res.status(500).json({ success: false, message: '货抵预览失败' } as ApiResponse);
    }
  }

  async createSettlement(req: AuthRequest, res: Response) {
    try {
      const access = await validateSalesBarterPayload(req, req.body);
      if (!access.ok) {
        return res.status(access.status).json({ success: false, message: access.message } as ApiResponse);
      }
      const body = req.body as Omit<CreateBarterSettlementInput, 'createdBy' | 'valuationDate'> & {
        valuationDate?: unknown;
      };
      const payload: CreateBarterSettlementInput = {
        ...body,
        valuationDate: parseOptionalDate(body.valuationDate),
        createdBy: req.user!.userId,
      };
      const data = await BarterService.createSettlement(payload);
      await this.writeAuditLog(req, 'CREATE_BARTER_SETTLEMENT', data.id, JSON.stringify({
        settlementNo: data.settlementNo,
        counterpartyType: data.counterpartyType,
        counterpartyName: data.counterpartyName,
      }));
      res.status(201).json({ success: true, data } as ApiResponse);
    } catch (error) {
      logger.error('创建货抵单失败', error);
      const message = error instanceof Error ? error.message : '创建货抵单失败';
      res.status(resolveBarterStatusCode(message)).json({ success: false, message } as ApiResponse);
    }
  }

  async createAgreement(req: AuthRequest, res: Response) {
    try {
      const access = await validateSalesBarterPayload(req, req.body);
      if (!access.ok) {
        return res.status(access.status).json({ success: false, message: access.message } as ApiResponse);
      }
      const body = req.body as Omit<CreateBarterAgreementInput, 'createdBy' | 'agreementDate' | 'valuationDate'> & {
        agreementDate?: unknown;
        valuationDate?: unknown;
      };
      const payload: CreateBarterAgreementInput = {
        ...body,
        agreementDate: parseOptionalDate(body.agreementDate),
        valuationDate: parseOptionalDate(body.valuationDate),
        createdBy: req.user!.userId,
      };
      const data = await BarterService.createAgreement(payload);
      await this.writeAuditLog(req, 'CREATE_BARTER_AGREEMENT', data.id, JSON.stringify({
        agreementNo: data.agreementNo,
        counterpartyType: data.counterpartyType,
        counterpartyName: data.counterpartyName,
      }));
      res.status(201).json({ success: true, data } as ApiResponse);
    } catch (error) {
      logger.error('创建货抵协议失败', error);
      const message = error instanceof Error ? error.message : '创建货抵协议失败';
      res.status(resolveBarterStatusCode(message)).json({ success: false, message } as ApiResponse);
    }
  }

  async createBatchForAgreement(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const meta = await loadAgreementMeta(Number(id));
      if (!meta || !canAccessBarterMeta(req, meta)) {
        return res.status(404).json({ success: false, message: '未找到货抵协议，请刷新后重新选择。' } as ApiResponse);
      }
      const body = req.body as Omit<CreateBarterBatchInput, 'createdBy' | 'valuationDate'> & {
        valuationDate?: unknown;
      };
      const payload: CreateBarterBatchInput = {
        ...body,
        valuationDate: parseOptionalDate(body.valuationDate),
        createdBy: req.user!.userId,
      };
      const data = await BarterService.createBatchForAgreement(Number(id), payload);
      await this.writeAuditLog(req, 'CREATE_BARTER_BATCH', data.id, JSON.stringify({
        agreementId: Number(id),
        settlementNo: data.settlementNo,
        batchIndex: data.batchIndex ?? null,
      }));
      res.status(201).json({ success: true, data } as ApiResponse);
    } catch (error) {
      logger.error('创建货抵执行批次失败', error);
      const message = error instanceof Error ? error.message : '创建货抵执行批次失败';
      res.status(resolveBarterStatusCode(message)).json({ success: false, message } as ApiResponse);
    }
  }

  async approveSettlement(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const { note } = req.body;
      const meta = await loadSettlementMeta(Number(id));
      if (!meta || !canAccessBarterMeta(req, meta) || (meta.agreement && !canAccessBarterMeta(req, meta.agreement))) {
        return res.status(404).json({ success: false, message: '未找到货抵批次，请刷新后重新选择。' } as ApiResponse);
      }
      const data = await BarterService.approveSettlement(Number(id), req.user!.userId, note ? String(note) : undefined);
      await this.writeAuditLog(req, 'APPROVE_BARTER_SETTLEMENT', Number(id), JSON.stringify({ note: note || null }));
      res.json({ success: true, data } as ApiResponse);
    } catch (error) {
      logger.error('审批货抵单失败', error);
      const message = error instanceof Error ? error.message : '审批货抵单失败';
      res.status(resolveBarterStatusCode(message)).json({ success: false, message } as ApiResponse);
    }
  }

  async postSettlement(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const { orderId, postingAmount, offsetType, note } = req.body;
      const meta = await loadSettlementMeta(Number(id));
      if (!meta || !canAccessBarterMeta(req, meta) || (meta.agreement && !canAccessBarterMeta(req, meta.agreement))) {
        return res.status(404).json({ success: false, message: '未找到货抵批次，请刷新后重新选择。' } as ApiResponse);
      }
      const data = await BarterService.postSettlement(Number(id), req.user!.userId, {
        orderId: orderId === undefined || orderId === null || orderId === '' ? undefined : Number(orderId),
        postingAmount: postingAmount === undefined || postingAmount === null || postingAmount === '' ? undefined : Number(postingAmount),
        offsetType: offsetType ? String(offsetType) : undefined,
        note: note ? String(note) : undefined,
      });
      await this.writeAuditLog(req, 'POST_BARTER_SETTLEMENT', Number(id), JSON.stringify({
        orderId: orderId || null,
        postingAmount: postingAmount || null,
        offsetType: offsetType || null,
      }));
      res.json({ success: true, data } as ApiResponse);
    } catch (error) {
      logger.error('过账货抵单失败', error);
      const message = error instanceof Error ? error.message : '过账货抵单失败';
      res.status(resolveBarterStatusCode(message)).json({ success: false, message } as ApiResponse);
    }
  }

  async reverseSettlement(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const meta = await loadSettlementMeta(Number(id));
      if (!meta || !canAccessBarterMeta(req, meta) || (meta.agreement && !canAccessBarterMeta(req, meta.agreement))) {
        return res.status(404).json({ success: false, message: '未找到货抵批次，请刷新后重新选择。' } as ApiResponse);
      }
      const data = await BarterService.reverseSettlement(Number(id), req.user!.userId, String(reason));
      await this.writeAuditLog(req, 'REVERSE_BARTER_SETTLEMENT', Number(id), JSON.stringify({ reason }));
      res.json({ success: true, data } as ApiResponse);
    } catch (error) {
      logger.error('冲销货抵单失败', error);
      const message = error instanceof Error ? error.message : '冲销货抵单失败';
      res.status(resolveBarterStatusCode(message)).json({ success: false, message } as ApiResponse);
    }
  }
}
