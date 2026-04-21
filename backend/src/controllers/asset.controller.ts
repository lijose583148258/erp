import { Response } from 'express';
import prisma from '../config/database';
import type { Prisma } from '@prisma/client';
import { logger } from '../utils/logger';
import { buildBusinessNo } from '../utils/businessNo';
import { withDbRetry } from '../utils/dbRetry';
import { AuthRequest } from '../middleware/auth';
import {
    buildCustomerDataScopeWhere,
    canUseAnyOperationalDataScope,
    canUseCustomerForBusinessWrite,
    canUseOperationalDataScope,
    mergeWhereAnd,
} from '../utils/recordAccess';

const getAssetStatusCode = (message: string) => {
    if (message.includes('不存在')) return 404;
    return 409;
};

const getCustomerDisplayName = (customer: {
    name?: string | null;
    nameZh?: string | null;
    nameEn?: string | null;
    nameVi?: string | null;
}) => customer.nameZh || customer.nameEn || customer.nameVi || customer.name || '';

const canViewAssetInventory = (req: AuthRequest) => canUseAnyOperationalDataScope(req, ['finance_visible', 'warehouse_visible']);
const canManageAssetInventory = (req: AuthRequest) => canUseOperationalDataScope(req, 'warehouse_visible');

type ProductBatchRequestBody = {
    batchNo?: unknown;
    productName?: unknown;
    productionDate?: unknown;
    expiryDate?: unknown;
    storageTemp?: unknown;
    isColdChain?: unknown;
    stockQuantity?: unknown;
    unit?: unknown;
    notes?: unknown;
};

const toOptionalText = (value: unknown) => (
    value === undefined || value === null ? undefined : String(value)
);

const buildAssetCustomerWhere = (req: AuthRequest, customerId: number | null) => {
    const customerScope = buildCustomerDataScopeWhere(req, { includeFinanceAll: true, includeWarehouseAll: true });
    return mergeWhereAnd(
        customerId ? { customerId } : undefined,
        Object.keys(customerScope).length > 0 ? { customer: customerScope } : undefined,
    );
};

const rejectAssetScope = (res: Response) => (
    res.status(403).json({ success: false, message: '当前角色未获得资产数据范围' })
);

export class AssetController {
    private async writeAuditLog(req: AuthRequest, action: string, resource: string, resourceId: number, details: string) {
        const userId = req.user?.userId;
        if (!userId) return;
        try {
            await prisma.auditLog.create({
                data: {
                    userId,
                    action,
                    resource,
                    resourceId,
                    details,
                    ipAddress: req.ip,
                    userAgent: req.get('user-agent'),
                }
            });
        } catch (error) {
            logger.error('Asset audit write failed:', error);
        }
    }

    async getBalances(req: AuthRequest, res: Response) {
        try {
            const customerId = req.params.id ? Number(req.params.id) : null;
            const balances = await prisma.assetBalance.findMany({
                where: buildAssetCustomerWhere(req, customerId),
                include: {
                    customer: {
                        select: {
                            name: true,
                            nameZh: true,
                            nameEn: true,
                            nameVi: true,
                        }
                    }
                },
                orderBy: {
                    updatedAt: 'desc'
                }
            });

            res.json({
                success: true,
                data: balances.map(b => ({
                    id: b.id,
                    customerId: b.customerId,
                    customerName: b.customer.name,
                    customerNameZh: b.customer.nameZh,
                    customerNameEn: b.customer.nameEn,
                    customerNameVi: b.customer.nameVi,
                    customerDisplayName: getCustomerDisplayName(b.customer),
                    assetType: b.assetType,
                    balance: Number(b.balance),
                    updatedAt: b.updatedAt.toISOString()
                }))
            });
        } catch (error) {
            logger.error('Get asset balances error:', error);
            res.status(500).json({ success: false, message: '获取资产余额失败' });
        }
    }

    async getCustomerBalances(req: AuthRequest, res: Response) {
        return this.getBalances(req, res);
    }

    async getSummaries(req: AuthRequest, res: Response) {
        return this.getBalances(req, res);
    }

    async getHistory(req: AuthRequest, res: Response) {
        try {
            const customerScope = buildCustomerDataScopeWhere(req, { includeFinanceAll: true, includeWarehouseAll: true });
            const history = await prisma.assetTransaction.findMany({
                where: Object.keys(customerScope).length > 0 ? { customer: customerScope } : undefined,
                include: {
                    customer: {
                        select: {
                            name: true,
                            nameZh: true,
                            nameEn: true,
                            nameVi: true,
                        }
                    },
                    creator: {
                        select: {
                            username: true,
                        }
                    }
                },
                orderBy: { createdAt: 'desc' }
            });

            res.json({
                success: true,
                data: history.map(t => ({
                    id: t.id,
                    customerId: t.customerId,
                    customerName: t.customer.name,
                    customerNameZh: t.customer.nameZh,
                    customerNameEn: t.customer.nameEn,
                    customerNameVi: t.customer.nameVi,
                    customerDisplayName: getCustomerDisplayName(t.customer),
                    assetType: t.assetType,
                    quantity: Number(t.quantity),
                    action: t.action === 'return' ? 'inbound' : 'outbound',
                    note: t.note,
                    createdBy: t.createdBy,
                    createdByName: t.creator?.username || undefined,
                    createdAt: t.createdAt.toISOString()
                }))
            });
        } catch (error) {
            logger.error('Get asset history error:', error);
            res.status(500).json({ success: false, message: '获取资产历史失败' });
        }
    }

