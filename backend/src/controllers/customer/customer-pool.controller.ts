import { Response } from 'express';
import prisma from '../../config/database';
import { AuthRequest } from '../../middleware/auth';
import { ApiResponse } from '../../types/api.types';
import { logger } from '../../utils/logger';
import { withDbRetry } from '../../utils/dbRetry';
import { canManageCustomerPool, canViewCustomerSensitiveRelations, validateAssignedSalesperson } from './customer.access';
import { buildCustomerPayload, deriveAddresses, normalizePoolState, resolvePoolAuditAction } from './customer.payload';
import {
  loadCustomerAddressMap,
  loadCustomerForRequest,
  parseAuditDetails,
  writeCustomerAuditLog,
} from './customer.persistence';
import type { CustomerPoolAction, CustomerPoolState, CustomerSegment } from './customer.types';

export async function updateCustomerPool(req: AuthRequest, res: Response) {
  try {
    if (!canManageCustomerPool(req)) {
      return res.status(403).json({
        success: false,
        message: '当前角色不能调整客户池',
      } as ApiResponse);
    }

    const id = Number(req.params.id);
    const existing = await loadCustomerForRequest(req, id);

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: '客户不存在',
      } as ApiResponse);
    }

    const poolState = req.body.poolState as CustomerPoolState;
    const reason = req.body.reason || null;
    const requestedSalespersonId = req.body.salespersonId !== undefined && req.body.salespersonId !== null
      ? Number(req.body.salespersonId)
      : null;

    let salespersonId: number | null = null;
    if (poolState === 'private') {
      salespersonId = requestedSalespersonId || existing.salespersonId || null;
      if (!salespersonId) {
        return res.status(400).json({
          success: false,
          message: '私海客户必须指定销售负责人',
        } as ApiResponse);
      }
    }

    const previousPoolState = normalizePoolState(existing);
    const nextSalespersonId = poolState === 'private' ? salespersonId : null;
    const samePool =
      previousPoolState === poolState &&
      String(existing.salespersonId || '') === String(nextSalespersonId || '');

    const existingAddressMap = await loadCustomerAddressMap([existing.id]);
    const existingAddresses = deriveAddresses({
      ...existing,
      addressesJson: existingAddressMap.get(existing.id)?.addressesJson || null,
    });

    if (samePool) {
      return res.json({
        success: true,
        data: buildCustomerPayload(existing, undefined, { addresses: existingAddresses }),
        message: '客户池未变更',
      } as ApiResponse);
    }

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: '客户池变更必须填写原因',
      } as ApiResponse);
    }

    if (nextSalespersonId) {
      const salespersonCheck = await validateAssignedSalesperson(nextSalespersonId, (existing.segment as CustomerSegment) || 'mixed');
      if (!salespersonCheck.ok) {
        return res.status(400).json({
          success: false,
          message: salespersonCheck.message,
        } as ApiResponse);
      }
    }

    const updated = await withDbRetry(() => prisma.customer.update({
      where: { id },
      data: {
        poolState,
        salesperson: nextSalespersonId ? { connect: { id: nextSalespersonId } } : { disconnect: true },
        poolReason: reason,
        poolUpdatedAt: new Date(),
        poolUpdatedByUser: { connect: { id: req.user!.userId } },
      },
      include: {
        salesperson: { select: { id: true, username: true } },
        poolUpdatedByUser: { select: { id: true, username: true } },
      },
    }), { label: 'updateCustomerPool' });

    const action = resolvePoolAuditAction(previousPoolState, poolState);

    await writeCustomerAuditLog({
      userId: req.user!.userId,
      action,
      resourceId: updated.id,
      details: JSON.stringify({
        previousPoolState,
        nextPoolState: poolState,
        salespersonId: nextSalespersonId,
        reason,
      }),
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return res.json({
      success: true,
      data: buildCustomerPayload(updated, undefined, { addresses: existingAddresses }),
      message: '客户池更新成功',
    } as ApiResponse);
  } catch (error) {
    logger.error('更新客户池错误:', error);
    return res.status(500).json({
      success: false,
      message: '服务器内部错误',
    } as ApiResponse);
  }
}

export async function getCustomerPoolHistory(req: AuthRequest, res: Response) {
  try {
    const id = Number(req.params.id);
    const existing = await loadCustomerForRequest(req, id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: '客户不存在',
      } as ApiResponse);
    }

    if (!canViewCustomerSensitiveRelations(req, existing)) {
      return res.status(403).json({
        success: false,
        message: '当前角色无权查看该客户的池归属历史',
      } as ApiResponse);
    }

    const logs = await prisma.auditLog.findMany({
      where: {
        resource: 'customer',
        resourceId: id,
        action: {
          in: ['POOL_ASSIGN', 'POOL_RELEASE', 'POOL_RECLAIM', 'POOL_TRANSFER'] satisfies CustomerPoolAction[],
        },
      },
      include: {
        user: { select: { id: true, username: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const salespersonIds = Array.from(new Set([
      ...logs
        .map(log => parseAuditDetails(log.details).salespersonId)
        .filter((value): value is number => typeof value === 'number'),
      ...(existing.salespersonId ? [existing.salespersonId] : []),
    ]));

    const salespeople = salespersonIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: salespersonIds } },
          select: { id: true, username: true },
        })
      : [];
    const salespersonNameMap = new Map(salespeople.map(user => [user.id, user.username]));

    const history = logs.map((log) => {
      const details = parseAuditDetails(log.details);
      return {
        id: log.id,
        action: log.action,
        previousPoolState: details.previousPoolState || null,
        nextPoolState: details.nextPoolState || null,
        salespersonId: details.salespersonId != null ? String(details.salespersonId) : null,
        salespersonName: details.salespersonId != null ? (salespersonNameMap.get(Number(details.salespersonId)) || null) : null,
        reason: details.reason || null,
        operatorName: log.user.username,
        operatorRole: log.user.role,
        createdAt: log.createdAt.toISOString(),
      };
    });

    return res.json({
      success: true,
      data: {
        customerId: existing.id,
        history,
        latest: history[0] || null,
        currentPool: {
          poolState: normalizePoolState(existing),
          salespersonId: existing.salespersonId != null ? String(existing.salespersonId) : null,
          salespersonName: existing.salesperson?.username || null,
          poolReason: existing.poolReason || null,
          poolUpdatedAt: existing.poolUpdatedAt ? existing.poolUpdatedAt.toISOString() : null,
          poolUpdatedBy: existing.poolUpdatedByUser?.username || null,
        },
      },
    } as ApiResponse);
  } catch (error) {
    logger.error('获取客户池历史错误:', error);
    return res.status(500).json({
      success: false,
      message: '服务器内部错误',
    } as ApiResponse);
  }
}
