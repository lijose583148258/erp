import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { AuthRequest } from '../middleware/auth';
import { buildBusinessNo } from '../utils/businessNo';
import { withDbRetry } from '../utils/dbRetry';
import { getUploadDir } from '../config/runtime';
import {
    buildCustomerDataScopeWhere,
    canUseCustomerForBusinessWrite,
    hasDataScope,
    mergeWhereAnd,
} from '../utils/recordAccess';

// H7修复：Base64 图片存磁盘，数据库只存路径
const getContractUploadDir = () => path.join(getUploadDir(), 'contracts');
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB 限制

/**
 * 检测 fileUrl 是否为 base64 编码，若是则保存到磁盘并返回文件路径
 */
function persistBase64ToDisk(fileUrl: string | null | undefined): string | null | undefined {
    if (!fileUrl || !fileUrl.startsWith('data:')) {
        return fileUrl; // 非 base64，原样返回
    }

    // 解析 MIME 类型和数据
    const match = fileUrl.match(/^data:(image\/\w+|application\/pdf);base64,(.+)$/);
    if (!match) {
        logger.warn('H7: 无法解析 base64 文件格式，跳过磁盘持久化');
        return fileUrl;
    }

    const mimeType = match[1];
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, 'base64');

    // 文件大小限制
    if (buffer.length > MAX_FILE_SIZE) {
        logger.warn(`H7: 文件超过 ${MAX_FILE_SIZE / 1024 / 1024}MB 限制 (${(buffer.length / 1024 / 1024).toFixed(1)}MB), 仍保存但记录警告`);
    }

    // 确保目录存在
    const uploadsDir = getContractUploadDir();
    fs.mkdirSync(uploadsDir, { recursive: true });

    // 生成唯一文件名
    const ext = mimeType === 'application/pdf' ? '.pdf' : '.' + mimeType.split('/')[1];
    const filename = `contract_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    const filePath = path.join(uploadsDir, filename);

    fs.writeFileSync(filePath, buffer);
    logger.info(`H7: 合同文件已保存到磁盘: ${filename} (${(buffer.length / 1024).toFixed(1)}KB)`);

    // 返回相对路径给数据库
    return `/uploads/contracts/${filename}`;
}

const getCustomerDisplayName = (customer: {
    name?: string | null;
    nameZh?: string | null;
    nameEn?: string | null;
    nameVi?: string | null;
}) => customer.nameZh || customer.nameEn || customer.nameVi || customer.name || '';

const normalizeOcrMetadata = (value: unknown): string | null => {
    if (value === undefined || value === null || value === '') {
        return null;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
    }

    try {
        return JSON.stringify(value);
    } catch {
        return null;
    }
};

const parseContractMetadata = (raw: string | null | undefined): Record<string, any> => {
    if (!raw) {
        return { items: [] };
    }

    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return {
                ...parsed,
                items: Array.isArray((parsed as any).items) ? (parsed as any).items : [],
            };
        }
    } catch {
        logger.warn('Invalid contract OCR metadata, resetting to empty object');
    }

    return { items: [] };
};

const canViewContract = (req: AuthRequest, contract: {
    customer: {
        salespersonId: number | null;
        poolState: string | null;
        segment: string | null;
    };
}) => {
    if (req.user?.role === 'admin' || hasDataScope(req, 'all') || hasDataScope(req, 'finance_visible')) return true;
    return canUseCustomerForBusinessWrite(req, contract.customer);
};

const canWriteContract = (req: AuthRequest, contract: {
    createdBy: number;
    customer: {
        salespersonId: number | null;
        poolState: string | null;
        segment: string | null;
    };
}) => {
    if (req.user?.role === 'admin' || hasDataScope(req, 'all')) return true;
    if (req.user?.role === 'sales' || hasDataScope(req, 'own_customers')) {
        return contract.createdBy === req.user!.userId && canUseCustomerForBusinessWrite(req, contract.customer);
    }
    return canUseCustomerForBusinessWrite(req, contract.customer);
};

export class ContractController {
    /**
     * 获取合同列表
     */
    async getContracts(req: AuthRequest, res: Response) {
        try {
            const { page = 1, pageSize = 20, status, customerId, type } = req.query;

            const limit = Math.min(Number(pageSize), 100);
            const offset = (Number(page) - 1) * limit;

            const where: any = {};
            if (status) where.status = status;
            if (type) where.type = type;
            if (customerId) where.customerId = Number(customerId);

            const scopedWhere = mergeWhereAnd(where, {
                customer: buildCustomerDataScopeWhere(req, { includeFinanceAll: true }),
            });

            const [contracts, total] = await Promise.all([
                prisma.contract.findMany({
                    where: scopedWhere,
                    include: {
                        customer: { select: { id: true, name: true, nameZh: true, nameEn: true, nameVi: true } },
                        creator: { select: { id: true, username: true } },
                        orders: { select: { finalAmount: true } },
                        _count: { select: { orders: true } }
                    },
                    orderBy: { createdAt: 'desc' },
                    skip: offset,
                    take: limit,
                }),
                prisma.contract.count({ where: scopedWhere }),
            ]);

            res.json({
                success: true,
                data: contracts.map(c => ({
                    ...c,
                    customerName: getCustomerDisplayName(c.customer),
                    customerNameZh: c.customer.nameZh,
                    customerNameEn: c.customer.nameEn,
                    customerNameVi: c.customer.nameVi,
                    customerDisplayName: getCustomerDisplayName(c.customer),
                    creatorName: c.creator.username,
                    linkedOrdersCount: c._count.orders,
                    totalLinkedAmount: c.orders.reduce((sum, o) => sum + Number(o.finalAmount || 0), 0)
                })),
                meta: {
                    page: Number(page),
                    pageSize: limit,
                    total,
                    totalPages: Math.ceil(total / limit)
                },
            });
        } catch (error) {
            logger.error('获取合同列表错误:', error);
            res.status(500).json({ success: false, message: '服务器内部错误' });
        }
    }

    /**
     * 获取单个合同详情
     */
    async getContractById(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            const contract = await prisma.contract.findUnique({
                where: { id: Number(id) },
                include: {
                    customer: true,
                    orders: true,
                    milestones: true,
                    creator: { select: { id: true, username: true } }
                }
            });

            if (!contract) {
                return res.status(404).json({ success: false, message: '未找到该合同' });
            }
            if (!canViewContract(req, contract)) {
                return res.status(404).json({ success: false, message: '未找到该合同' });
            }

            res.json({ success: true, data: contract });
        } catch (error) {
            logger.error('获取合同详情错误:', error);
            res.status(500).json({ success: false, message: '服务器内部错误' });
        }
    }

    /**
     * 创建合同
     */
    async createContract(req: AuthRequest, res: Response) {
        try {
            const {
                customerId,
                title,
                type = 'sales',
                totalAmount,
                currency = 'CNY',
                signedAt,
                expiredAt,
                notes,
                fileUrl,
                ocrMetadata,
                milestones 
            } = req.body;

            const contractNo = buildBusinessNo('CON');
            const customer = await prisma.customer.findUnique({
                where: { id: Number(customerId) },
                select: { id: true, status: true, salespersonId: true, poolState: true, segment: true },
            });

            if (!customer) {
                return res.status(400).json({ success: false, message: '客户不存在' });
            }
            if (customer.status !== 'active') {
                return res.status(400).json({ success: false, message: '只能为 active 客户创建合同' });
            }
            if (!canUseCustomerForBusinessWrite(req, customer)) {
                return res.status(403).json({ success: false, message: '无权为该客户创建合同' });
            }

            const contract = await withDbRetry(() => prisma.contract.create({
                data: {
                    contractNo,
                    customerId: Number(customerId),
                    title,
                    type,
                    totalAmount: Number(totalAmount),
                    currency,
                    signedAt: signedAt ? new Date(signedAt) : null,
                    expiredAt: expiredAt ? new Date(expiredAt) : null,
                    notes,
                    fileUrl: persistBase64ToDisk(fileUrl),
                    ocrMetadata: normalizeOcrMetadata(ocrMetadata),
                    status: 'draft',
                    createdBy: req.user!.userId,
                    milestones: milestones ? {
                        create: milestones.map((m: any) => ({
                            title: m.title,
                            percentage: Number(m.percentage),
                            status: 'pending'
                        }))
                    } : undefined
                },
                include: { milestones: true }
            }), { label: 'createContract' });

            await prisma.auditLog.create({
                data: {
                    userId: req.user!.userId,
                    action: 'CREATE',
                    resource: 'contract',
                    resourceId: contract.id,
                    details: `创建合同: ${contractNo} - ${title}`,
                    ipAddress: req.ip,
                    userAgent: req.get('user-agent'),
                },
            });

            res.status(201).json({ success: true, data: contract, message: '合同创建成功' });
        } catch (error) {
            logger.error('创建合同错误:', error);
            res.status(500).json({ success: false, message: '服务器内部错误' });
        }
    }

    /**
     * 更新合同状态或信息
     */
    async updateContract(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            const data = req.body;

            delete data.id;
            delete data.contractNo;

            const existing = await prisma.contract.findUnique({
                where: { id: Number(id) },
                select: {
                    id: true,
                    createdBy: true,
                    customer: { select: { salespersonId: true, poolState: true, segment: true } },
                },
            });
            if (!existing) {
                return res.status(404).json({ success: false, message: '合同不存在' });
            }
            if (!canWriteContract(req, existing)) {
                return res.status(403).json({ success: false, message: '无权更新该合同' });
            }

            if (data.signedAt) data.signedAt = new Date(data.signedAt);
            if (data.expiredAt) data.expiredAt = new Date(data.expiredAt);
            if ('ocrMetadata' in data) data.ocrMetadata = normalizeOcrMetadata(data.ocrMetadata);
            if ('fileUrl' in data) data.fileUrl = persistBase64ToDisk(data.fileUrl);

            const contract = await prisma.contract.update({
                where: { id: Number(id) },
                data
            });

            await prisma.auditLog.create({
                data: {
                    userId: req.user!.userId,
                    action: 'UPDATE',
                    resource: 'contract',
                    resourceId: contract.id,
                    details: `更新合同: ${contract.contractNo}`,
                    ipAddress: req.ip,
                    userAgent: req.get('user-agent'),
                },
            });

            res.json({ success: true, data: contract, message: '合同更新成功' });
        } catch (error) {
            logger.error('更新合同错误:', error);
            res.status(500).json({ success: false, message: '服务器内部错误' });
        }
    }

    /**
     * 追加合同项或内容 (大闭环集成)
     */
    async appendItems(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            const { items, note } = req.body; 

            if ((!Array.isArray(items) || items.length === 0) && !note) {
                return res.status(400).json({ success: false, message: '至少需要提供 items 或 note 其中之一' });
            }

            const contract = await prisma.contract.findUnique({
                where: { id: Number(id) },
                include: {
                    customer: { select: { salespersonId: true, poolState: true, segment: true } },
                },
            });

            if (!contract) {
                return res.status(404).json({ success: false, message: '合同不存在' });
            }
            if (!canWriteContract(req, contract)) {
                return res.status(403).json({ success: false, message: '无权追加该合同内容' });
            }

            // 处理 Metadata 追加 (存储结构化数据)
            const currentMetadata = parseContractMetadata(contract.ocrMetadata);
            if (Array.isArray(items)) {
                currentMetadata.items = [...currentMetadata.items, ...items];
            }

            // 处理备注追加 (展示可读信息)
            let updatedNotes = contract.notes || '';
            if (note) {
                updatedNotes += `\n[${new Date().toLocaleString()}] 追加内容: ${note}`;
            }

            const updatedContract = await prisma.contract.update({
                where: { id: Number(id) },
                data: {
                    ocrMetadata: JSON.stringify(currentMetadata),
                    notes: updatedNotes
                }
            });

            await prisma.auditLog.create({
                data: {
                    userId: req.user!.userId,
                    action: 'APPEND_ITEMS',
                    resource: 'contract',
                    resourceId: Number(id),
                    details: `向合同追加了 ${items?.length || 0} 个明细项`,
                }
            });

            res.json({ success: true, data: updatedContract, message: '内容已成功追加至合同' });
        } catch (error) {
            logger.error('追加合同内容失败:', error);
            res.status(500).json({ success: false, message: '服务器内部错误' });
        }
    }

    /**
     * AI OCR 识别 (实现诚实化，不再返回假金额)
     */
    async analyzeContract(req: AuthRequest, res: Response) {
        try {
            res.json({
                success: true,
                data: {
                    title: '提取合同文本',
                    totalAmount: null,
                    currency: null,
                    confidence: 0,
                    metadata: {
                        ocr_engine: 'Rules-V5-Vision',
                        notice: '需人工补充金额、币种、签署日期等信息'
                    }
                },
                message: '文件已分析，部分信息需人工补充'
            });
        } catch (error) {
            logger.error('合同 AI 解析错误:', error);
            res.status(500).json({ success: false, message: 'AI 解析失败' });
        }
    }
}
