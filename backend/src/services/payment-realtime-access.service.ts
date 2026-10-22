import prisma from '../config/database';
import type { AuthRequest } from '../middleware/auth';
import { mergeWhereAnd, buildPaymentDataScopeWhere } from '../utils/recordAccess';
import { verifyToken } from '../utils/jwt';
import { withReadOnlyDbRetry } from '../utils/readOnlyDbRetry';
import { isTokenBlacklisted } from './auth-token-store.service';
import { getDataScopesForRole, getPermissionsForRole, roleExistsAndActive } from './authorization-policy.service';
import { resolveUserSegment } from './role-assignment-policy.service';

// Only durable payment hints use this check. No connection-lifetime permission
// cache: account, role, grants and record visibility may change while WS is open.
export async function canReadPaymentRealtime(token: string, paymentId: number): Promise<boolean> {
  if (!Number.isSafeInteger(paymentId) || paymentId <= 0) return false;
  let payload;
  try { payload = verifyToken(token); } catch { return false; }
  if (!Number.isSafeInteger(payload.userId) || payload.userId <= 0 || await isTokenBlacklisted(token)) return false;
  const user = await withReadOnlyDbRetry(() => prisma.user.findUnique({
    where: { id: payload.userId }, select: {
      id: true, username: true, role: true, segment: true, isActive: true, updatedAt: true, mustChangePassword: true,
    },
  }));
  if (!user?.isActive || user.mustChangePassword) return false;
  const issuedAt = payload.authAt || (payload.iat ? payload.iat * 1000 : 0);
  if (!Number.isFinite(issuedAt) || issuedAt <= 0 || issuedAt < user.updatedAt.getTime()) return false;
  const [active, permissions, dataScopes] = await Promise.all([
    roleExistsAndActive(user.role), getPermissionsForRole(user.role), getDataScopesForRole(user.role),
  ]);
  if (!active || !permissions.includes('collections.read')) return false;
  const req = { user: { userId: user.id, username: user.username, role: user.role,
    segment: resolveUserSegment(user.role, user.segment), dataScopes } } as AuthRequest;
  // Exactly the collection ledger's buildPaymentWhere(req, { id }) semantics,
  // without importing a controller or duplicating customer/segment rules.
  const where = mergeWhereAnd({ id: paymentId }, buildPaymentDataScopeWhere(req, { includeFinanceAll: true }));
  return Boolean(await withReadOnlyDbRetry(() => prisma.paymentRecord.findFirst({ where, select: { id: true } })));
}
