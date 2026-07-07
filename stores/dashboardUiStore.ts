import { create } from 'zustand';
import type { DashboardInventoryAlert, DashboardSystemStatus, DashboardTrend } from '../shared/contracts/dashboard';

export interface DashboardStatsSnapshot {
  monthlyRevenue: number;
  overdueAmount: number;
  activeShipments: number;
  totalCustomers: number;
  pendingCommissions: number;
  riskCustomers: number;
}

export interface DashboardTask {
  time: string;
  title: string;
  type: string;
  color: string;
}

export interface DashboardChartBox {
  width: number;
  height: number;
}

export interface DashboardChartPoint {
  name: string;
  revenue: number;
}

const emptyStats: DashboardStatsSnapshot = {
  monthlyRevenue: 0,
  overdueAmount: 0,
  activeShipments: 0,
  totalCustomers: 0,
  pendingCommissions: 0,
  riskCustomers: 0,
};

const emptySystemStatus: DashboardSystemStatus = {
  load: '0.0ms',
  sessions: 0,
};

export const toDashboardChartData = (trends: DashboardTrend[]): DashboardChartPoint[] =>
  trends.map((item) => ({
    name: item.date.slice(5),
    revenue: item.amount,
  }));

interface DashboardUiState {
  stats: DashboardStatsSnapshot;
  tasks: DashboardTask[];
  inventoryAlerts: DashboardInventoryAlert[];
  systemStatus: DashboardSystemStatus;
  chartBox: DashboardChartBox;
  chartData: DashboardChartPoint[];
  applyOverviewSnapshot: (snapshot: {
    stats: DashboardStatsSnapshot;
    tasks: DashboardTask[];
    inventoryAlerts: DashboardInventoryAlert[];
    systemStatus?: DashboardSystemStatus | undefined;
  }) => void;
  setChartBox: (box: DashboardChartBox) => void;
  setChartDataFromTrends: (trends: DashboardTrend[]) => void;
  resetDashboardUi: () => void;
}

export const useDashboardUiStore = create<DashboardUiState>((set) => ({
  stats: emptyStats,
  tasks: [],
  inventoryAlerts: [],
  systemStatus: emptySystemStatus,
  chartBox: { width: 0, height: 0 },
  chartData: [],
  applyOverviewSnapshot: ({ stats, tasks, inventoryAlerts, systemStatus }) => {
    set({
      stats,
      tasks,
      inventoryAlerts,
      systemStatus: systemStatus || emptySystemStatus,
    });
  },
  setChartBox: (chartBox) => set({ chartBox }),
  setChartDataFromTrends: (trends) => set({ chartData: toDashboardChartData(trends) }),
  resetDashboardUi: () => set({
    stats: emptyStats,
    tasks: [],
    inventoryAlerts: [],
    systemStatus: emptySystemStatus,
    chartBox: { width: 0, height: 0 },
    chartData: [],
  }),
}));
