import { Response } from 'express';
import prisma from '../../config/database';
import { AuthRequest } from '../../middleware/auth';
import { ApiResponse } from '../../types/api.types';
import { logger } from '../../utils/logger';
import {
  canUseOperationalDataScope,
  canUseOrderForBusinessWrite,
} from '../../utils/recordAccess';

export const getConflictMessage = (error: unknown) => error instanceof Error ? error.message : null;

export const getLoadErrorMessage = (label: string, error: unknown) =>
  `${label}: ${error instanceof Error ? error.message : String(error)}`;

export const collectionOrderScopeSelect = {
  id: true,
  customerId: true,
  createdBy: true,
  customer: {
    select: {
      salespersonId: true,
      poolState: true,
      segment: true,
    },
  },
} as const;

export const logCollectionAudit = async (
  req: AuthRequest,
  action: string,
  resourceId: number,
  details: string,
) => {
  if (!req.user?.userId) return;
  try {
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        action,
        resource: 'collection',
        resourceId,
        details,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      },
    });
  } catch (error) {
    logger.warn('回款/风控审计日志写入失败，业务操作已保留', error);
  }
};

export const canManageFinanceCollections = (req: AuthRequest) =>
  canUseOperationalDataScope(req, 'finance_visible');

export const sendCollectionForbidden = (
  res: Response,
  message = 'You do not have permission to operate this collection record.',
) => res.status(403).json({ success: false, message } as ApiResponse);

export const requireCollectionOrderAccess = async (
  req: AuthRequest,
  res: Response,
  orderId: number,
) => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: collectionOrderScopeSelect,
  });

  if (!order) {
    res.status(404).json({ success: false, message: 'Order not found' } as ApiResponse);
    return null;
  }

  if (!canUseOrderForBusinessWrite(req, order)) {
    sendCollectionForbidden(res, 'You do not have permission to operate collections for this order.');
    return null;
  }

  return order;
};

export const requireFinanceCollectionScope = async (
  req: AuthRequest,
  res: Response,
) => {
  if (!canManageFinanceCollections(req)) {
    sendCollectionForbidden(res, 'Finance collection scope is required for this operation.');
    return false;
  }

  return true;
};
