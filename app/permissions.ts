import type { BuiltInUserRole, CurrentUser, UserRole } from '../types';

export type FrontendPermission =
  | 'dashboard.read'
  | 'customers.read'
  | 'customers.create'
  | 'customers.update'
  | 'customers.delete'
  | 'customers.export'
  | 'customers.import'
  | 'customers.pool.manage'
  | 'orders.read'
  | 'orders.create'
  | 'orders.update'
  | 'orders.export'
  | 'orders.import'
  | 'orders.status.manage'
  | 'orders.complete'
  | 'orders.shippingReady.read'
  | 'orders.payment.record'
  | 'orders.payment.verify'
  | 'collections.read'
  | 'collections.sync'
  | 'collections.reminder.write'
  | 'collections.promise.write'
  | 'collections.dispute.write'
  | 'collections.hold.manage'
  | 'finance.read'
  | 'contracts.read'
  | 'contracts.write'
  | 'barter.read'
  | 'barter.write'
  | 'barter.approve'
  | 'barter.post'
  | 'risk.read'
  | 'dealerAnalytics.read'
  | 'samples.read'
  | 'samples.create'
  | 'samples.status.manage'
  | 'shipping.read'
  | 'shipping.write'
  | 'shipping.receipts.read'
  | 'discrepancies.read'
  | 'discrepancies.write'
  | 'discrepancies.rules.manage'
  | 'rma.read'
  | 'rma.write'
  | 'rma.resolve'
  | 'team.read'
  | 'team.write'
  | 'assets.read'
  | 'assets.write'
  | 'production.read'
  | 'production.write'
  | 'adjustments.read'
  | 'adjustments.write'
  | 'adjustments.apply'
  | 'adjustments.reverse'
  | 'warehouse.read'
  | 'warehouse.write'
  | 'procurement.read'
  | 'procurement.write'
  | 'procurement.b2b.read'
  | 'audit.read';

export const MENU_PERMISSION_BY_MODULE: Record<string, FrontendPermission> = {
  dashboard: 'dashboard.read',
  crm: 'customers.read',
  orders: 'orders.read',
  collections: 'collections.read',
  financeAnalytics: 'finance.read',
  contracts: 'contracts.read',
  barter: 'barter.read',
  risk: 'risk.read',
  dealerAnalytics: 'dealerAnalytics.read',
  samples: 'samples.read',
  shipping: 'shipping.read',
  discrepancies: 'discrepancies.read',
  adjustment: 'adjustments.read',
  rma: 'rma.read',
  team: 'team.read',
  assets: 'assets.read',
  production: 'production.read',
  warehouse: 'warehouse.read',
  procurement: 'procurement.read',
  audit: 'audit.read',
};

