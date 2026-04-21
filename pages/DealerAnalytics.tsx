import React, { useState, useEffect, useCallback } from 'react';
import { AlertCircle, TrendingUp, Users, DollarSign, CalendarClock, AlertTriangle } from 'lucide-react';
import { DealerAnalyticsService } from '../services/dealerAnalyticsService';

interface DealerReport {
  dealerId: string;
  totalRevenue: number;
  orderCount: number;
  highRiskCustomers: number;
  expiringBatches: number;
  expiredBatches: number;
  totalStock: number;
  inventoryRisk: number;
  healthScore: number;
  segment: string;
  actionAdvice: string;
  lastSync: Date;
}

export default function DealerAnalytics() {
  const [reports, setReports] = useState<DealerReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadDealerReports = useCallback(async (silent = false) => {
    try {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      const now = new Date();
      const mockRaw = [
        {
          dealerId: 'dealer_hanoi',
          totalRevenue: 3_500_000,
          orderCount: 128,
          highRiskCustomers: 3,
          expiringBatches: 6,
          expiredBatches: 2,
          totalStock: 4200,
          inventoryRisk: 8,
          lastSync: now
        },
        {
          dealerId: 'dealer_saigon',
          totalRevenue: 5_200_000,
          orderCount: 186,
          highRiskCustomers: 1,
          expiringBatches: 2,
          expiredBatches: 0,
          totalStock: 3000,
          inventoryRisk: 3,
          lastSync: now
        },
        {
          dealerId: 'dealer_haiphong',
          totalRevenue: 1_100_000,
          orderCount: 42,
          highRiskCustomers: 6,
          expiringBatches: 9,
          expiredBatches: 4,
          totalStock: 5200,
          inventoryRisk: 18,
          lastSync: now
        }
      ];
      const analyzedReports = DealerAnalyticsService.segmentDealers(mockRaw as any[]);
      setReports(analyzedReports as any[]);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载经销商数据失败');
    } finally {
      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadDealerReports();
  }, [loadDealerReports]);

  useEffect(() => {
    const intervalMs = reports.some(report => report.segment === 'At Risk (Zombie)') ? 30000 : 120000;
    const intervalId = window.setInterval(() => {
      loadDealerReports(true);
    }, intervalMs);
    return () => window.clearInterval(intervalId);
  }, [loadDealerReports, reports]);

  const getSegmentColor = (segment: string) => {
    switch (segment) {
      case 'Premium (High Potential)': return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'At Risk (Zombie)': return 'bg-rose-100 text-rose-800 border-rose-200';
      default: return 'bg-blue-100 text-blue-800 border-blue-200';
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: 'CNY',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-sm text-slate-500">正在连接各经销商数据库...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="border border-red-200 bg-red-50 rounded-3xl p-6">
          <div className="flex items-center space-x-3">
            <AlertCircle className="h-6 w-6 text-red-600" />
            <div>
              <p className="font-medium text-red-800">连接失败</p>
              <p className="text-sm text-red-600">{error}</p>
            </div>
          </div>
          <button onClick={() => loadDealerReports()} className="mt-4 px-4 py-2 rounded-xl border border-red-200 text-red-700 text-xs font-black uppercase tracking-widest">
            重试连接
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">经销商表现分析</h1>
          <p className="text-slate-600">
            实时监控各经销商经营健康状况，识别高潜力合作伙伴与风险经销商
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-xs text-slate-500">
            {lastUpdated ? `最近刷新: ${lastUpdated.toLocaleString('zh-CN')}` : '尚未刷新'}
          </div>
          <button onClick={() => loadDealerReports(true)} disabled={refreshing} className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-black uppercase tracking-widest">
            {refreshing ? '刷新中...' : '立即刷新'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className="bg-white/80 dark:bg-slate-900/80 p-4 rounded-3xl border border-slate-100 dark:border-slate-800">
          <p className="text-sm font-medium text-slate-600">经销商总数</p>
          <div className="text-2xl font-bold mt-2">{reports.length}</div>
          <p className="text-xs text-slate-500">活跃经销商</p>
        </div>

        <div className="bg-white/80 dark:bg-slate-900/80 p-4 rounded-3xl border border-slate-100 dark:border-slate-800">
          <p className="text-sm font-medium text-slate-600">总销售额</p>
          <div className="text-2xl font-bold mt-2">
            {formatCurrency(reports.reduce((sum, r) => sum + r.totalRevenue, 0))}
          </div>
          <p className="text-xs text-slate-500">所有经销商合计</p>
        </div>

        <div className="bg-white/80 dark:bg-slate-900/80 p-4 rounded-3xl border border-slate-100 dark:border-slate-800">
          <p className="text-sm font-medium text-slate-600">高风险客户</p>
          <div className="text-2xl font-bold text-rose-600 mt-2">
            {reports.reduce((sum, r) => sum + r.highRiskCustomers, 0)}
          </div>
          <p className="text-xs text-slate-500">需要重点关注</p>
        </div>

        <div className="bg-white/80 dark:bg-slate-900/80 p-4 rounded-3xl border border-slate-100 dark:border-slate-800">
          <p className="text-sm font-medium text-slate-600">临期/过期批次</p>
          <div className="text-2xl font-bold text-amber-600 mt-2">
            {reports.reduce((sum, r) => sum + r.expiringBatches + r.expiredBatches, 0)}
          </div>
          <p className="text-xs text-slate-500">效期风险汇总</p>
        </div>

        <div className="bg-white/80 dark:bg-slate-900/80 p-4 rounded-3xl border border-slate-100 dark:border-slate-800">
          <p className="text-sm font-medium text-slate-600">平均健康分</p>
          <div className="text-2xl font-bold mt-2">
            {Math.round(reports.reduce((sum, r) => sum + r.healthScore, 0) / reports.length || 0)}
          </div>
          <p className="text-xs text-slate-500">整体表现评分</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {reports.map((report) => (
          <div key={report.dealerId} className="bg-white/80 dark:bg-slate-900/80 rounded-3xl border border-slate-100 dark:border-slate-800 p-6 hover:shadow-lg transition-shadow">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-lg font-semibold text-slate-900 dark:text-white">{report.dealerId}</p>
                <p className="text-xs text-slate-500">最后同步: {new Date(report.lastSync).toLocaleString('zh-CN')}</p>
              </div>
              <span className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border ${getSegmentColor(report.segment)}`}>
                {report.segment}
              </span>
            </div>

            <div className="mb-4">
              <div className="flex justify-between text-sm mb-2">
                <span>健康评分</span>
                <span className="font-medium">{report.healthScore}/100</span>
              </div>
              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-600" style={{ width: `${report.healthScore}%` }}></div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 text-sm mb-4">
              <div className="text-center">
                <DollarSign className="h-4 w-4 mx-auto text-blue-600" />
                <div className="font-semibold mt-1">{formatCurrency(report.totalRevenue)}</div>
                <div className="text-xs text-slate-500">销售额</div>
              </div>
              
              <div className="text-center">
                <TrendingUp className="h-4 w-4 mx-auto text-emerald-600" />
                <div className="font-semibold mt-1">{report.orderCount}</div>
                <div className="text-xs text-slate-500">订单数</div>
              </div>
              
              <div className="text-center">
                <Users className="h-4 w-4 mx-auto text-rose-600" />
                <div className="font-semibold mt-1">{report.highRiskCustomers}</div>
                <div className="text-xs text-slate-500">高风险客户</div>
              </div>

              <div className="text-center">
                <CalendarClock className="h-4 w-4 mx-auto text-amber-600" />
                <div className="font-semibold mt-1">{report.expiringBatches}</div>
                <div className="text-xs text-slate-500">临期批次</div>
              </div>

              <div className="text-center">
                <AlertTriangle className="h-4 w-4 mx-auto text-rose-600" />
                <div className="font-semibold mt-1">{report.expiredBatches}</div>
                <div className="text-xs text-slate-500">过期批次</div>
              </div>
            </div>

            <div className="bg-slate-50 rounded-2xl p-3">
              <p className="text-sm font-medium text-slate-800">行动建议:</p>
              <p className="text-sm text-slate-600 mt-1">{report.actionAdvice}</p>
            </div>
          </div>
        ))}
      </div>

      {reports.length === 0 && !loading && (
        <div className="text-center py-12">
          <AlertCircle className="h-12 w-12 text-slate-300 mx-auto mb-4" />
          <p className="text-slate-500">暂无经销商数据</p>
        </div>
      )}
    </div>
  );
}
