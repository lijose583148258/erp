import prisma from '../../config/database';
import { AuthRequest } from '../../middleware/auth';
import { AdjustmentDomain } from '../../services/adjustment.service';
import { hasDataScope } from '../../utils/recordAccess';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export const toNumber = (value: unknown): number | null => {
    if (value === undefined || value === null || value === '') {
        return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

export const defaultReasonCategory = (domain: string) => {
    if (domain === 'finance') {
        return 'manual_reconciliation';
    }

    if (domain === 'production') {
        return 'production_loss';
    }

    return 'inventory_discrepancy';
};

const getAccessibleAdjustmentDomains = (req: AuthRequest): AdjustmentDomain[] | null => {
    if (!req.user) return [];
    if (req.user.role === 'admin' || hasDataScope(req, 'all')) return null;

    const domains = new Set<AdjustmentDomain>();
    if (hasDataScope(req, 'finance_visible')) {
        domains.add('finance');
    }
    if (hasDataScope(req, 'warehouse_visible')) {
        domains.add('production');
        domains.add('inventory');
    }
    return Array.from(domains);
};

export const buildAdjustmentWhere = (req: AuthRequest, extra: Record<string, any> = {}) => {
    const where: Record<string, any> = {
        ...extra,
    };

    const domains = getAccessibleAdjustmentDomains(req);
    if (domains !== null) {
        if (domains.length === 0) {
            where.id = -1;
            return where;
        }

        const requestedDomain = typeof where.domain === 'string' ? where.domain : null;
        if (requestedDomain && !domains.includes(requestedDomain as AdjustmentDomain)) {
            where.id = -1;
            return where;
        }
        where.domain = requestedDomain || { in: domains };
    }

    return where;
};

export const canOperateAdjustmentDomain = (req: AuthRequest, domain: string) => {
    const domains = getAccessibleAdjustmentDomains(req);
    return domains === null || domains.includes(domain as AdjustmentDomain);
};

const getCustomerDisplayName = (customer?: {
    name?: string | null;
    nameZh?: string | null;
    nameEn?: string | null;
    nameVi?: string | null;
}) => customer?.nameZh || customer?.nameEn || customer?.nameVi || customer?.name || null;

function parseSnapshot(snapshot: string | null | undefined) {
    if (!snapshot) {
        return null;
    }

    try {
        return JSON.parse(snapshot);
    } catch {
        return snapshot;
    }
}

export const formatAdjustment = (record: any) => ({
    id: record.id,
    adjustmentNo: record.adjustmentNo,
    domain: record.domain,
    targetType: record.targetType,
    targetId: record.targetId,
    targetRef: record.targetRef,
    orderId: record.orderId,
    orderNo: record.order?.orderNo || null,
    batchId: record.batchId,
    batchNo: record.productBatch?.batchNo || null,
    productName: record.productBatch?.productName || record.order?.productName || null,
    customerId: record.customerId || record.order?.customer?.id || null,
    customerName: getCustomerDisplayName(record.order?.customer),
    customerNameZh: record.order?.customer?.nameZh || null,
    customerNameEn: record.order?.customer?.nameEn || null,
    customerNameVi: record.order?.customer?.nameVi || null,
    customerDisplayName: getCustomerDisplayName(record.order?.customer),
    quantityDelta: record.quantityDelta !== null ? Number(record.quantityDelta) : null,
    amountDelta: record.amountDelta !== null ? Number(record.amountDelta) : null,
    reason: record.reason,
    reasonCategory: record.reasonCategory || null,
    lossType: record.lossType || null,
    note: record.note,
    status: record.status,
    createdBy: record.createdBy,
    creator: record.creator ? {
        id: record.creator.id,
        username: record.creator.username,
        role: record.creator.role,
    } : null,
    approvedBy: record.approvedBy,
    approver: record.approver ? {
        id: record.approver.id,
        username: record.approver.username,
        role: record.approver.role,
    } : null,
    approvedAt: record.approvedAt,
    appliedAt: record.appliedAt,
    beforeSnapshot: parseSnapshot(record.beforeSnapshot),
    afterSnapshot: parseSnapshot(record.afterSnapshot),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
});

export const createAuditLog = async (
    req: AuthRequest,
    action: string,
    details: Record<string, unknown>,
    resourceId?: number | null,
) => {
    await prisma.auditLog.create({
        data: {
            userId: req.user!.userId,
            action,
            resource: 'adjustment',
            resourceId: resourceId ?? null,
            details: JSON.stringify(details),
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
        },
    });
};
