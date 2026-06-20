import prisma from '../../config/database';
import { AuthRequest } from '../../middleware/auth';
import type { Prisma } from '@prisma/client';
import type { DataScope } from '../../permissions/permissionRegistry';
import { getDataScopesForRole } from '../../services/authorization-policy.service';
import { CustomerSegment } from './customer.types';
import { normalizePoolState } from './customer.payload';

type CustomerAccessTarget = {
  poolState?: string | null;
  salespersonId?: number | null;
};

export function hasDataScope(req: AuthRequest, scope: DataScope) {
  return Array.isArray(req.user?.dataScopes) && req.user.dataScopes.includes(scope);
}

function emptyCustomerAccessClause(): Prisma.CustomerWhereInput {
  return { id: -1 };
}

function getCustomerAccessClause(req: AuthRequest): Prisma.CustomerWhereInput {
  const segment = req.user?.segment;
  const normalizedSegment = segment === 'direct' || segment === 'channel' || segment === 'mixed'
    ? segment
    : null;

  if (req.user?.role === 'sales') {
    const publicClause: Prisma.CustomerWhereInput = { poolState: 'public' };
    if (normalizedSegment && normalizedSegment !== 'mixed') {
      publicClause.segment = { in: [normalizedSegment, 'mixed'] };
    }

    return {
      OR: [
        {
          poolState: 'private',
          salespersonId: req.user.userId,
        },
        publicClause,
      ],
    };
  }

  if (req.user?.role === 'manager') {
    return normalizedSegment && normalizedSegment !== 'mixed'
      ? { segment: { in: [normalizedSegment, 'mixed'] } }
      : {};
  }

  if (hasDataScope(req, 'all')) {
    return {};
  }

  const clauses: Prisma.CustomerWhereInput[] = [];
  if (hasDataScope(req, 'own_customers') && req.user?.userId) {
    clauses.push({
      poolState: 'private',
      salespersonId: req.user.userId,
    });
  }

  if (hasDataScope(req, 'team_customers')) {
    clauses.push(normalizedSegment && normalizedSegment !== 'mixed'
      ? { segment: { in: [normalizedSegment, 'mixed'] } }
      : {});
  }

  if (clauses.length === 0) {
    return emptyCustomerAccessClause();
  }

  if (clauses.some(clause => Object.keys(clause).length === 0)) {
    return {};
  }

  return clauses.length === 1 ? clauses[0] : { OR: clauses };
}

function getCustomerExportAccessClause(req: AuthRequest): Prisma.CustomerWhereInput {
  if (req.user?.role === 'sales') {
    return {
      poolState: 'private',
      salespersonId: req.user.userId,
    };
  }

  if (!['admin', 'manager'].includes(req.user?.role || '') && hasDataScope(req, 'own_customers') && req.user?.userId) {
    return {
      poolState: 'private',
      salespersonId: req.user.userId,
    };
  }

  return getCustomerAccessClause(req);
}

function buildCustomerWhereFromAccess(
  accessClause: Prisma.CustomerWhereInput,
  extra: Prisma.CustomerWhereInput = {},
): Prisma.CustomerWhereInput {
  const clauses: Prisma.CustomerWhereInput[] = [];

  if (Object.keys(accessClause).length > 0) {
    clauses.push(accessClause);
  }

  if (Object.keys(extra).length > 0) {
    clauses.push(extra);
  }

  if (clauses.length === 0) {
    return {};
  }

  if (clauses.length === 1) {
    return clauses[0];
  }

  return { AND: clauses };
}

export function buildCustomerWhere(req: AuthRequest, extra: Prisma.CustomerWhereInput = {}) {
  return buildCustomerWhereFromAccess(getCustomerAccessClause(req), extra);
}

export function buildCustomerExportWhere(req: AuthRequest, extra: Prisma.CustomerWhereInput = {}) {
  return buildCustomerWhereFromAccess(getCustomerExportAccessClause(req), extra);
}

export function isOwnCustomerOperator(req: AuthRequest) {
  return req.user?.role === 'sales'
    || (
      hasDataScope(req, 'own_customers')
      && !hasDataScope(req, 'team_customers')
      && !hasDataScope(req, 'all')
    );
}

