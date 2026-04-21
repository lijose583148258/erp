import { Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { AuthRequest } from '../middleware/auth';
import { roleExistsAndActive } from '../services/authorization-policy.service';

type UserSegment = 'direct' | 'channel' | 'mixed';

function resolveUserSegment(role: string, segment?: string | null): UserSegment {
    if (segment === 'direct' || segment === 'channel' || segment === 'mixed') {
        return segment;
    }

    if (role === 'sales') {
        return 'direct';
    }

    return 'mixed';
}

export class TeamController {
    async createMember(req: AuthRequest, res: Response) {
        try {
            const { username, password, email, role = 'sales', segment } = req.body;
            if (!(await roleExistsAndActive(role))) {
                return res.status(400).json({ success: false, message: '角色不存在或已禁用' });
            }

            const existingUser = await prisma.user.findUnique({
                where: { username },
                select: { id: true },
            });

            if (existingUser) {
                return res.status(400).json({ success: false, message: '用户名已存在' });
            }

            const passwordHash = await bcrypt.hash(password, 12);
            const resolvedSegment = resolveUserSegment(role, segment);

            const user = await prisma.user.create({
                data: {
                    username,
                    passwordHash,
                    email: email || null,
                    role,
                    segment: resolvedSegment,
                    isActive: true,
                },
                select: {
                    id: true,
                    username: true,
                    email: true,
                    role: true,
                    segment: true,
                    createdAt: true,
                },
            });

            try {
                await prisma.auditLog.create({
                    data: {
                        userId: req.user!.userId,
                        action: 'CREATE',
                        resource: 'user',
                        resourceId: user.id,
                        details: `创建团队成员: ${user.username}`,
                        ipAddress: req.ip,
                        userAgent: req.get('user-agent'),
                    },
                });
            } catch (error) {
                logger.warn('创建团队成员审计写入失败', error);
            }

            return res.status(201).json({
                success: true,
                data: user,
                message: '团队成员创建成功',
            });
        } catch (error) {
            logger.error('创建团队成员错误:', error);
            return res.status(500).json({ success: false, message: '服务器内部错误' });
        }
    }

    /**
     * 获取团队成员列表
     */
    async getTeamMembers(req: AuthRequest, res: Response) {
        try {
            const users = await prisma.user.findMany({
                where: { isActive: true },
                select: {
                    id: true,
                    username: true,
                    email: true,
                    role: true,
                    segment: true,
                    avatar: true,
                    lastLoginAt: true,
                    createdAt: true,
                    _count: {
                        select: {
                            customers: true,
                            orders: true,
                        },
                    },
                },
                orderBy: { createdAt: 'desc' },
            });

            res.json({
                success: true,
                data: users.map((user) => ({
                    ...user,
                    customerCount: user._count.customers,
                    orderCount: user._count.orders,
                })),
            });
        } catch (error) {
            logger.error('获取团队列表错误:', error);
            res.status(500).json({ success: false, message: '服务器内部错误' });
        }
    }

    /**
     * 获取团队业绩
     */
    async getPerformance(req: AuthRequest, res: Response) {
        try {
            const { startDate, endDate } = req.query;

            const dateFilter: { gte?: Date; lte?: Date } = {};
            if (startDate) dateFilter.gte = new Date(startDate as string);
            if (endDate) dateFilter.lte = new Date(endDate as string);

            const performance = await prisma.user.findMany({
                where: {
                    isActive: true,
                    role: { in: ['sales', 'manager'] },
                },
                select: {
                    id: true,
                    username: true,
                    role: true,
                    segment: true,
                    orders: {
                        where: dateFilter.gte || dateFilter.lte ? { createdAt: dateFilter } : undefined,
                        select: {
                            id: true,
                            finalAmount: true,
                            status: true,
                        },
                    },
                    customers: {
                        select: { id: true },
                    },
                },
            });

            const performanceData = performance.map((user) => {
                const totalOrders = user.orders.length;
                const totalAmount = user.orders.reduce((sum, order) => sum + Number(order.finalAmount), 0);
                const completedOrders = user.orders.filter((order) => order.status === 'delivered').length;

                return {
                    userId: user.id,
                    username: user.username,
                    role: user.role,
                    segment: user.segment,
                    totalOrders,
                    completedOrders,
                    totalAmount,
                    customerCount: user.customers.length,
                    completionRate: totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0,
                };
            });

            res.json({
                success: true,
                data: performanceData.sort((a, b) => b.totalAmount - a.totalAmount),
            });
        } catch (error) {
            logger.error('获取团队业绩错误:', error);
            res.status(500).json({ success: false, message: '服务器内部错误' });
        }
    }

    /**
     * 更新团队成员信息
     */
    async updateMember(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            const { role, segment, isActive, email, avatar } = req.body;
            if (role !== undefined && !(await roleExistsAndActive(role))) {
                return res.status(400).json({ success: false, message: '角色不存在或已禁用' });
            }
            const segmentPatch = role !== undefined || segment !== undefined
                ? { segment: resolveUserSegment(role, segment) }
                : {};

            const user = await prisma.user.update({
                where: { id: Number(id) },
                data: {
                    ...(role !== undefined && { role }),
                    ...segmentPatch,
                    ...(isActive !== undefined && { isActive }),
                    ...(email !== undefined && { email }),
                    ...(avatar !== undefined && { avatar }),
                },
                select: {
                    id: true,
                    username: true,
                    email: true,
                    role: true,
                    segment: true,
                    isActive: true,
                },
            });

            try {
                await prisma.auditLog.create({
                    data: {
                        userId: req.user!.userId,
                        action: 'UPDATE',
                        resource: 'user',
                        resourceId: user.id,
                        details: `更新用户: ${user.username}`,
                        ipAddress: req.ip,
                        userAgent: req.get('user-agent'),
                    },
                });
            } catch (error) {
                logger.warn('更新团队成员审计写入失败', error);
            }

            res.json({ success: true, data: user, message: '用户更新成功' });
        } catch (error) {
            logger.error('更新用户错误:', error);
            res.status(500).json({ success: false, message: '服务器内部错误' });
        }
    }
}
