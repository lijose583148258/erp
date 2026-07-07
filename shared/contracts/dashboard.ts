export const dashboardOverviewSectionKeys = [
  'overview',
  'monthly',
  'weekly',
  'ordersByStatus',
  'recentOrders',
  'inventoryAlerts',
  'systemStatus',
] as const;

export const dashboardOverviewMetricKeys = [
  'totalCustomers',
  'activeCustomers',
  'totalOrders',
  'totalRevenue',
  'pendingOrders',
  'deliveredOrders',
  'pendingShipments',
  'pendingRmas',
  'riskCustomers',
  'pendingCommissions',
  'overdueAmount',
] as const;

export const dashboardPeriodSummaryKeys = ['orderCount', 'revenue'] as const;
export const dashboardRecentOrderKeys = ['id', 'orderNo', 'customerName', 'amount', 'status', 'createdAt'] as const;
export const dashboardInventoryAlertKeys = [
  'sku',
  'name',
  'stock',
  'reorderPoint',
  'pendingOrders',
  'daysOfStock',
  'priority',
  'suggestion',
] as const;
export const dashboardSystemStatusKeys = ['load', 'sessions'] as const;
export const dashboardTrendKeys = ['date', 'count', 'amount'] as const;

export type DashboardOverviewSectionKey = typeof dashboardOverviewSectionKeys[number];
export type DashboardOverviewMetricKey = typeof dashboardOverviewMetricKeys[number];
export type DashboardPeriodSummaryKey = typeof dashboardPeriodSummaryKeys[number];
export type DashboardInventoryAlertPriority = 'high' | 'medium' | 'low';

export interface DashboardOverviewMetrics {
  totalCustomers: number;
  activeCustomers: number;
  totalOrders: number;
  totalRevenue: number;
  pendingOrders: number;
  deliveredOrders: number;
  pendingShipments: number;
  pendingRmas: number;
  riskCustomers: number;
  pendingCommissions: number;
  overdueAmount: number;
}

export interface DashboardPeriodSummary {
  orderCount: number;
  revenue: number;
}

export interface DashboardOrderStatusSummary {
  count: number;
  amount: number;
}

export interface DashboardRecentOrder {
  id: number;
  orderNo: string;
  customerName: string;
  amount: number;
  status: string;
  createdAt: string;
}

export interface DashboardInventoryAlert {
  sku: string;
  name: string;
  stock: number;
  reorderPoint: number;
  pendingOrders: number;
  daysOfStock: number;
  priority: DashboardInventoryAlertPriority;
  suggestion: string;
}

export interface DashboardSystemStatus {
  load: string;
  sessions: number;
}

export interface DashboardOverview {
  overview: DashboardOverviewMetrics;
  monthly: DashboardPeriodSummary;
  weekly: DashboardPeriodSummary;
  ordersByStatus: Record<string, DashboardOrderStatusSummary>;
  recentOrders: DashboardRecentOrder[];
  inventoryAlerts?: DashboardInventoryAlert[];
  systemStatus?: DashboardSystemStatus;
}

export interface DashboardTrend {
  date: string;
  count: number;
  amount: number;
  risk?: number;
}
