export type BuiltInRole = 'admin' | 'manager' | 'sales' | 'warehouse' | 'finance';

export type DataScope =
  | 'all'
  | 'own_customers'
  | 'team_customers'
  | 'finance_visible'
  | 'warehouse_visible'
  | 'procurement_visible';

export type Permission =
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
  | 'finance.read'
  | 'finance.currency.sync'
  | 'procurement.read'
  | 'procurement.write'
  | 'procurement.b2b.read'
  | 'system.read'
  | 'system.backup.manage'
  | 'audit.read';

export interface PermissionDefinition {
  code: Permission;
  resource: string;
  action: string;
  label: string;
  group: string;
  description?: string;
}

export const PERMISSION_DEFINITIONS: readonly PermissionDefinition[] = [
  { code: 'dashboard.read', resource: 'dashboard', action: 'read', label: '查看看板', group: '工作台' },
  { code: 'customers.read', resource: 'customers', action: 'read', label: '查看客户', group: '客户' },
  { code: 'customers.create', resource: 'customers', action: 'create', label: '新建客户', group: '客户' },
  { code: 'customers.update', resource: 'customers', action: 'update', label: '编辑客户', group: '客户' },
  { code: 'customers.delete', resource: 'customers', action: 'delete', label: '删除客户', group: '客户' },
  { code: 'customers.export', resource: 'customers', action: 'export', label: '导出客户', group: '客户' },
  { code: 'customers.import', resource: 'customers', action: 'import', label: '导入客户', group: '客户' },
  { code: 'customers.pool.manage', resource: 'customers.pool', action: 'manage', label: '管理客户池', group: '客户' },
  { code: 'orders.read', resource: 'orders', action: 'read', label: '查看订单', group: '订单' },
  { code: 'orders.create', resource: 'orders', action: 'create', label: '新建订单', group: '订单' },
  { code: 'orders.update', resource: 'orders', action: 'update', label: '编辑订单', group: '订单' },
  { code: 'orders.export', resource: 'orders', action: 'export', label: '导出订单', group: '订单' },
  { code: 'orders.import', resource: 'orders', action: 'import', label: '导入订单', group: '订单' },
  { code: 'orders.status.manage', resource: 'orders.status', action: 'manage', label: '管理订单状态', group: '订单' },
  { code: 'orders.complete', resource: 'orders', action: 'complete', label: '手动结案订单', group: '订单' },
  { code: 'orders.shippingReady.read', resource: 'orders.shippingReady', action: 'read', label: '查看可发货订单', group: '物流' },
  { code: 'orders.payment.record', resource: 'orders.payment', action: 'record', label: '登记回款', group: '财务' },
  { code: 'orders.payment.verify', resource: 'orders.payment', action: 'verify', label: '核验回款', group: '财务' },
  { code: 'collections.read', resource: 'collections', action: 'read', label: '查看回款中心', group: '回款' },
  { code: 'collections.sync', resource: 'collections', action: 'sync', label: '同步逾期回款状态', group: '回款' },
  { code: 'collections.reminder.write', resource: 'collections.reminder', action: 'write', label: '创建催收提醒', group: '回款' },
  { code: 'collections.promise.write', resource: 'collections.promise', action: 'write', label: '管理承诺付款', group: '回款' },
  { code: 'collections.dispute.write', resource: 'collections.dispute', action: 'write', label: '管理回款争议', group: '回款' },
  { code: 'collections.hold.manage', resource: 'collections.hold', action: 'manage', label: '管理客户和发货冻结', group: '回款' },
  { code: 'contracts.read', resource: 'contracts', action: 'read', label: '查看合同', group: '合同' },
  { code: 'contracts.write', resource: 'contracts', action: 'write', label: '新建和编辑合同', group: '合同' },
  { code: 'barter.read', resource: 'barter', action: 'read', label: '查看货抵换货', group: '货抵' },
  { code: 'barter.write', resource: 'barter', action: 'write', label: '新建和编辑货抵换货', group: '货抵' },
  { code: 'barter.approve', resource: 'barter', action: 'approve', label: '审批货抵换货', group: '货抵' },
  { code: 'barter.post', resource: 'barter', action: 'post', label: '过账和冲销货抵换货', group: '货抵' },
  { code: 'risk.read', resource: 'risk', action: 'read', label: '查看风控', group: '风控' },
  { code: 'dealerAnalytics.read', resource: 'dealerAnalytics', action: 'read', label: '查看经销商分析', group: '分析' },
  { code: 'samples.read', resource: 'samples', action: 'read', label: '查看样品', group: '样品' },
  { code: 'samples.create', resource: 'samples', action: 'create', label: '新建样品申请', group: '样品' },
  { code: 'samples.status.manage', resource: 'samples.status', action: 'manage', label: '管理样品状态', group: '样品' },
  { code: 'shipping.read', resource: 'shipping', action: 'read', label: '查看出货物流', group: '物流' },
  { code: 'shipping.write', resource: 'shipping', action: 'write', label: '创建和推进出货物流', group: '物流' },
  { code: 'shipping.receipts.read', resource: 'shipping.receipts', action: 'read', label: '查看签收批次', group: '物流' },
  { code: 'discrepancies.read', resource: 'discrepancies', action: 'read', label: '查看收发货差异', group: '物流' },
  { code: 'discrepancies.write', resource: 'discrepancies', action: 'write', label: '处理收发货差异', group: '物流' },
  { code: 'discrepancies.rules.manage', resource: 'discrepancies.rules', action: 'manage', label: '管理收发货容差规则', group: '物流' },
  { code: 'rma.read', resource: 'rma', action: 'read', label: '查看售后', group: '售后' },
  { code: 'rma.write', resource: 'rma', action: 'write', label: '新建售后申请', group: '售后' },
  { code: 'rma.resolve', resource: 'rma', action: 'resolve', label: '处理售后申请', group: '售后' },
  { code: 'team.read', resource: 'team', action: 'read', label: '查看团队', group: '组织' },
  { code: 'team.write', resource: 'team', action: 'write', label: '管理团队与角色', group: '组织' },
  { code: 'assets.read', resource: 'assets', action: 'read', label: '查看资产', group: '资产' },
  { code: 'assets.write', resource: 'assets', action: 'write', label: '管理资产', group: '资产' },
  { code: 'production.read', resource: 'production', action: 'read', label: '查看生产', group: '生产' },
  { code: 'production.write', resource: 'production', action: 'write', label: '管理生产', group: '生产' },
  { code: 'adjustments.read', resource: 'adjustments', action: 'read', label: '查看调整单', group: '调整' },
  { code: 'adjustments.write', resource: 'adjustments', action: 'write', label: '新建调整单', group: '调整' },
  { code: 'adjustments.apply', resource: 'adjustments', action: 'apply', label: '生效调整单', group: '调整' },
  { code: 'adjustments.reverse', resource: 'adjustments', action: 'reverse', label: '冲销调整单', group: '调整' },
  { code: 'warehouse.read', resource: 'warehouse', action: 'read', label: '查看仓储', group: '仓储' },
  { code: 'warehouse.write', resource: 'warehouse', action: 'write', label: '管理仓储', group: '仓储' },
  { code: 'finance.read', resource: 'finance', action: 'read', label: '查看财务', group: '财务' },
  { code: 'procurement.read', resource: 'procurement', action: 'read', label: '查看采购', group: '采购' },
  { code: 'procurement.write', resource: 'procurement', action: 'write', label: '管理采购', group: '采购' },
  { code: 'procurement.b2b.read', resource: 'procurement.b2b', action: 'read', label: '查看 B2B 采购状态', group: '采购' },
  { code: 'audit.read', resource: 'audit', action: 'read', label: '查看审计日志', group: '审计' },
  { code: 'finance.currency.sync', resource: 'finance.currency', action: 'sync', label: 'Sync currency rates', group: 'finance' },
  { code: 'system.read', resource: 'system', action: 'read', label: 'Read system status', group: 'system' },
  { code: 'system.backup.manage', resource: 'system.backup', action: 'manage', label: 'Manage system backups', group: 'system' },
];

