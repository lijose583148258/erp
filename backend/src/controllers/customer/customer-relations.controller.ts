import { Response } from 'express';
import prisma from '../../config/database';
import { AuthRequest } from '../../middleware/auth';
import { ApiResponse } from '../../types/api.types';
import { logger } from '../../utils/logger';
import { OrderWorkspaceService } from '../../services/order-workspace.service';
import { canViewCustomerSensitiveRelations } from './customer.access';
import { loadCustomerForRequest } from './customer.persistence';
import { MAX_CUSTOMER_PAGE_SIZE } from './customer.types';

export async function getCustomerOrders(req: AuthRequest, res: Response) {
  try {
    const id = Number(req.params.id);
    const customer = await loadCustomerForRequest(req, id);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: '客户不存在',
      } as ApiResponse);
    }

    const result = await OrderWorkspaceService.getOrders(
      {
        customerId: id,
        page: 1,
        pageSize: MAX_CUSTOMER_PAGE_SIZE,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      },
      req,
    );

    return res.json({
      success: true,
      data: result.data,
      meta: result.meta,
    } as ApiResponse);
  } catch (error) {
    logger.error('获取客户订单错误:', error);
    return res.status(500).json({
      success: false,
      message: '服务器内部错误',
    } as ApiResponse);
  }
}

export async function getCustomerRmas(req: AuthRequest, res: Response) {
  try {
    const id = Number(req.params.id);
    const customer = await loadCustomerForRequest(req, id);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: '客户不存在',
      } as ApiResponse);
    }

    const rmas = await prisma.rma.findMany({
      where: {
        customerId: id,
        ...(req.user?.role === 'sales' ? { createdBy: req.user.userId } : {}),
      },
      include: {
        creator: { select: { id: true, username: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({
      success: true,
      data: rmas.map(rma => ({
        ...rma,
        quantity: Number(rma.quantity),
        refundAmount: rma.refundAmount !== null ? Number(rma.refundAmount) : null,
        createdAt: rma.createdAt.toISOString(),
        resolvedAt: rma.resolvedAt ? rma.resolvedAt.toISOString() : null,
        creatorName: rma.creator.username,
      })),
    } as ApiResponse);
  } catch (error) {
    logger.error('获取客户售后错误:', error);
    return res.status(500).json({
      success: false,
      message: '服务器内部错误',
    } as ApiResponse);
  }
}

export async function getCustomerAssets(req: AuthRequest, res: Response) {
  try {
    const id = Number(req.params.id);
    const customer = await loadCustomerForRequest(req, id);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: '客户不存在',
      } as ApiResponse);
    }

    if (!canViewCustomerSensitiveRelations(req, customer)) {
      return res.status(403).json({
        success: false,
        message: '当前角色无权查看该客户的资产流转明细',
      } as ApiResponse);
    }

    const [balances, transactions] = await Promise.all([
      prisma.assetBalance.findMany({
        where: { customerId: id },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.assetTransaction.findMany({
        where: { customerId: id },
        include: {
          creator: { select: { id: true, username: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return res.json({
      success: true,
      data: {
        balances: balances.map(balance => ({
          id: balance.id,
          customerId: balance.customerId,
          assetType: balance.assetType,
          balance: Number(balance.balance),
          updatedAt: balance.updatedAt.toISOString(),
        })),
        transactions: transactions.map(transaction => ({
          id: transaction.id,
          customerId: transaction.customerId,
          assetType: transaction.assetType,
          quantity: Number(transaction.quantity),
          action: transaction.action,
          relatedOrderNo: transaction.relatedOrderNo,
          note: transaction.note,
          createdAt: transaction.createdAt.toISOString(),
          creatorName: transaction.creator.username,
        })),
      },
    } as ApiResponse);
  } catch (error) {
    logger.error('获取客户资产错误:', error);
    return res.status(500).json({
      success: false,
      message: '服务器内部错误',
    } as ApiResponse);
  }
}
