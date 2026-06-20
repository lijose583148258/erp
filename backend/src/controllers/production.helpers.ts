import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { logger } from '../utils/logger';

export const toNumber = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const createProductionAuditLog = async (
  req: AuthRequest,
  action: string,
  details: Record<string, unknown>,
  resourceId?: number | null,
) => {
  if (!req.user?.userId) return;
  try {
    await prisma.auditLog.create({
      data: {
        userId: req.user.userId,
        action,
        resource: 'production',
        resourceId: resourceId ?? null,
        details: JSON.stringify(details),
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      },
    });
  } catch (error) {
    logger.warn('生产审计日志写入失败，业务操作已保留', error);
  }
};
