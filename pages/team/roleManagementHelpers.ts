import { AuthPermission, AuthRole, DataScopeCode } from '../../services/role.service';

export type RoleDraft = {
  code: string;
  name: string;
  description: string;
  isActive: boolean;
  dataScopes: DataScopeCode[];
  permissions: string[];
};

export type ChangeReview = {
  title: string;
  lines: string[];
};

const highRiskPermissionPattern = /(authorization|admin|manage|write|delete|approve|post|reverse|export|finance|cost|audit)/i;

export const isHighRiskPermission = (permission?: AuthPermission | null) => {
  if (!permission) return false;
  return highRiskPermissionPattern.test(`${permission.code} ${permission.resource} ${permission.action}`);
};

export const createEmptyDraft = (): RoleDraft => ({
  code: '',
  name: '',
  description: '',
  isActive: true,
  dataScopes: ['own_customers'],
  permissions: ['dashboard.read'],
});

export const roleToDraft = (role: AuthRole): RoleDraft => ({
  code: role.code,
  name: role.name,
  description: role.description || '',
  isActive: role.isActive,
  dataScopes: role.dataScopes || [],
  permissions: role.permissions || [],
});

export const sameSet = (left: string[], right: string[]) => {
  if (left.length !== right.length) return false;
  const set = new Set(left);
  return right.every((item) => set.has(item));
};

export const diffList = (before: string[], after: string[]) => {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter((item) => !beforeSet.has(item)).sort(),
    removed: before.filter((item) => !afterSet.has(item)).sort(),
  };
};
