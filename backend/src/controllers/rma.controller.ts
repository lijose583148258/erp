import { Request, Response } from 'express';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { AuthRequest } from '../middleware/auth';
import { buildBusinessNo } from '../utils/businessNo';
import { withDbRetry } from '../utils/dbRetry';
import {
    buildCustomerDataScopeWhere,
    canUseCustomerForBusinessWrite,
    hasDataScope,
    mergeWhereAnd,
} from '../utils/recordAccess';

function buildRmaDataScopeWhere(req: AuthRequest) {
    if (!req.user) return { id: -1 };

    if (req.user.role === 'admin' || hasDataScope(req, 'all')) return {};

    const customerScope = buildCustomerDataScopeWhere(req);
    if (req.user.role === 'sales' || hasDataScope(req, 'own_customers')) {
        return {
            OR: [
                { createdBy: req.user.userId },
                { customer: customerScope },
            ],
        };
    }

    return Object.keys(customerScope).length > 0 ? { customer: customerScope } : {};
}

function canResolveRmaRecord(req: AuthRequest, rma: {
    customer?: {
        salespersonId: number | null;
        poolState: string | null;
        segment: string | null;
    } | null;
}) {
    if (!req.user) return false;
    if (req.user.role === 'admin' || hasDataScope(req, 'all')) return true;
    return rma.customer ? canUseCustomerForBusinessWrite(req, rma.customer) : false;
}

export class RmaController {
    /**
     * 获取售后列表
     */
    async getRmas(req: AuthRequest, res: Response) {
        try {
            const { page = 1, pageSize = 20, status, customerId } = req.query;

            const limit = Math.min(Number(pageSize), 100);
            const offset = (Number(page) - 1) * limit;

            const where: any = {};
            if (status) where.status = status;
            if (customerId) where.customerId = Number(customerId);
            const scopedWhere = mergeWhereAnd(where, buildRmaDataScopeWhere(req));

            const [rmas, total] = await Promise.all([
                prisma.rma.findMany({
                    where: scopedWhere,
                    include: {
                        customer: {
                            select: {
                                id: true,
                                name: true,
                                nameZh: true,
                                nameEn: true,
                                nameVi: true
                            }
                        },
                        creator: { select: { id: true, username: true } },
                    },
                    orderBy: { createdAt: 'desc' },
                    skip: offset,
                    take: limit,
                }),
                prisma.rma.count({ where: scopedWhere }),
            ]);

            res.json({
                success: true,
                data: rmas.map(r => ({
                    ...r,
                    quantity: Number(r.quantity),
                    refundAmount: r.refundAmount ? Number(r.refundAmount) : null,
                    customerName: r.customer.name,
                    customerNameZh: r.customer.nameZh,
                    customerNameEn: r.customer.nameEn,
                    customerNameVi: r.customer.nameVi,
                    customerDisplayName: r.customer.nameZh || r.customer.nameEn || r.customer.nameVi || r.customer.name,
                    creatorName: r.creator.username,
                })),
                meta: {
                    page: Number(page),
                    pageSize: limit,
                    total,
                    totalPages: Math.ceil(total / limit)
                },
            });
        } catch (error) {
            logger.error('获取售后列表错误:', error);
            res.status(500).json({ success: false, message: '服务器内部错误' });
        }
    }

    /**
     * 创建售后申请
     */
    async createRma(req: AuthRequest, res: Response) {
        try {
            const { customerId, productName, quantity, unit = '件', reason } = req.body;

            const rmaNo = buildBusinessNo('RMA');
            const customer = await prisma.customer.findUnique({
                where: { id: Number(customerId) },
                select: { id: true, status: true, salespersonId: true, poolState: true, segment: true },
            });

            if (!customer) {
                return res.status(400).json({ success: false, message: '客户不存在' });
            }
            if (customer.status !== 'active') {
                return res.status(400).json({ success: false, message: '只能为 active 客户创建售后申请' });
            }
            if (!canUseCustomerForBusinessWrite(req, customer)) {
                return res.status(403).json({ success: false, message: '无权为该客户创建售后申请' });
            }

            const rma = await withDbRetry(() => prisma.rma.create({
                data: {
                    rmaNo,
                    customerId: Number(customerId),
                    productName,
                    quantity,
                    unit,
                    reason,
                    status: 'pending',
                    createdBy: req.user!.userId,
                },
            }), { label: 'createRma' });

            await prisma.auditLog.create({
                data: {
                    userId: req.user!.userId,
                    action: 'CREATE',
                    resource: 'rma',
                    resourceId: rma.id,
                    details: `创建售后申请: ${rmaNo}`,
                    ipAddress: req.ip,
                    userAgent: req.get('user-agent'),
                },
            });

            res.status(201).json({ success: true, data: rma, message: '售后申请创建成功' });
        } catch (error) {
            logger.error('创建售后错误:', error);
            res.status(500).json({ success: false, message: '服务器内部错误' });
        }
    }

    /**
     * 处理售后申请
     */
    async resolveRma(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            const { status, resolution, refundAmount } = req.body;

            const existing = await prisma.rma.findUnique({
                where: { id: Number(id) },
                select: {
                    id: true,
                    customer: { select: { salespersonId: true, poolState: true, segment: true } },
                },
            });
            if (!existing) {
                return res.status(404).json({ success: false, message: '售后申请不存在' });
            }
            if (!canResolveRmaRecord(req, existing)) {
                return res.status(403).json({ success: false, message: '无权处理该售后申请' });
            }

            const rma = await prisma.rma.update({
                where: { id: Number(id) },
                data: {
                    status,
                    resolution,
                    refundAmount: refundAmount ? Number(refundAmount) : null,
                    resolvedAt: new Date(),
                },
            });

            await prisma.auditLog.create({
                data: {
                    userId: req.user!.userId,
                    action: 'RESOLVE',
                    resource: 'rma',
                    resourceId: rma.id,
                    details: `处理售后: ${rma.rmaNo} -> ${status}`,
                    ipAddress: req.ip,
                    userAgent: req.get('user-agent'),
                },
            });

            res.json({ success: true, data: rma, message: '售后处理成功' });
        } catch (error) {
            logger.error('处理售后错误:', error);
            res.status(500).json({ success: false, message: '服务器内部错误' });
        }
    }
}
