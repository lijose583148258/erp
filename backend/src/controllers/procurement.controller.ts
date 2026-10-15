import { Response } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import {
  buildSupplierSearchClause,
  mapPurchaseOrder,
  mapSupplier,
  normalizePurchaseStatus,
} from '../services/procurement-domain.service';
import {
  createPurchaseReceiptBatch,
  getPurchaseOrderReceiptBundle,
  PARTIAL_RECEIPT_ERROR,
  PARTIAL_RECEIPT_MESSAGE,
} from '../services/procurement-receipt.service';
import { createPurchaseOrder } from '../services/procurement-order.service';
import { isMaterialReleaseReadinessError } from '../services/material-release-readiness.service';
import { createSupplierRecord } from '../services/procurement-supplier.service';
import { changePurchaseOrderStatus } from '../services/procurement-status.service';
import { revisePurchaseOrder } from '../services/procurement-revision.service';
import { confirmPurchaseSources, getPurchaseSourceState } from '../services/procurement-source-confirmation.service';
import {
  getB2BStatusForSalesOrder,
  linkPurchaseOrderToSalesOrder,
  syncB2BSalesStatusToPurchase,
} from '../services/procurement-b2b.service';
import { buildOperationalDataScopeWhere, canUseOperationalDataScope, mergeWhereAnd } from '../utils/recordAccess';
import { withDbRetry } from '../utils/dbRetry';

const PROCUREMENT_DATA_SCOPE = 'procurement_visible' as const;
const sourceMessages: Record<string, string> = {
  PURCHASE_GOVERNANCE_SOURCE_REQUIRED: '须先确认供应商报价及税费归属、来料检验规范，再由另一位审批人确认',
  PURCHASE_GOVERNANCE_SOURCE_INVALID: '采购来源快照无效，须核对原报价及检验规范',
  PURCHASE_GOVERNANCE_SOURCE_CHANGED: '采购来源与当前版本不一致，须重新确认并独立审批',
  PURCHASE_SOURCE_CONFIRMATION_REQUIRED: '当前采购来源缺少有效审计，请通过确认来源补齐；不能沿用旧审批',
  PURCHASE_INDEPENDENT_APPROVAL_REQUIRED: '当前版本须由来源确认人以外的另一位授权审批人确认',
  PURCHASE_SOURCE_HISTORY_UNRECONCILED: '已有实收或入库凭证，须先核对历史来源，不能自动补零或改写旧账',
  PURCHASE_SOURCE_VERSION_CONFLICT: '采购单已更新，请对比最新版本后重新确认；你的输入未覆盖最新记录',
  PURCHASE_SOURCES_UNCHANGED: '来源没有变化，无需生成冗余版本，请继续独立审批或实际收货',
  PURCHASE_TRANSIT_TERMS_IMMUTABLE: '采购单已发运，确认来源时不能改写数量、价格或成本',
  PURCHASE_STATUS_ACTOR_REQUIRED: '采购状态变更必须由已登录的授权人员操作',
  ACTUAL_RECEIPT_REQUIRED: '请登记实际分批收货及供应商批号；状态同步不能代替仓库实收，也不能自动增加库存',
};

function getProcurementErrorStatus(error: unknown) {
  return error instanceof AppError ? error.statusCode : 500;
}

function rejectProcurementScope(res: Response) {
  return res.status(403).json({ success: false, message: '当前角色未获得采购数据范围' });
}

function canViewSupplierSensitiveData(req: AuthRequest) {
  return canUseOperationalDataScope(req, PROCUREMENT_DATA_SCOPE);
}

function canViewSupplierDirectory(req: AuthRequest) {
  return req.user?.role === 'sales' || canViewSupplierSensitiveData(req);
}

function canViewProcurementOrders(req: AuthRequest) {
  return canUseOperationalDataScope(req, PROCUREMENT_DATA_SCOPE);
}

async function writeAuditLog(params: {
  req: AuthRequest;
  action: string;
  resource: string;
  resourceId: number;
  details: string;
}) {
  try {
    if (!params.req.user?.userId) return;
    await prisma.auditLog.create({
      data: {
        userId: params.req.user.userId,
        action: params.action,
        resource: params.resource,
        resourceId: params.resourceId,
        details: params.details,
        ipAddress: params.req.ip,
        userAgent: params.req.get('user-agent'),
      },
    });
  } catch (error) {
    logger.error('采购审计写入失败:', error);
  }
}