    async getTransactions(req: AuthRequest, res: Response) {
        return this.getHistory(req, res);
    }

    async createTransaction(req: AuthRequest, res: Response) {
        try {
            const { customerId, assetType, type, quantity, action, note } = req.body;
            const resolvedType = assetType || type;
            const userId = req.user?.userId;

            if (!customerId || !resolvedType || !quantity || !action) {
                return res.status(400).json({ success: false, message: '缺少必要参数' });
            }

            const customer = await prisma.customer.findUnique({
                where: { id: Number(customerId) },
                select: { id: true, salespersonId: true, poolState: true, segment: true, status: true },
            });
            if (!customer) {
                return res.status(404).json({ success: false, message: '客户不存在' });
            }
            if (!canManageAssetInventory(req) && !canUseCustomerForBusinessWrite(req, customer)) {
                return rejectAssetScope(res);
            }

            const result = await prisma.$transaction(async (tx) => {
                const existingBalance = await tx.assetBalance.findUnique({
                    where: { customerId_assetType: { customerId: Number(customerId), assetType: resolvedType } },
                    select: { balance: true }
                });

                if (action === 'inbound' && Number(existingBalance?.balance || 0) < Number(quantity)) {
                    throw new Error('归还数量不能超过当前客户占用数量');
                }

                const transaction = await tx.assetTransaction.create({
                    data: {
                        customerId: Number(customerId),
                        assetType: resolvedType,
                        quantity: Number(quantity),
                        action: action === 'inbound' ? 'return' : 'outbound',
                        note,
                        createdBy: userId || 1,
                    }
                });

                const change = action === 'outbound' ? Number(quantity) : -Number(quantity);

                await tx.assetBalance.upsert({
                    where: { customerId_assetType: { customerId: Number(customerId), assetType: resolvedType } },
                    update: { balance: { increment: change } },
                    create: { customerId: Number(customerId), assetType: resolvedType, balance: change }
                });

                return transaction;
            });

            await this.writeAuditLog(req, 'CREATE', 'asset_transaction', result.id, JSON.stringify({
                customerId: Number(customerId),
                assetType: resolvedType,
                quantity: Number(quantity),
                action,
            }));

            res.json({ success: true, data: result });
        } catch (error) {
            logger.error('Create asset transaction error:', error);
            const message = error instanceof Error ? error.message : '创建资产记录失败';
            res.status(error instanceof Error ? getAssetStatusCode(message) : 500).json({ success: false, message });
        }
    }

