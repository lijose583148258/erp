import type { AuthRequest } from '../middleware/auth';
import { casbinAllowsPermission } from '../permissions/casbinAuthorization';

export type UserSegment = 'direct' | 'channel' | 'mixed';

export const ROLE_ASSIGNMENT_PERMISSION = 'authorization.roles.manage';

export function resolveUserSegment(role: string, segment?: string | null): UserSegment {
    if (segment === 'direct' || segment === 'channel' || segment === 'mixed') {
        return segment;
    }

    if (role === 'sales') {
        return 'direct';
    }

    return 'mixed';
}

export function isRoleAssignmentChange(nextRole: string, previousRole?: string | null) {
    return previousRole === undefined ? nextRole !== 'sales' : previousRole !== nextRole;
}

export async function canAssignPrivilegedRoles(req: AuthRequest) {
    if (!req.user) return false;
    return casbinAllowsPermission(req.user.role, ROLE_ASSIGNMENT_PERMISSION);
}
