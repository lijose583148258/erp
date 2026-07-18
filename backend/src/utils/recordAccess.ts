import { AuthRequest } from '../middleware/auth';
import { DataScope } from '../permissions/permissionRegistry';

export type CustomerScopedAccessRecord = {
    salespersonId: number | null;
    poolState: string | null;
    segment: string | null;
    status?: string | null;
};

export type OrderScopedAccessRecord = {
    createdBy?: number | null;
    customer?: CustomerScopedAccessRecord | null;
};

type ScopeOptions = {
    includeFinanceAll?: boolean;
    includeWarehouseAll?: boolean;
};

type OperationalScope = Extract<DataScope, 'finance_visible' | 'warehouse_visible' | 'procurement_visible'>;

export const hasDataScope = (req: AuthRequest, scope: string) =>
    Array.isArray(req.user?.dataScopes) && req.user.dataScopes.includes(scope as any);

export const getNormalizedUserSegment = (req: AuthRequest) => {
    const segment = req.user?.segment;
    return segment === 'direct' || segment === 'channel' || segment === 'mixed'
        ? segment
        : null;
};

export const mergeWhereAnd = (...clauses: Array<Record<string, any> | null | undefined>) => {
    const compact = clauses.filter((clause): clause is Record<string, any> => Boolean(clause) && Object.keys(clause || {}).length > 0);
    if (compact.length === 0) return {};
    if (compact.length === 1) return compact[0];
    return { AND: compact };
};

const emptyWhere = () => ({ id: -1 });

export const canUseOperationalDataScope = (req: AuthRequest, scope: OperationalScope) => (
    Boolean(req.user)
    && (
        req.user!.role === 'admin'
        || hasDataScope(req, 'all')
        || hasDataScope(req, scope)
    )
);

export const canUseAnyOperationalDataScope = (req: AuthRequest, scopes: OperationalScope[]) => (
    Boolean(req.user)
    && (
        req.user!.role === 'admin'
        || hasDataScope(req, 'all')
        || scopes.some((scope) => hasDataScope(req, scope))
    )
);

export const buildOperationalDataScopeWhere = (req: AuthRequest, scope: OperationalScope) => (
    canUseOperationalDataScope(req, scope) ? {} : emptyWhere()
);

export const buildCustomerDataScopeWhere = (req: AuthRequest, options: ScopeOptions = {}) => {
    if (!req.user) return emptyWhere();

    const segment = getNormalizedUserSegment(req);

    if (
        req.user.role === 'admin'
        || hasDataScope(req, 'all')
        || (options.includeFinanceAll && hasDataScope(req, 'finance_visible'))
        || (options.includeWarehouseAll && hasDataScope(req, 'warehouse_visible'))
    ) {
        return {};
    }

    if (req.user.role === 'manager' || hasDataScope(req, 'team_customers')) {
        return segment && segment !== 'mixed'
            ? { segment: { in: [segment, 'mixed'] } }
            : {};
    }

    if (req.user.role === 'sales' || hasDataScope(req, 'own_customers')) {
        return {
            poolState: 'private',
            salespersonId: req.user.userId,
        };
    }

    return emptyWhere();
};

export const buildOrderDataScopeWhere = (req: AuthRequest, options: ScopeOptions = {}) => {
    if (!req.user) return emptyWhere();

    if (
        req.user.role === 'admin'
        || hasDataScope(req, 'all')
        || (options.includeFinanceAll && hasDataScope(req, 'finance_visible'))
        || (options.includeWarehouseAll && hasDataScope(req, 'warehouse_visible'))
    ) {
        return {};
    }

    if (req.user.role === 'manager' || hasDataScope(req, 'team_customers')) {
        return {
            customer: buildCustomerDataScopeWhere(req),
        };
    }

    if (req.user.role === 'sales' || hasDataScope(req, 'own_customers')) {
        return {
            OR: [
                { createdBy: req.user.userId },
                { customer: buildCustomerDataScopeWhere(req) },
            ],
        };
    }

    return emptyWhere();
};