export const ALL_PERMISSION_CODES = PERMISSION_DEFINITIONS.map((permission) => permission.code);

export interface RolePolicy {
  permissions: readonly Permission[];
  dataScopes: readonly DataScope[];
}

export const ROLE_POLICIES: Record<BuiltInRole, RolePolicy> = {
  admin: {
    dataScopes: ['all'],
    permissions: [
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
    'finance.read',
    'finance.currency.sync',
    'procurement.read',
    'procurement.write',
    'procurement.b2b.read',
    'system.read',
    'system.backup.manage',
    'audit.read',
    ],
  },
  manager: {
    dataScopes: ['team_customers', 'finance_visible', 'warehouse_visible', 'procurement_visible'],
    permissions: [
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
    'finance.read',
    'finance.currency.sync',
    'procurement.read',
    'procurement.write',
    'procurement.b2b.read',
    'system.read',
    ],
  },
  sales: {
    dataScopes: ['own_customers'],
    permissions: [
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
  },
  warehouse: {
    dataScopes: ['warehouse_visible', 'procurement_visible'],
    permissions: [
    'dashboard.read',
    'orders.shippingReady.read',
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
  },
  finance: {
    dataScopes: ['finance_visible', 'procurement_visible'],
    permissions: [
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
    'finance.read',
    'finance.currency.sync',
    'procurement.read',
    ],
  },
};

export const ROLE_PERMISSIONS: Record<BuiltInRole, readonly Permission[]> = {
  admin: ROLE_POLICIES.admin.permissions,
  manager: ROLE_POLICIES.manager.permissions,
  sales: ROLE_POLICIES.sales.permissions,
  warehouse: ROLE_POLICIES.warehouse.permissions,
  finance: ROLE_POLICIES.finance.permissions,
};

export function isBuiltInRole(role: string): role is BuiltInRole {
  return role === 'admin' || role === 'manager' || role === 'sales' || role === 'warehouse' || role === 'finance';
}

export function roleHasPermission(role: string, permission: Permission): boolean {
  if (!isBuiltInRole(role)) {
    return false;
  }

  return ROLE_PERMISSIONS[role].includes(permission);
}

export function roleHasAllPermissions(role: string, permissions: readonly Permission[]): boolean {
  return permissions.every((permission) => roleHasPermission(role, permission));
}
