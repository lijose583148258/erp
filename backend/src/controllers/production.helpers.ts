import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';

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
  await prisma.auditLog.create({
    data: {
      userId: req.user!.userId,
      action,
      resource: 'production',
      resourceId: resourceId ?? null,
      details: JSON.stringify(details),
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    },
  });
};
