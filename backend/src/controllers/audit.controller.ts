import { Response } from 'express';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { AuthRequest } from '../middleware/auth';

export class AuditController {
    /**
     * 获取审计日志列表
     */
    async getLogs(req: AuthRequest, res: Response) {
        try {
            const { page = 1, pageSize = 20, userId, action, resource, startDate, endDate } = req.query;

            const limit = Math.min(Number(pageSize), 100);
            const offset = (Number(page) - 1) * limit;

            const where: any = {};
            if (userId) where.userId = Number(userId);
            if (action) where.action = action;
            if (resource) where.resource = resource;

            if (startDate || endDate) {
                where.createdAt = {};
                if (startDate) where.createdAt.gte = new Date(startDate as string);
                if (endDate) where.createdAt.lte = new Date(endDate as string);
            }

            const [logs, total] = await Promise.all([
                prisma.auditLog.findMany({
                    where,
                    include: {
                        user: { select: { id: true, username: true, role: true } },
                    },
                    orderBy: { createdAt: 'desc' },
                    skip: offset,
                    take: limit,
                }),
                prisma.auditLog.count({ where }),
            ]);

            res.json({
                success: true,
                data: logs,
                meta: {
                    page: Number(page),
                    pageSize: limit,
                    total,
                    totalPages: Math.ceil(total / limit)
                },
            });
        } catch (error) {
            logger.error('获取审计日志错误:', error);
            res.status(500).json({ success: false, message: '服务器内部错误' });
        }
    }
}
