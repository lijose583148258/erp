import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { logger } from '../utils/logger';

export async function writeOrderAuditLog(req: AuthRequest, input: {
    action: string;
    resourceId?: number | null;
    details: string;
}) {
    if (!req.user?.userId) return;
    try {
        await prisma.auditLog.create({
            data: {
                userId: req.user.userId,
                action: input.action,
                resource: 'order',
                resourceId: input.resourceId ?? null,
                details: input.details,
                ipAddress: req.ip,
                userAgent: req.get('user-agent'),
            },
        });
    } catch (error) {
        logger.warn('订单审计日志写入失败，业务操作已保留', error);
    }
}
