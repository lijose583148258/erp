import api from '../utils/api';

export type SalesSegment = 'direct' | 'channel' | 'mixed';

export interface SegmentPerformance {
  key: SalesSegment;
  members: number;
  customers: number;
  orders: number;
  completed: number;
  revenue: number;
}

export interface DealerAnalyticsSnapshot {
  segments: SegmentPerformance[];
  totals: {
    members: number;
    customers: number;
    orders: number;
    revenue: number;
  };
}

interface TeamPerformanceRow {
  segment: SalesSegment | null;
  totalOrders: number;
  completedOrders: number;
  totalAmount: number;
  customerCount: number;
}

const SEGMENTS: SalesSegment[] = ['direct', 'channel', 'mixed'];

export const dealerAnalyticsService = {
  async getSnapshot(): Promise<DealerAnalyticsSnapshot> {
    const response = await api.get<any, { success: boolean; data: TeamPerformanceRow[] }>('/team/performance');
    const rows = response.data || [];
    const segments = SEGMENTS.map((key) => {
      const segmentRows = rows.filter((row) => (row.segment || 'direct') === key);
      return segmentRows.reduce<SegmentPerformance>((result, row) => ({
        ...result,
        members: result.members + 1,
        customers: result.customers + Number(row.customerCount || 0),
        orders: result.orders + Number(row.totalOrders || 0),
        completed: result.completed + Number(row.completedOrders || 0),
        revenue: result.revenue + Number(row.totalAmount || 0),
      }), { key, members: 0, customers: 0, orders: 0, completed: 0, revenue: 0 });
    });

    const totals = segments.reduce((result, row) => ({
      members: result.members + row.members,
      customers: result.customers + row.customers,
      orders: result.orders + row.orders,
      revenue: result.revenue + row.revenue,
    }), { members: 0, customers: 0, orders: 0, revenue: 0 });

    return { segments, totals };
  },
};