export const FRONTEND_ROLE_PERMISSIONS: Record<BuiltInUserRole, readonly FrontendPermission[]> = {
  admin: [
    'dashboard.read',
    'customers.read',
    'customers.create',
    'customers.update',
    'customers.delete',
    'customers.export',
    'customers.import',
    'customers.pool.manage',
    'orders.read',
    'orders.create',
    'orders.update',
    'orders.export',
    'orders.import',
    'orders.status.manage',
    'orders.complete',
    'orders.shippingReady.read',
    'orders.payment.record',
    'orders.payment.verify',
    'collections.read',
    'collections.sync',
    'collections.reminder.write',
    'collections.promise.write',
    'collections.dispute.write',
    'collections.hold.manage',
    'finance.read',
    'contracts.read',
    'contracts.write',
    'barter.read',
    'barter.write',
    'barter.approve',
    'barter.post',
    'risk.read',
    'dealerAnalytics.read',
    'samples.read',
    'samples.create',
    'samples.status.manage',
    'shipping.read',
    'shipping.write',
    'shipping.receipts.read',
    'discrepancies.read',
    'discrepancies.write',
    'discrepancies.rules.manage',
    'rma.read',
    'rma.write',
    'rma.resolve',
    'team.read',
    'team.write',
    'assets.read',
    'assets.write',
    'production.read',
    'production.write',
    'adjustments.read',
    'adjustments.write',
    'adjustments.apply',
    'adjustments.reverse',
    'warehouse.read',
    'warehouse.write',
    'procurement.read',
    'procurement.write',
    'procurement.b2b.read',
    'audit.read',
  ],
  manager: [
    'dashboard.read',
    'customers.read',
    'customers.create',
    'customers.update',
    'customers.export',
    'customers.import',
    'customers.pool.manage',
    'orders.read',
    'orders.create',
    'orders.update',
    'orders.export',
    'orders.import',
    'orders.status.manage',
    'orders.complete',
    'orders.shippingReady.read',
    'orders.payment.record',
    'orders.payment.verify',
    'collections.read',
    'collections.sync',
    'collections.reminder.write',
    'collections.promise.write',
    'collections.dispute.write',
    'collections.hold.manage',
    'finance.read',
    'contracts.read',
    'contracts.write',
    'barter.read',
    'barter.write',
    'barter.approve',
    'barter.post',
    'risk.read',
    'dealerAnalytics.read',
    'samples.read',
    'samples.create',
    'samples.status.manage',
    'shipping.read',
    'shipping.write',
    'shipping.receipts.read',
    'discrepancies.read',
    'discrepancies.write',
    'discrepancies.rules.manage',
    'rma.read',
    'rma.write',
    'rma.resolve',
    'team.read',
    'assets.read',
    'assets.write',
    'production.read',
    'production.write',
    'adjustments.read',
    'adjustments.write',
    'adjustments.apply',
    'adjustments.reverse',
    'warehouse.read',
    'warehouse.write',
    'procurement.read',
    'procurement.write',
    'procurement.b2b.read',
  ],
  sales: [
    'dashboard.read',
    'customers.read',
    'customers.create',
    'customers.update',
    'customers.export',
    'orders.read',
    'orders.create',
    'orders.update',
    'orders.export',
    'orders.payment.record',
    'collections.read',
    'collections.reminder.write',
    'collections.promise.write',
    'collections.dispute.write',
    'contracts.read',
    'contracts.write',
    'barter.read',
    'barter.write',
    'risk.read',
    'samples.read',
    'samples.create',
    'samples.status.manage',
    'shipping.read',
    'shipping.receipts.read',
    'rma.read',
    'rma.write',
    'procurement.b2b.read',
  ],
  warehouse: [
    'dashboard.read',
    'barter.read',
    'barter.write',
    'samples.read',
    'samples.status.manage',
    'shipping.read',
    'shipping.write',
    'shipping.receipts.read',
    'discrepancies.read',
    'discrepancies.write',
    'assets.read',
    'assets.write',
    'production.read',
    'production.write',
    'adjustments.read',
    'adjustments.write',
    'adjustments.apply',
    'adjustments.reverse',
    'warehouse.read',
    'warehouse.write',
    'procurement.read',
    'procurement.write',
    'procurement.b2b.read',
  ],
  finance: [
    'dashboard.read',
    'orders.read',
    'orders.export',
    'orders.payment.record',
    'orders.payment.verify',
    'collections.read',
    'collections.sync',
    'collections.reminder.write',
    'collections.promise.write',
    'collections.dispute.write',
    'collections.hold.manage',
    'finance.read',
    'contracts.read',
    'barter.read',
    'barter.write',
    'barter.approve',
    'barter.post',
    'risk.read',
    'dealerAnalytics.read',
    'shipping.receipts.read',
    'discrepancies.read',
    'assets.read',
    'production.read',
    'adjustments.read',
    'adjustments.write',
    'adjustments.apply',
    'adjustments.reverse',
    'procurement.read',
  ],
};

function getBuiltInRolePermissions(role: UserRole): readonly FrontendPermission[] {
  return FRONTEND_ROLE_PERMISSIONS[role as BuiltInUserRole] || [];
}

function getUserPermissions(userOrRole: CurrentUser | UserRole): readonly string[] {
  if (typeof userOrRole === 'string') {
    return getBuiltInRolePermissions(userOrRole);
  }
  return userOrRole.permissions?.length ? userOrRole.permissions : getBuiltInRolePermissions(userOrRole.role);
}

export function can(userOrRole: CurrentUser | UserRole, permission: FrontendPermission): boolean {
  return getUserPermissions(userOrRole).includes(permission);
}

export function canOpenModule(userOrRole: CurrentUser | UserRole, moduleId: string): boolean {
  const permission = MENU_PERMISSION_BY_MODULE[moduleId];
  return permission ? can(userOrRole, permission) : false;
}
