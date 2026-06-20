import type { AuthRequest } from '../middleware/auth';
import { casbinAllowsPermission } from '../permissions/casbinAuthorization';
import { getPermissionsForRole } from './authorization-policy.service';

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

export async function validateRolePolicyGrant(
    req: AuthRequest,
    targetRoleCode: string,
    permissions: string[],
    dataScopes: string[],
): Promise<string | null> {
    if (!req.user) return '未认证';
    if (req.user.role === 'admin') return null;
    if (targetRoleCode === 'admin') return '只有内置管理员可以修改管理员角色';

    const operatorPermissions = new Set(await getPermissionsForRole(req.user.role));
    const excessivePermission = permissions.find(permission => !operatorPermissions.has(permission as never));
    if (excessivePermission) {
        return `不能授予当前账号未拥有的权限: ${excessivePermission}`;
    }

    const operatorScopes = new Set(req.user.dataScopes || []);
    const excessiveScope = dataScopes.find(scope => !operatorScopes.has(scope as never));
    if (excessiveScope) {
        return `不能授予当前账号未拥有的数据范围: ${excessiveScope}`;
    }
    return null;
}
