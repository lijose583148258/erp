import { Request, Response } from 'express';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { AuthRequest } from '../middleware/auth';
import { buildBusinessNo } from '../utils/businessNo';
import { withDbRetry } from '../utils/dbRetry';
import {
    buildCustomerDataScopeWhere,
    canUseCustomerForBusinessWrite,
    canUseOperationalDataScope,
    hasDataScope,
    mergeWhereAnd,
} from '../utils/recordAccess';

async function writeSampleAuditLog(data: {
    userId: number;
    action: string;
    resourceId: number;
    details: string;
    ipAddress?: string;
    userAgent?: string;
}) {
    try {
        await prisma.auditLog.create({
            data: {
                userId: data.userId,
                action: data.action,
                resource: 'sample',
                resourceId: data.resourceId,
                details: data.details,
                ipAddress: data.ipAddress,
                userAgent: data.userAgent,
            },
        });
    } catch (error) {
        logger.warn('样品审计日志写入失败，业务操作已保留:', error);
    }
}

function buildSampleDataScopeWhere(req: AuthRequest) {
    if (!req.user) return { id: -1 };
    if (canUseOperationalDataScope(req, 'warehouse_visible')) return {};

    const customerScope = buildCustomerDataScopeWhere(req);
    if (req.user.role === 'sales' || hasDataScope(req, 'own_customers')) {
        return {
            OR: [
                { requestedBy: req.user.userId },
                { customer: customerScope },
            ],
        };
    }

    return Object.keys(customerScope).length > 0 ? { customer: customerScope } : {};
}

function canManageSampleStatus(req: AuthRequest, sample: {
    requestedBy?: number | null;
    customer?: {
        salespersonId: number | null;
        poolState: string | null;
        segment: string | null;
    } | null;
}) {
    if (!req.user) return false;
    if (canUseOperationalDataScope(req, 'warehouse_visible')) return true;
    if ((req.user.role === 'sales' || hasDataScope(req, 'own_customers')) && sample.requestedBy === req.user.userId) {
        return true;
    }
    return sample.customer ? canUseCustomerForBusinessWrite(req, sample.customer) : false;
}

export class SampleController {
    /**
     * 获取样品列表
     */
    async getSamples(req: AuthRequest, res: Response) {
        try {
            const { page = 1, pageSize = 20, status, customerId } = req.query;

            const limit = Math.min(Number(pageSize), 100);
            const offset = (Number(page) - 1) * limit;

            const where: any = {};
            if (status) where.status = status;
            if (customerId) where.customerId = Number(customerId);
            const scopedWhere = mergeWhereAnd(where, buildSampleDataScopeWhere(req));

            const [samples, total] = await Promise.all([
                prisma.sample.findMany({
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
                        requester: { select: { id: true, username: true } },
                    },
                    orderBy: { createdAt: 'desc' },
                    skip: offset,
                    take: limit,
                }),
                prisma.sample.count({ where: scopedWhere }),
            ]);

            res.json({
                success: true,
                data: samples.map(s => ({
                    ...s,
                    quantity: Number(s.quantity),
                    customerName: s.customer.name,
                    customerNameZh: s.customer.nameZh,
                    customerNameEn: s.customer.nameEn,
                    customerNameVi: s.customer.nameVi,
                    customerDisplayName: s.customer.nameZh || s.customer.nameEn || s.customer.nameVi || s.customer.name,
                    requesterName: s.requester.username,
                })),
                meta: {
                    page: Number(page),
                    pageSize: limit,
                    total,
                    totalPages: Math.ceil(total / limit)
                },
            });
        } catch (error) {
            logger.error('获取样品列表错误:', error);
            res.status(500).json({ success: false, message: '服务器内部错误' });
        }
    }

    /**
     * 创建样品申请
     */
    async createSample(req: AuthRequest, res: Response) {
        try {
            const { customerId, productName, quantity, unit = '件', shippingAddress } = req.body;

            const sampleNo = buildBusinessNo('SMP');
            const customer = await prisma.customer.findUnique({
                where: { id: Number(customerId) },
                select: { id: true, status: true, salespersonId: true, poolState: true, segment: true },
            });

            if (!customer) {
                return res.status(400).json({ success: false, message: '客户不存在' });
            }
            if (customer.status !== 'active') {
                return res.status(400).json({ success: false, message: '只能为 active 客户创建样品申请' });
            }
            if (!canUseCustomerForBusinessWrite(req, customer)) {
                return res.status(403).json({ success: false, message: '无权为该客户创建样品申请' });
            }

            const sample = await withDbRetry(() => prisma.sample.create({
                data: {
                    sampleNo,
                    customerId: Number(customerId),
                    productName,
                    quantity,
                    unit,
                    shippingAddress,
                    status: 'requested',
                    requestedBy: req.user!.userId,
                },
            }), { label: 'createSample' });

            await writeSampleAuditLog({
                userId: req.user!.userId,
                action: 'CREATE',
                resourceId: sample.id,
                details: `创建样品申请: ${sampleNo}`,
                ipAddress: req.ip,
                userAgent: req.get('user-agent'),
            });

            res.status(201).json({ success: true, data: sample, message: '样品申请创建成功' });
        } catch (error) {
            logger.error('创建样品错误:', error);
            res.status(500).json({ success: false, message: '服务器内部错误' });
        }
    }

    /**
     * 更新样品状态
     */
    async updateStatus(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            const { status, trackingNo, feedback } = req.body;

            const existing = await prisma.sample.findUnique({
                where: { id: Number(id) },
                select: {
                    id: true,
                    requestedBy: true,
                    customer: { select: { salespersonId: true, poolState: true, segment: true } },
                },
            });
            if (!existing) {
                return res.status(404).json({ success: false, message: '样品申请不存在' });
            }
            if (!canManageSampleStatus(req, existing)) {
                return res.status(403).json({ success: false, message: '无权更新该样品申请' });
            }

            const updateData: any = { status };
            if (status === 'sent') {
                updateData.sentAt = new Date();
                if (trackingNo) updateData.trackingNo = trackingNo;
            }
            if (feedback) updateData.feedback = feedback;

            const sample = await prisma.sample.update({
                where: { id: Number(id) },
                data: updateData,
            });

            await writeSampleAuditLog({
                userId: req.user!.userId,
                action: 'STATUS_CHANGE',
                resourceId: sample.id,
                details: `样品状态变更: ${sample.sampleNo} -> ${status}`,
                ipAddress: req.ip,
                userAgent: req.get('user-agent'),
            });

            res.json({ success: true, data: sample, message: '样品状态更新成功' });
        } catch (error) {
            logger.error('更新样品状态错误:', error);
            res.status(500).json({ success: false, message: '服务器内部错误' });
        }
    }
}
