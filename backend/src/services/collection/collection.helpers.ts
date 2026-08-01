import { AuthRequest } from '../../middleware/auth';
import {
    buildCustomerDataScopeWhere,
    buildOrderDataScopeWhere,
    buildPaymentDataScopeWhere,
    mergeWhereAnd,
} from '../../utils/recordAccess';
import { compareMoney, maxMoney, subtractMoney } from '../../utils/money';

export const COLLECTION_DAY_MS = 24 * 60 * 60 * 1000;
export const COLLECTION_DEFAULT_PAGE_SIZE = 20;
export const COLLECTION_MAX_PAGE_SIZE = 100;
export const COLLECTION_DUE_SOON_DAYS = 7;

export type AgingBucketKey = 'current' | '1_7' | '8_15' | '16_30' | '31_60' | '60_plus';

export interface CollectionActionPlan {
    level: number;
    label: string;
    nextAction: string;
    channel: string;
    holdRecommended: boolean;
}

export const getEffectiveReceivableAmount = (finalAmount: number, receivableAdjustmentAmount = 0) =>
    maxMoney(0, subtractMoney(finalAmount, receivableAdjustmentAmount));

export const getOutstandingAmount = (finalAmount: number, paidAmount: number, receivableAdjustmentAmount = 0) =>
    maxMoney(0, subtractMoney(getEffectiveReceivableAmount(finalAmount, receivableAdjustmentAmount), paidAmount));

export const determineReceivablePaymentStatus = (
    paidAmount: number,
    finalAmount: number,
    receivableAdjustmentAmount = 0,
) => {
    const effectiveReceivable = getEffectiveReceivableAmount(finalAmount, receivableAdjustmentAmount);
    if (compareMoney(paidAmount, effectiveReceivable) >= 0) return 'paid';
    if (compareMoney(paidAmount, 0) > 0) return 'partial';
    return 'unpaid';
};

export const getDueDate = (createdAt: Date, paymentTerms: number) =>
    new Date(createdAt.getTime() + Number(paymentTerms || 0) * COLLECTION_DAY_MS);

export const isOverdue = (
    createdAt: Date,
    paymentTerms: number,
    finalAmount: number,
    paidAmount: number,
    receivableAdjustmentAmount = 0,
    now = new Date(),
) => {
    const outstanding = getOutstandingAmount(finalAmount, paidAmount, receivableAdjustmentAmount);
    if (outstanding <= 0) {
        return false;
    }

    return getDueDate(createdAt, paymentTerms).getTime() < now.getTime();
};

export const buildOrderWhere = (req: AuthRequest, extra: Record<string, any> = {}) => {
    return mergeWhereAnd(
        { status: { not: 'cancelled' } },
        extra,
        buildOrderDataScopeWhere(req, { includeFinanceAll: true }),
    );
};

export const buildPaymentWhere = (req: AuthRequest, extra: Record<string, any> = {}) => {
    return mergeWhereAnd(
        extra,
        buildPaymentDataScopeWhere(req, { includeFinanceAll: true }),
    );
};

export const buildPromiseWhere = (req: AuthRequest, extra: Record<string, any> = {}) => {
    const customerWhere = buildCustomerDataScopeWhere(req, { includeFinanceAll: true });
    return mergeWhereAnd(
        extra,
        Object.keys(customerWhere).length > 0 ? { customer: customerWhere } : {},
    );
};

export const buildDisputeWhere = (req: AuthRequest, extra: Record<string, any> = {}) => {
    const customerWhere = buildCustomerDataScopeWhere(req, { includeFinanceAll: true });
    return mergeWhereAnd(
        extra,
        Object.keys(customerWhere).length > 0 ? { customer: customerWhere } : {},
    );
};

export const getOverdueDays = (createdAt: Date, paymentTerms: number, now = new Date()) => {
    const dueDate = getDueDate(createdAt, paymentTerms);
    return Math.max(0, Math.ceil((now.getTime() - dueDate.getTime()) / COLLECTION_DAY_MS));
};

export const getAgingBucket = (daysOverdue: number): AgingBucketKey => {
    if (daysOverdue <= 0) return 'current';
    if (daysOverdue <= 7) return '1_7';
    if (daysOverdue <= 15) return '8_15';
    if (daysOverdue <= 30) return '16_30';
    if (daysOverdue <= 60) return '31_60';
    return '60_plus';
};

export const getDunningLevel = (daysOverdue: number) => {
    if (daysOverdue <= 0) return 0;
    if (daysOverdue <= 7) return 1;
    if (daysOverdue <= 15) return 2;
    if (daysOverdue <= 30) return 3;
    return 4;
};

export const getCollectionActionPlan = (daysOverdue: number): CollectionActionPlan => {
    const level = getDunningLevel(daysOverdue);

    if (level === 0) {
        return {
            level,
            label: '正常',
            nextAction: '无需追款，保持常规跟进',
            channel: 'none',
            holdRecommended: false,
        };
    }

    if (level === 1) {
        return {
            level,
            label: '轻提醒',
            nextAction: '发送友好提醒，确认预计付款日',
            channel: 'system_notice',
            holdRecommended: false,
        };
    }

    if (level === 2) {
        return {
            level,
            label: '电话/邮件',
            nextAction: '财务或销售进行电话/邮件跟进，记录承诺付款',
            channel: 'email_phone',
            holdRecommended: false,
        };
    }

    if (level === 3) {
        return {
            level,
            label: '经理升级',
            nextAction: '升级到经理，冻结新订单或收紧信用',
            channel: 'manager_escalation',
            holdRecommended: true,
        };
    }

    return {
        level,
        label: '法务/冻结',
        nextAction: '进入法务前置流程，暂停发货和新增授信',
        channel: 'legal_hold',
        holdRecommended: true,
    };
};