function isAssignedPrivateCustomer(req: AuthRequest, customer: CustomerAccessTarget) {
  return normalizePoolState(customer) === 'private'
    && Number(customer.salespersonId || 0) === Number(req.user?.userId || 0);
}

export function getNormalizedUserSegment(req: AuthRequest): CustomerSegment | null {
  const segment = req.user?.segment;
  return segment === 'direct' || segment === 'channel' || segment === 'mixed'
    ? segment
    : null;
}

export function resolveWritableSegment(req: AuthRequest, requestedSegment?: unknown, fallbackSegment: CustomerSegment = 'mixed') {
  const normalizedUserSegment = getNormalizedUserSegment(req);
  const normalizedRequestedSegment = requestedSegment === 'direct' || requestedSegment === 'channel' || requestedSegment === 'mixed'
    ? requestedSegment
    : null;

  if (isOwnCustomerOperator(req)) {
    return {
      ok: true as const,
      segment: normalizedUserSegment || 'direct',
    };
  }

  if (req.user?.role === 'manager' && normalizedUserSegment && normalizedUserSegment !== 'mixed') {
    const nextSegment = normalizedRequestedSegment || normalizedUserSegment;
    if (nextSegment !== normalizedUserSegment) {
      return {
        ok: false as const,
        message: '经理只能维护自己业务线的客户',
      };
    }

    return {
      ok: true as const,
      segment: normalizedUserSegment,
    };
  }

  return {
    ok: true as const,
    segment: normalizedRequestedSegment || normalizedUserSegment || fallbackSegment,
  };
}

export function canEditCustomerProfile(req: AuthRequest, customer: CustomerAccessTarget) {
  if (req.user?.role === 'admin' || req.user?.role === 'manager') {
    return true;
  }

  if (hasDataScope(req, 'all') || hasDataScope(req, 'team_customers')) {
    return true;
  }

  if (hasDataScope(req, 'own_customers') || req.user?.role === 'sales') {
    return isAssignedPrivateCustomer(req, customer);
  }

  return false;
}

export function canViewCustomerSensitiveRelations(req: AuthRequest, customer: CustomerAccessTarget) {
  if (req.user?.role === 'admin' || req.user?.role === 'manager') {
    return true;
  }

  if (hasDataScope(req, 'all') || hasDataScope(req, 'team_customers')) {
    return true;
  }

  if (hasDataScope(req, 'own_customers') || req.user?.role === 'sales') {
    return isAssignedPrivateCustomer(req, customer);
  }

  return false;
}

export function canCreateCustomer(req: AuthRequest) {
  return Boolean(req.user);
}

export function canImportCustomer(req: AuthRequest) {
  return Boolean(req.user);
}

export function canManageCustomerPool(req: AuthRequest) {
  return Boolean(req.user);
}

function isSegmentAssignmentCompatible(customerSegment: CustomerSegment, salespersonSegment: CustomerSegment | null) {
  if (!salespersonSegment || salespersonSegment === 'mixed') return true;
  if (customerSegment === 'mixed') return true;
  return customerSegment === salespersonSegment;
}

export async function validateAssignedSalesperson(salespersonId: number, customerSegment: CustomerSegment) {
  const salesperson = await prisma.user.findUnique({
    where: { id: salespersonId },
    select: {
      id: true,
      role: true,
      segment: true,
      isActive: true,
    },
  });

  if (!salesperson || !salesperson.isActive) {
    return {
      ok: false as const,
      message: '指定的销售负责人不存在或已停用',
    };
  }

  const salespersonScopes = await getDataScopesForRole(salesperson.role);
  const canOwnCustomers = salesperson.role === 'sales' || salespersonScopes.includes('own_customers');
  if (!canOwnCustomers) {
    return {
      ok: false as const,
      message: '私海客户只能分配给销售或具备自有客户范围的角色',
    };
  }

  const salespersonSegment = salesperson.segment === 'direct' || salesperson.segment === 'channel' || salesperson.segment === 'mixed'
    ? salesperson.segment
    : null;

  if (!isSegmentAssignmentCompatible(customerSegment, salespersonSegment)) {
    return {
      ok: false as const,
      message: '客户业务线与销售负责人业务线不匹配',
    };
  }

  return {
    ok: true as const,
  };
}