    async getBatches(req: AuthRequest, res: Response) {
        try {
            if (!canViewAssetInventory(req)) {
                return res.json({ success: true, data: [] });
            }

            const { status, keyword } = req.query;

            const where: Prisma.ProductBatchWhereInput = {};
            if (keyword) {
                where.OR = [
                    { batchNo: { contains: String(keyword) } },
                    { productName: { contains: String(keyword) } }
                ];
            }

            const batches = await prisma.productBatch.findMany({
                where,
                orderBy: { expiryDate: 'asc' }
            });

            const now = new Date();
            const data = batches.map(b => {
                const remainingDays = Math.ceil((b.expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                const statusLabel = remainingDays < 0 ? 'expired' : remainingDays <= 30 ? 'expiring' : 'healthy';
                return {
                    ...b,
                    stockQuantity: Number(b.stockQuantity),
                    remainingDays,
                    status: statusLabel
                };
            }).filter(b => {
                if (!status) return true;
                return b.status === status;
            });

            res.json({ success: true, data });
        } catch (error) {
            logger.error('Get product batches error:', error);
            res.status(500).json({ success: false, message: '获取批次数据失败' });
        }
    }

    async createBatch(req: AuthRequest, res: Response) {
        try {
            if (!canManageAssetInventory(req)) {
                return rejectAssetScope(res);
            }

            const { batchNo, productName, productionDate, expiryDate, storageTemp, isColdChain, stockQuantity, unit, notes } = req.body as ProductBatchRequestBody;

            if (!productName || !productionDate || !expiryDate || stockQuantity === undefined || !unit) {
                return res.status(400).json({ success: false, message: '缺少必要参数' });
            }

            if (new Date(String(expiryDate)).getTime() < new Date(String(productionDate)).getTime()) {
                return res.status(409).json({ success: false, message: '到期日期不能早于生产日期' });
            }

            const resolvedBatchNo = toOptionalText(batchNo) || buildBusinessNo('BATCH');

            const created = await withDbRetry(() => prisma.productBatch.create({
                data: {
                    batchNo: resolvedBatchNo,
                    productName: String(productName),
                    productionDate: new Date(String(productionDate)),
                    expiryDate: new Date(String(expiryDate)),
                    storageTemp: toOptionalText(storageTemp),
                    isColdChain: Boolean(isColdChain),
                    stockQuantity: Number(stockQuantity),
                    unit: String(unit),
                    notes: toOptionalText(notes)
                }
            }), { label: 'createBatch' });

            await this.writeAuditLog(req, 'CREATE', 'product_batch', created.id, JSON.stringify({
                batchNo: created.batchNo,
                productName,
                stockQuantity: Number(stockQuantity),
            }));

            res.status(201).json({ success: true, data: created });
        } catch (error) {
            logger.error('Create product batch error:', error);
            const message = error instanceof Error ? error.message : '创建批次失败';
            res.status(error instanceof Error ? getAssetStatusCode(message) : 500).json({ success: false, message });
        }
    }

    async updateBatch(req: AuthRequest, res: Response) {
        try {
            if (!canManageAssetInventory(req)) {
                return rejectAssetScope(res);
            }

            const { id } = req.params;
            const { productName, productionDate, expiryDate, storageTemp, isColdChain, stockQuantity, unit, notes } = req.body as ProductBatchRequestBody;

            const existing = await prisma.productBatch.findUnique({
                where: { id: Number(id) }
            });

            if (!existing) {
                return res.status(404).json({ success: false, message: '批次不存在' });
            }

            const updateData: Prisma.ProductBatchUpdateInput = {};
            const nextProductionDate = productionDate !== undefined ? new Date(String(productionDate)) : existing.productionDate;
            const nextExpiryDate = expiryDate !== undefined ? new Date(String(expiryDate)) : existing.expiryDate;
            if (productName !== undefined) updateData.productName = String(productName);
            if (productionDate !== undefined) updateData.productionDate = nextProductionDate;
            if (expiryDate !== undefined) updateData.expiryDate = nextExpiryDate;
            if (storageTemp !== undefined) updateData.storageTemp = toOptionalText(storageTemp);
            if (isColdChain !== undefined) updateData.isColdChain = Boolean(isColdChain);
            if (stockQuantity !== undefined) updateData.stockQuantity = Number(stockQuantity);
            if (unit !== undefined) updateData.unit = String(unit);
            if (notes !== undefined) updateData.notes = toOptionalText(notes);

            if (new Date(nextExpiryDate).getTime() < new Date(nextProductionDate).getTime()) {
                return res.status(409).json({ success: false, message: '到期日期不能早于生产日期' });
            }

            const updated = await prisma.productBatch.update({
                where: { id: Number(id) },
                data: updateData
            });

            await this.writeAuditLog(req, 'UPDATE', 'product_batch', updated.id, JSON.stringify({
                batchNo: updated.batchNo,
                changedFields: Object.keys(updateData),
                previousStockQuantity: Number(existing.stockQuantity),
                currentStockQuantity: Number(updated.stockQuantity),
            }));

            res.json({ success: true, data: updated });
        } catch (error) {
            logger.error('Update product batch error:', error);
            const message = error instanceof Error ? error.message : '更新批次失败';
            res.status(error instanceof Error ? getAssetStatusCode(message) : 500).json({ success: false, message });
        }
    }

    async deleteBatch(req: AuthRequest, res: Response) {
        try {
            if (!canManageAssetInventory(req)) {
                return rejectAssetScope(res);
            }

            const { id } = req.params;
            const existing = await prisma.productBatch.findUnique({
                where: { id: Number(id) }
            });

            if (!existing) {
                return res.status(404).json({ success: false, message: '批次不存在' });
            }

            if (Number(existing.stockQuantity) > 0) {
                return res.status(409).json({ success: false, message: '批次仍有库存，不能直接删除' });
            }

            await prisma.productBatch.delete({ where: { id: Number(id) } });
            await this.writeAuditLog(req, 'DELETE', 'product_batch', Number(id), JSON.stringify({
                batchNo: existing.batchNo,
                productName: existing.productName,
            }));
            res.json({ success: true });
        } catch (error) {
            logger.error('Delete product batch error:', error);
            const message = error instanceof Error ? error.message : '删除批次失败';
            res.status(error instanceof Error ? getAssetStatusCode(message) : 500).json({ success: false, message });
        }
    }
}