export class ProcurementController {
  async getSuppliers(req: AuthRequest, res: Response) {
    try {
      const { page = 1, pageSize = 20, search, status, riskLevel } = req.query;
      const currentPage = Math.max(Number(page) || 1, 1);
      const limit = Math.min(Number(pageSize) || 20, 100);
      const offset = (currentPage - 1) * limit;
      const where: Prisma.SupplierWhereInput = {};
      const includeSensitive = canViewSupplierSensitiveData(req);

      if (search) {
        where.OR = buildSupplierSearchClause(search, includeSensitive);
      }

      if (status) where.status = String(status);
      if (riskLevel) where.riskLevel = String(riskLevel);
      const scopedWhere = mergeWhereAnd(
        where,
        canViewSupplierDirectory(req) ? {} : buildOperationalDataScopeWhere(req, PROCUREMENT_DATA_SCOPE),
      );

      const [suppliers, total] = await Promise.all([
        prisma.supplier.findMany({
          where: scopedWhere,
          orderBy: { createdAt: 'desc' },
          skip: offset,
          take: limit,
        }),
        prisma.supplier.count({ where: scopedWhere }),
      ]);

      return res.json({
        success: true,
        data: suppliers.map(supplier => mapSupplier(supplier, includeSensitive)),
        meta: {
          page: currentPage,
          pageSize: limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      logger.error('获取供应商列表错误:', error);
      return res.status(500).json({ success: false, message: '服务器内部错误' });
    }
  }

  async createSupplier(req: AuthRequest, res: Response) {
    try {
      if (!canViewProcurementOrders(req)) {
        return rejectProcurementScope(res);
      }

      const supplier = await prisma.$transaction(tx => createSupplierRecord(tx, req.body));

      await writeAuditLog({
        req,
        action: 'CREATE',
        resource: 'supplier',
        resourceId: supplier.id,
        details: `创建供应商 ${supplier.name}`,
      });

      return res.status(201).json({
        success: true,
        data: mapSupplier(supplier),
        message: '供应商创建成功',
      });
    } catch (error) {
      logger.error('创建供应商错误:', error);
      const statusCode = error instanceof AppError ? error.statusCode : 500;
      const errorKey = error instanceof Error ? error.message : '';
      const details = error instanceof AppError ? error.details : undefined;
      const messages: Record<string, string> = {
        SUPPLIER_INVALID_NAME: '供应商至少需要一个公司名称',
        SUPPLIER_INVALID_CATEGORY: '供应商分类不能为空',
        SUPPLIER_INVALID_RATING: '供应商评级必须是 0 到 5 之间的数字',
        SUPPLIER_INVALID_LEAD_TIME: '交期天数必须是大于等于 0 的整数',
        SUPPLIER_INVALID_RISK_LEVEL: '供应商风险等级不正确',
        SUPPLIER_INVALID_STATUS: '供应商状态不正确',
        SUPPLIER_INVALID_CONTACTS: '供应商联系人必须是对象数组',
        SUPPLIER_INVALID_ADDRESSES: '供应商地址必须是对象数组',
      };
      return res.status(statusCode).json({
        success: false,
        message: messages[errorKey] || '创建供应商失败',
        details,
      });
    }
  }

  async getOrders(req: AuthRequest, res: Response) {
    try {
      const { page = 1, pageSize = 20, status, supplierId, search } = req.query;
      const currentPage = Math.max(Number(page) || 1, 1);
      const limit = Math.min(Number(pageSize) || 20, 100);
      const offset = (currentPage - 1) * limit;
      const where: Prisma.PurchaseOrderWhereInput = {};

      if (status) where.status = String(status);
      if (supplierId) where.supplierId = Number(supplierId);
      if (search) {
        where.OR = [
          { item: { contains: String(search) } },
          { salesOrderRef: { contains: String(search) } },
        ];
      }

      const scopedWhere = mergeWhereAnd(where, buildOperationalDataScopeWhere(req, PROCUREMENT_DATA_SCOPE));

      const [orders, total] = await Promise.all([
        prisma.purchaseOrder.findMany({
          where: scopedWhere,
          include: { supplier: true, salesOrder: true },
          orderBy: { createdAt: 'desc' },
          skip: offset,
          take: limit,
        }),
        prisma.purchaseOrder.count({ where: scopedWhere }),
      ]);

      return res.json({
        success: true,
        data: orders.map(mapPurchaseOrder),
        meta: {
          page: currentPage,
          pageSize: limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      logger.error('获取采购单列表错误:', error);
      return res.status(500).json({ success: false, message: '服务器内部错误' });
    }
  }

  async getOrderReceipts(req: AuthRequest, res: Response) {
    try {
      const purchaseOrderId = Number(req.params.id);
      const order = await prisma.purchaseOrder.findFirst({
        where: mergeWhereAnd({ id: purchaseOrderId }, buildOperationalDataScopeWhere(req, PROCUREMENT_DATA_SCOPE)),
        include: { supplier: true, salesOrder: true },
      });
      if (!order) {
        return res.status(404).json({ success: false, message: '采购单不存在' });
      }

      const receiptBundle = await getPurchaseOrderReceiptBundle(prisma, {
        id: order.id,
        quantity: Number(order.quantity || 0),
      });

      return res.json({
        success: true,
        data: {
          purchaseOrder: mapPurchaseOrder(order),
          sourceState: await getPurchaseSourceState(prisma, order),
          ...receiptBundle,
        },
      });
    } catch (error) {
      logger.error('查询采购收货批次失败:', error);
      return res.status(500).json({ success: false, message: '查询采购收货批次失败' });
    }
  }

  async createReceipt(req: AuthRequest, res: Response) {
    try {
      if (!canViewProcurementOrders(req)) {
        return rejectProcurementScope(res);
      }

      const purchaseOrderId = Number(req.params.id);
      const result = await withDbRetry(() => prisma.$transaction(tx => createPurchaseReceiptBatch(tx, {
        purchaseOrderId,
        idempotencyKey: req.get('Idempotency-Key'),
        expectedRevision: req.body.expectedRevision,
        quantity: req.body.quantity,
        acceptedQuantity: req.body.acceptedQuantity,
        rejectedQuantity: req.body.rejectedQuantity,
        batchNo: req.body.batchNo,
        receivedAt: req.body.receivedAt,
        discrepancyReason: req.body.discrepancyReason,
        discrepancyType: req.body.discrepancyType,
        note: req.body.note,
        createdBy: req.user?.userId || null,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      })), { label: 'createPurchaseReceipt' });

      return res.status(201).json({
        success: true,
        data: {
          purchaseOrder: mapPurchaseOrder(result.purchaseOrder),
          receiptSummary: result.receiptSummary,
          receipts: result.receipts,
          discrepancyCases: result.discrepancyCases,
          discrepancyCase: result.discrepancyCase,
          submission: result.submission,
          replayed: result.replayed,
        },
        message: '采购收货批次已记录',
      });
    } catch (error) {
      const statusCode = error instanceof AppError ? error.statusCode : 500;
      const errorKey = error instanceof Error ? error.message : '';
      const details = error instanceof AppError ? error.details : undefined;
      const messages: Record<string, string> = {
        PURCHASE_ORDER_NOT_FOUND: '采购单不存在',
        PURCHASE_ORDER_CANCELLED: '已取消采购单不能收货',
        PURCHASE_ORDER_NOT_APPROVED: '采购单尚未审批，不能收货',
        PURCHASE_ORDER_ALREADY_FULLY_RECEIVED: '采购单已全部处理，不能重复收货',
        PURCHASE_RECEIPT_EXCEEDS_REMAINING: '收货数量超过剩余未处理数量',
        PURCHASE_RECEIPT_INVALID_QUANTITY: '收货数量必须大于 0，且实收入库/门口拒收数量不能为负数',
        PURCHASE_RECEIPT_QUANTITY_MISMATCH: '收货数量必须等于实收入库与门口拒收数量之和',
        PURCHASE_RECEIPT_SOURCE_FACTS_REQUIRED: '请填写实际供应商批号及所确认的采购版本；实收与拒收数量须精确相等',
        PURCHASE_RECEIPT_REVISION_CONFLICT: '采购版本已更新，请核对当前来源与审批后再登记新收货',
        PURCHASE_RECEIPT_BATCH_COLLISION: '内部收货批号已存在，须核对原收货记录，不能合并到已放行批次',
        PURCHASE_PAYABLE_RECONCILIATION_REQUIRED: '历史实收应付来源未核对，不能猜金额、补零或覆盖旧凭证',
        PURCHASE_RECEIPT_INVALID_DATE: '收货日期格式不正确',
        PURCHASE_RECEIPT_ACTOR_REQUIRED: '实收入库必须由已登录的授权人员操作',
        PURCHASE_RECEIPT_KEY_REQUIRED: '收货登记缺少稳定请求身份，请恢复原表单后再提交',
        PURCHASE_RECEIPT_KEY_CONFLICT: '原请求身份已用于不同收货事实或操作人，请核对原收货记录',
        PURCHASE_RECEIPT_SUBMISSION_INVALID: '原收货回执与审计不一致，须核对原记录，不能重复入库',
        PURCHASE_RECEIPT_INVALID_TEXT: '收货文本字段格式不正确',
        PURCHASE_RECEIPT_COST_BASIS_REQUIRED: '采购落地成本来源不完整，须核对原采购金额后再收货',
        PURCHASE_RECEIPT_COST_RECONCILIATION_REQUIRED: '历史收货库存与成本凭证不一致，须核对原凭证，不能自动补零或改写旧账',
        RECEIPT_DISCREPANCY_BLOCKED_BY_TOLERANCE: '收货差异超过容差规则，已阻止处理',
      };
      logger.error('创建采购收货批次失败:', error);
      return res.status(statusCode).json({
        success: false,
        message: messages[errorKey] || sourceMessages[errorKey] || '创建采购收货批次失败',
        errorCode: error instanceof AppError ? errorKey : 'PURCHASE_RECEIPT_INTERNAL_ERROR',
        details,
      });
    }
  }

  async createOrder(req: AuthRequest, res: Response) {
    try {
      if (!canViewProcurementOrders(req)) {
        return rejectProcurementScope(res);
      }

      const order = await prisma.$transaction(tx => createPurchaseOrder(tx, req.body, req.user!.userId));

      return res.status(201).json({
        success: true,
        data: mapPurchaseOrder(order),
        message: '采购单创建成功',
      });
    } catch (error) {
      logger.error('创建采购单错误:', error);
      if (isMaterialReleaseReadinessError(error)) {
        return res.status(error.statusCode).json({
          success: false,
          message: '可先创建待处理采购草稿；若直接创建为已审批或在途，必须关联已发布的统一物料。',
          errorCode: error.message,
          details: error.details,
        });
      }
      const statusCode = error instanceof AppError ? error.statusCode : 500;
      const errorKey = error instanceof Error ? error.message : '';
      const details = error instanceof AppError ? error.details : undefined;
      const messages: Record<string, string> = {
        PURCHASE_ORDER_INVALID_SUPPLIER_ID: '供应商参数不正确',
        PURCHASE_ORDER_INVALID_SALES_ORDER_ID: '关联销售订单参数不正确',
        PURCHASE_ORDER_INVALID_ITEM: '采购物料不能为空',
        PURCHASE_ORDER_INVALID_QUANTITY: '采购数量必须大于 0',
        PURCHASE_ORDER_INVALID_PRICE: '采购单价不能为负，且必须为有效数字',
        PURCHASE_ORDER_INVALID_EXCHANGE_RATE: '汇率必须大于 0',
        PURCHASE_ORDER_INVALID_COST: '税费和附加成本不能为负，且必须为有效数字',
        PURCHASE_ORDER_INVALID_DATE: '预计到货日期格式不正确',
        PURCHASE_ORDER_INVALID_STATUS: '采购单创建状态不正确',
        PURCHASE_ORDER_DIRECT_RECEIVE_NOT_ALLOWED: '采购入库必须通过收货动作完成，不能在创建时直接设为已收货',
        PURCHASE_INDEPENDENT_APPROVAL_REQUIRED: '采购来源必须由另一位审批人确认，不能在创建时直接设为已审批或在途',
        SUPPLIER_NOT_FOUND: '供应商不存在',
        SALES_ORDER_NOT_FOUND: '关联销售订单不存在',
        SALES_ORDER_CANCELLED: '已取消销售订单不能关联采购单',
      };
      return res.status(statusCode).json({
        success: false,
        message: messages[errorKey] || '创建采购单失败',
        errorCode: error instanceof AppError ? errorKey : 'PURCHASE_INTERNAL_ERROR',
        details,
      });
    }
  }

  async reviseOrder(req: AuthRequest, res: Response) {
    try {
      if (!canViewProcurementOrders(req)) return rejectProcurementScope(res);
      const order = await withDbRetry(() => prisma.$transaction(tx => revisePurchaseOrder(
        tx, Number(req.params.id), req.body, req.user!.userId,
      )), { label: 'revisePurchaseOrder' });
      return res.json({ success: true, data: mapPurchaseOrder(order), message: '采购新版本已保存，须重新审批' });
    } catch (error) {
      logger.error('采购版本修改失败:', error);
      return res.status(getProcurementErrorStatus(error)).json({ success: false,
        message: error instanceof AppError ? error.message : '采购版本修改失败',
        errorCode: error instanceof AppError ? error.errorCode : undefined,
        details: error instanceof AppError ? error.details : undefined });
    }
  }

  async getOrderRevisions(req: AuthRequest, res: Response) {
    try {
      const order = await prisma.purchaseOrder.findFirst({ where: mergeWhereAnd(
        { id: Number(req.params.id) }, buildOperationalDataScopeWhere(req, PROCUREMENT_DATA_SCOPE),
      ), include: { supplier: true, salesOrder: true } });
      if (!order) return res.status(404).json({ success: false, message: '采购单不存在' });
      const history = await prisma.auditLog.findMany({ where: { resource: 'purchase_order', resourceId: order.id,
        action: { in: ['CREATE', 'REVISE', 'CONFIRM_SOURCES', 'STATUS_CHANGE'] } }, orderBy: { id: 'desc' }, take: 100,
        select: { id: true, userId: true, action: true, details: true, createdAt: true } });
      return res.json({ success: true, data: { purchaseOrder: mapPurchaseOrder(order), sourceState: await getPurchaseSourceState(prisma, order), history } });
    } catch (error) {
      logger.error('读取采购变更记录失败:', error);
      return res.status(500).json({ success: false, message: '读取采购变更记录失败' });
    }
  }

  async confirmOrderSources(req: AuthRequest, res: Response) {
    try {
      if (!canViewProcurementOrders(req)) return rejectProcurementScope(res);
      const order = await withDbRetry(() => prisma.$transaction(tx => confirmPurchaseSources(tx, Number(req.params.id), req.body, req.user!.userId)),
        { label: 'confirmPurchaseOrderSources' });
      return res.json({ success: true, data: mapPurchaseOrder(order), message: '采购来源已按新版本冻结，须由另一位审批人确认；原发运事实保留' });
    } catch (error) {
      logger.error('确认采购来源失败:', error);
      return res.status(getProcurementErrorStatus(error)).json({ success: false,
        message: error instanceof AppError ? sourceMessages[error.message] || error.message : '确认采购来源失败',
        errorCode: error instanceof AppError ? error.message : 'PURCHASE_INTERNAL_ERROR', details: error instanceof AppError ? error.details : undefined });
    }
  }

  async updateOrderStatus(req: AuthRequest, res: Response) {
    try {
      if (!canViewProcurementOrders(req)) {
        return rejectProcurementScope(res);
      }

      const { id } = req.params;
      const nextStatus = normalizePurchaseStatus(req.body.status);
      const order = await withDbRetry(() => prisma.$transaction(tx => changePurchaseOrderStatus(tx, {
        purchaseOrderId: Number(id),
        nextStatus,
        createdBy: req.user?.userId || null,
        enforceTransition: true,
        expectedRevision: req.body.expectedRevision,
      })), { label: 'changePurchaseOrderStatus' });

      return res.json({
        success: true,
        data: mapPurchaseOrder(order),
        message: '采购单状态更新成功',
      });
    } catch (error) {
      logger.error('更新采购单状态错误:', error);
      if (error instanceof AppError && error.details?.reason === 'PURCHASE_REVISION_CONFLICT') {
        return res.status(409).json({ success: false, message: error.message, errorCode: error.errorCode, details: error.details });
      }
      if (isMaterialReleaseReadinessError(error)) {
        return res.status(error.statusCode).json({
          success: false,
          message: '采购单可保留为待处理草稿；审批、发运或收货前必须关联已发布的统一物料。',
          errorCode: error.message,
          details: error.details,
        });
      }
      if (error instanceof AppError && error.message === 'PURCHASE_ORDER_NOT_FOUND') {
        return res.status(error.statusCode).json({ success: false, message: '采购单不存在' });
      }
      if (error instanceof AppError && error.message === 'PURCHASE_STATUS_TRANSITION_NOT_ALLOWED') {
        return res.status(error.statusCode).json({
          success: false,
          message: `采购单状态不允许从 ${error.details?.from} 变更为 ${error.details?.to}`,
        });
      }
      if (error instanceof AppError && error.message === PARTIAL_RECEIPT_ERROR) {
        return res.status(error.statusCode).json({ success: false, message: PARTIAL_RECEIPT_MESSAGE });
      }
      return res.status(getProcurementErrorStatus(error)).json({ success: false,
        message: error instanceof AppError ? sourceMessages[error.message] || error.message : '服务器内部错误',
        errorCode: error instanceof AppError ? error.message : 'PURCHASE_INTERNAL_ERROR' });
    }
  }

  async linkB2BOrder(req: AuthRequest, res: Response) {
    try {
      if (!canViewProcurementOrders(req)) {
        return rejectProcurementScope(res);
      }

      const { id } = req.params;
      const { salesOrderId } = req.body;
      const result = await prisma.$transaction(tx => linkPurchaseOrderToSalesOrder(tx, {
        purchaseOrderId: id,
        salesOrderId,
      }));

      await writeAuditLog({
        req,
        action: 'LINK_B2B',
        resource: 'purchase_order',
        resourceId: result.purchaseOrder.id,
        details: `采购单 ${result.purchaseOrder.id} 关联销售订单 ${result.salesOrder.orderNo}`,
      });

      return res.json({
        success: true,
        data: {
          purchaseOrder: mapPurchaseOrder(result.purchaseOrder),
          salesOrder: result.salesOrder,
        },
        message: 'B2B 关联成功',
      });
    } catch (error) {
      logger.error('关联 B2B 销售订单错误:', error);
      if (error instanceof AppError && error.message === 'PURCHASE_ORDER_NOT_FOUND') {
        return res.status(error.statusCode).json({ success: false, message: '采购单不存在' });
      }
      if (error instanceof AppError && error.message === 'SALES_ORDER_NOT_FOUND') {
        return res.status(error.statusCode).json({ success: false, message: '关联销售订单不存在' });
      }
      return res.status(getProcurementErrorStatus(error)).json({ success: false, message: '服务器内部错误' });
    }
  }

  async getB2BStatus(req: AuthRequest, res: Response) {
    try {
      const { salesOrderId } = req.params;
      if (req.user?.role !== 'sales' && !canViewProcurementOrders(req)) {
        return rejectProcurementScope(res);
      }
      const result = await prisma.$transaction(tx => getB2BStatusForSalesOrder(tx, {
        salesOrderId,
        salesUserId: req.user?.role === 'sales' ? req.user.userId : null,
      }));

      if (!result.linked) {
        return res.json({ success: true, data: { linked: false } });
      }

      return res.json({
        success: true,
        data: {
          linked: true,
          purchaseOrder: mapPurchaseOrder(result.purchaseOrder),
        },
      });
    } catch (error) {
      logger.error('获取 B2B 状态错误:', error);
      if (error instanceof AppError && error.message === 'SALES_ORDER_NOT_FOUND') {
        return res.status(error.statusCode).json({ success: false, message: '关联销售订单不存在' });
      }
      return res.status(getProcurementErrorStatus(error)).json({ success: false, message: '服务器内部错误' });
    }
  }

  async syncB2BStatus(req: AuthRequest, res: Response) {
    try {
      if (!canViewProcurementOrders(req)) {
        return rejectProcurementScope(res);
      }

      const { salesOrderId } = req.params;
      const { salesStatus } = req.body;
      const result = await prisma.$transaction(tx => syncB2BSalesStatusToPurchase(tx, {
        salesOrderId,
        salesStatus,
        createdBy: req.user?.userId || null,
      }));

      if (!result.linked) {
        return res.json({ success: true, data: { linked: false } });
      }

      await writeAuditLog({
        req,
        action: 'SYNC_B2B',
        resource: 'purchase_order',
        resourceId: result.purchaseOrder.id,
        details: `销售订单 ${salesOrderId} 状态同步为 ${salesStatus}`,
      });

      return res.json({
        success: true,
        data: {
          purchaseOrder: mapPurchaseOrder(result.purchaseOrder),
          salesOrder: result.salesOrder,
        },
        message: 'B2B 状态同步成功',
      });
    } catch (error) {
      logger.error('同步 B2B 状态错误:', error);
      if (error instanceof AppError && error.message === 'SALES_ORDER_NOT_FOUND') {
        return res.status(error.statusCode).json({ success: false, message: '关联销售订单不存在' });
      }
      if (error instanceof AppError && error.message === PARTIAL_RECEIPT_ERROR) {
        return res.status(error.statusCode).json({ success: false, message: PARTIAL_RECEIPT_MESSAGE });
      }
      return res.status(getProcurementErrorStatus(error)).json({ success: false, message: '服务器内部错误' });
    }
  }
}