export const buildPaymentDataScopeWhere = (req: AuthRequest, options: ScopeOptions = {}) => {
    const orderWhere = buildOrderDataScopeWhere(req, options);
    return Object.keys(orderWhere).length > 0 ? { order: orderWhere } : {};
};

export const buildBarterDataScopeWhere = (req: AuthRequest) => {
    if (!req.user) return emptyWhere();

    if (canUseAnyOperationalDataScope(req, ['finance_visible', 'warehouse_visible', 'procurement_visible'])) {
        return {};
    }

    if (req.user.role === 'manager' || hasDataScope(req, 'team_customers')) {
        return {
            OR: [
                { customer: buildCustomerDataScopeWhere(req) },
                { order: buildOrderDataScopeWhere(req) },
            ],
        };
    }

    if (req.user.role === 'sales' || hasDataScope(req, 'own_customers')) {
        return {
            OR: [
                { createdBy: req.user.userId },
                { customer: buildCustomerDataScopeWhere(req) },
                { order: buildOrderDataScopeWhere(req) },
            ],
        };
    }

    return emptyWhere();
};

export const canUseCustomerForBusinessWrite = (req: AuthRequest, customer: CustomerScopedAccessRecord) => {
    if (!req.user) return false;
    if (req.user.role === 'admin' || hasDataScope(req, 'all')) return true;

    if (req.user.role === 'manager' || hasDataScope(req, 'team_customers')) {
        const userSegment = getNormalizedUserSegment(req) || 'mixed';
        return userSegment === 'mixed' || !customer.segment || customer.segment === 'mixed' || customer.segment === userSegment;
    }

    if (req.user.role === 'sales' || hasDataScope(req, 'own_customers')) {
        return customer.poolState === 'private' && customer.salespersonId === req.user.userId;
    }

    return false;
};

export const canUseOrderForBusinessWrite = (req: AuthRequest, order: OrderScopedAccessRecord) => {
    if (!req.user) return false;
    if (req.user.role === 'admin' || hasDataScope(req, 'all')) return true;

    if (req.user.role === 'manager' || hasDataScope(req, 'team_customers')) {
        return order.customer ? canUseCustomerForBusinessWrite(req, order.customer) : false;
    }

    if (req.user.role === 'sales' || hasDataScope(req, 'own_customers')) {
        return order.createdBy === req.user.userId || (order.customer ? canUseCustomerForBusinessWrite(req, order.customer) : false);
    }

    return false;
};

/**
 * Finance collection mutations intentionally have a wider data boundary than
 * core order lifecycle writes. A segmented built-in manager must still remain
 * inside their customer segment even though the role can view finance data.
 */
export const canUseOrderForCollectionWrite = (req: AuthRequest, order: OrderScopedAccessRecord) => {
    if (!req.user) return false;
    if (req.user.role !== 'manager' && hasDataScope(req, 'finance_visible')) return true;
    return canUseOrderForBusinessWrite(req, order);
};

export const canUseBarterRecord = (req: AuthRequest, record: {
    createdBy?: number | null;
    customer?: CustomerScopedAccessRecord | null;
    order?: OrderScopedAccessRecord | null;
}) => {
    if (!req.user) return false;
    if (canUseAnyOperationalDataScope(req, ['finance_visible', 'warehouse_visible', 'procurement_visible'])) return true;
    if (record.createdBy === req.user.userId) return true;
    if (record.customer && canUseCustomerForBusinessWrite(req, record.customer)) return true;
    if (record.order && canUseOrderForBusinessWrite(req, record.order)) return true;
    return false;
};

export const canSalesWriteOwnedRecord = (req: AuthRequest, record: { createdBy?: number | null; requestedBy?: number | null }) => {
    if (req.user?.role !== 'sales') return true;
    const ownerId = record.createdBy ?? record.requestedBy ?? null;
    return ownerId === req.user.userId;
};
