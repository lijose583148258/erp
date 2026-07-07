
import React, { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp, AlertTriangle, Package, DollarSign, Users, ArrowUpRight,
  FileText, Clock, ShieldAlert, Zap
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useAppContext } from '../app/AppContext';
import { dashboardService } from '../services/dashboard.service';
import { useDashboardUiStore, type DashboardTask } from '../stores/dashboardUiStore';

const StatCard = ({ title, value, sub, icon: Icon, color, trend }: any) => (
  <div className="bg-white dark:bg-slate-900 p-6 lg:p-8 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm hover:shadow-xl hover:shadow-slate-100 dark:hover:shadow-none transition-all duration-300 group overflow-hidden relative active-shrink">
    <div className="absolute top-0 right-0 w-24 h-24 bg-slate-50 dark:bg-slate-800/50 rounded-full -mr-8 -mt-8 transition-transform group-hover:scale-150 duration-700"></div>
    <div className="relative z-10">
      <div className="flex items-center justify-between mb-6">
        <div className={`p-4 rounded-[20px] ${color} shadow-lg shadow-slate-200/50 dark:shadow-none`}>
          <Icon size={22} className="text-white" />
        </div>
        {trend && (
          <span className="flex items-center text-xs font-black text-emerald-500 bg-emerald-50 dark:bg-emerald-900/30 px-3 py-1.5 rounded-full">
            <ArrowUpRight size={12} className="mr-1" />
            {trend}
          </span>
        )}
      </div>
      <h3 className="text-xs font-black text-slate-400 dark:text-slate-500 uppercase ">{title}</h3>
      <p className="text-3xl font-black text-slate-800 dark:text-white mt-2 tracking-tighter">{value}</p>
      <p className="text-xs text-slate-400 dark:text-slate-500 mt-4 font-black flex items-center opacity-60 uppercase tracking-wider">
        <Clock size={12} className="mr-2" />
        {sub}
      </p>
    </div>
  </div>
);

const QuickAction = ({ icon: Icon, label, color, onClick }: any) => (
  <button
    onClick={onClick}
    className="flex flex-col items-center justify-center p-5 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl hover:border-blue-200 dark:hover:border-blue-800 transition-all active-shrink group"
  >
    <div className={`p-4 rounded-[20px] ${color} text-white mb-3 shadow-md group-hover:scale-110 transition-transform`}>
      <Icon size={24} />
    </div>
    <span className="text-xs font-extrabold text-slate-600 dark:text-slate-300 uppercase tracking-tight">{label}</span>
  </button>
);

const Dashboard = () => {
  const { t, theme, formatPrice, notify } = useAppContext();
  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const stats = useDashboardUiStore((state) => state.stats);
  const tasks = useDashboardUiStore((state) => state.tasks);
  const inventoryAlerts = useDashboardUiStore((state) => state.inventoryAlerts);
  const systemStatus = useDashboardUiStore((state) => state.systemStatus);
  const chartBox = useDashboardUiStore((state) => state.chartBox);
  const chartData = useDashboardUiStore((state) => state.chartData);
  const applyOverviewSnapshot = useDashboardUiStore((state) => state.applyOverviewSnapshot);
  const setChartBox = useDashboardUiStore((state) => state.setChartBox);
  const setChartDataFromTrends = useDashboardUiStore((state) => state.setChartDataFromTrends);

  const recommendations = [
    { title: t.reportOcr, detail: t.reportOcrDetail, impact: t.reportOcrImpact },
    { title: t.reportCommandBar, detail: t.reportCommandBarDetail, impact: t.reportCommandBarImpact },
    { title: t.reportProcurement, detail: t.reportProcurementDetail, impact: t.reportProcurementImpact },
    { title: t.reportPricing, detail: t.reportPricingDetail, impact: t.reportPricingImpact },
    { title: t.reportOrderAssist, detail: t.reportOrderAssistDetail, impact: t.reportOrderAssistImpact },
    { title: t.reportPwa, detail: t.reportPwaDetail, impact: t.reportPwaImpact }
  ];

  const biRoadmap = [
    { title: t.biLaneOps, desc: t.biLaneOpsDesc },
    { title: t.biBatchTrace, desc: t.biBatchTraceDesc },
    { title: t.biProfit, desc: t.biProfitDesc },
    { title: t.biSupplier, desc: t.biSupplierDesc }
  ];

  const priorityMeta = {
    high: { color: 'bg-rose-600', label: t.inventoryAlertPriorityHigh },
    medium: { color: 'bg-amber-500', label: t.inventoryAlertPriorityMedium },
    low: { color: 'bg-emerald-600', label: t.inventoryAlertPriorityLow }
  } as const;

  const statsQuery = useQuery({
    queryKey: ['dashboard', 'overview', 'v1'],
    queryFn: ({ signal }) => dashboardService.getStats({ signal }),
  });
  const trendsQuery = useQuery({
    queryKey: ['dashboard', 'trends', 'v1'],
    queryFn: ({ signal }) => dashboardService.getTrends({ signal }),
  });

  useEffect(() => {
    const statsData = statsQuery.data;
    if (!statsData) return;

    const { overview, monthly } = statsData;

    const dynamicTasks: DashboardTask[] = [];
    if (overview.overdueAmount > 0) {
      dynamicTasks.push({ time: '09:00', title: t.taskCollection || '催收逾期款项', type: t.historyTab, color: 'bg-rose-100 text-rose-600' });
    }
    if (overview.pendingShipments > 0) {
      dynamicTasks.push({ time: '10:30', title: t.taskFollowUp || '跟进待发货订单', type: t.timelineShipping, color: 'bg-blue-100 text-blue-600' });
    }
    if (overview.pendingCommissions > 0) {
      dynamicTasks.push({ time: '14:00', title: t.taskAudit || '审核提成申请', type: t.performanceReport, color: 'bg-amber-100 text-amber-600' });
    }
    if (overview.riskCustomers > 0) {
      dynamicTasks.push({ time: '16:00', title: t.taskRisk || '评估高风险客户', type: t.riskCheck, color: 'bg-purple-100 text-purple-600' });
    }
    applyOverviewSnapshot({
      stats: {
        monthlyRevenue: monthly.revenue,
        overdueAmount: overview.overdueAmount || 0,
        activeShipments: overview.pendingShipments,
        totalCustomers: overview.totalCustomers,
        pendingCommissions: overview.pendingCommissions || 0,
        riskCustomers: overview.riskCustomers || 0,
      },
      tasks: dynamicTasks.length > 0 ? dynamicTasks : [
        { time: '09:00', title: t.taskSystem || '检查系统更新', type: t.systemReady, color: 'bg-slate-100 text-slate-600' },
      ],
      inventoryAlerts: statsData.inventoryAlerts || [],
      systemStatus: statsData.systemStatus,
    });
  }, [applyOverviewSnapshot, statsQuery.data, t]);

  useEffect(() => {
    setChartDataFromTrends(trendsQuery.data || []);
  }, [setChartDataFromTrends, trendsQuery.data]);

  useEffect(() => {
    if (!statsQuery.isError && !trendsQuery.isError) return;
    notify('error', '经营驾驶舱加载失败，请刷新后再核对收入、库存和待办数据。');
  }, [notify, statsQuery.isError, trendsQuery.isError]);

  useEffect(() => {
    const el = chartWrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      setChartBox({
        width: Math.max(0, Math.floor(rect.width)),
        height: Math.max(0, Math.floor(rect.height)),
      });
    };

    update();
    const observer = new ResizeObserver(() => update());
    observer.observe(el);
    return () => observer.disconnect();
  }, [setChartBox]);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
      {/* System Status Ticker */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/10 dark:to-indigo-900/10 border border-blue-100 dark:border-blue-900/20 rounded-2xl p-5 flex items-center justify-between px-6 lg:px-8">
        <div className="flex items-center gap-5">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-300/50 dark:shadow-none">
            <Zap size={20} className="fill-current" />
          </div>
          <div>
            <p className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">{t.systemReady}</p>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mt-1">{t.healthCheck}</p>
          </div>
        </div>
        <div className="hidden md:flex gap-12">
          <div className="flex flex-col items-end">
            <span className="text-xs font-black text-slate-400 uppercase tracking-wider">{t.serverLoad}</span>
            <span className="text-xs font-black text-blue-600 italic">{systemStatus.load}</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-xs font-black text-slate-400 uppercase tracking-wider">{t.activeSessions}</span>
            <span className="text-xs font-black text-blue-600 italic">{systemStatus.sessions}</span>
          </div>
        </div>
      </div>

      <section>
        <div className="flex items-center justify-between mb-6 px-2">
          <h2 className="text-xl font-black text-slate-800 dark:text-white flex items-center tracking-tighter italic uppercase">
            {t.quickHub}
          </h2>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3 lg:gap-6">
          <QuickAction icon={Users} label={t.addCustomer} color="bg-blue-500" onClick={() => window.location.hash = '#crm'} />
          <QuickAction icon={FileText} label={t.createInvoice} color="bg-indigo-500" onClick={() => window.location.hash = '#orders'} />
          <QuickAction icon={Package} label={t.assets} color="bg-emerald-500" onClick={() => window.location.hash = '#assets'} />
          <QuickAction icon={ShieldAlert} label={t.riskCheck} color="bg-amber-500" onClick={() => window.location.hash = '#risk'} />
          <QuickAction icon={TrendingUp} label={t.performanceReport} color="bg-slate-700" onClick={() => window.location.hash = '#financeAnalytics'} />
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-8">
        <StatCard title={t.monthlySales} value={formatPrice(stats.monthlyRevenue)} sub={t.totalYtd || '年度累计'} icon={DollarSign} color="bg-blue-500" />
        <StatCard title={t.overduePayments} value={formatPrice(stats.overdueAmount || 0)} sub={`${(stats.overdueAmount || 0) > 0 ? (t.actionReq || '需要处理') : (t.clean || '正常')}`} icon={AlertTriangle} color="bg-rose-500" />
        <StatCard title={t.shipping} value={stats.activeShipments} sub={t.activeShipmentsDesc || '在途发运'} icon={Package} color="bg-indigo-500" />
        <StatCard title={t.activeCustomers} value={stats.totalCustomers} sub={t.totalClients || '客户总数'} icon={Users} color="bg-teal-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm relative overflow-hidden">
          <div className="mb-8">
            <h3 className="text-lg font-black text-slate-800 dark:text-white tracking-tighter italic uppercase">{t.revenueTrend}</h3>
            <p className="text-xs text-slate-400 font-black uppercase tracking-wider mt-1">{t.monitoringGrowth}</p>
          </div>
          <div ref={chartWrapRef} className="h-64 lg:h-80 w-full min-w-0">
            {chartBox.width > 0 && chartBox.height > 0 ? (
              <ResponsiveContainer width={chartBox.width} height={chartBox.height} minWidth={0} minHeight={0}>
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme === 'dark' ? '#1e293b' : '#f1f5f9'} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }} />
                  <Tooltip
                    cursor={{ fill: theme === 'dark' ? '#0f172a' : '#f8fafc', radius: 8 }}
                    contentStyle={{ borderRadius: '16px', border: 'none', backgroundColor: theme === 'dark' ? '#1e293b' : '#fff', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', padding: '12px' }}
                    formatter={(value?: number) => [formatPrice(value || 0), '']}
                  />
                  <Bar dataKey="revenue" fill="#3b82f6" radius={[6, 6, 0, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full w-full rounded-[28px] border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 flex items-center justify-center text-xs font-black uppercase  text-slate-400">
                {t.loading || 'Loading'}
              </div>
            )}
          </div>
        </div>

        <div className="bg-slate-50 dark:bg-slate-900 p-8 rounded-2xl border border-slate-100 dark:border-slate-800">
          <div className="mb-8">
            <h3 className="text-lg font-black text-slate-800 dark:text-white tracking-tighter italic uppercase">{t.upcomingTasks}</h3>
            <p className="text-xs text-slate-400 font-black uppercase tracking-wider mt-1">{t.next48Hours}</p>
          </div>
          <div className="space-y-4">
            {tasks.map((event, i) => (
              <div key={i} className="flex items-center gap-4 p-4 bg-white dark:bg-slate-800 rounded-[24px] shadow-sm hover:translate-x-1 transition-transform">
                <div className={`w-2 h-12 rounded-full ${event.color.split(' ')[0]} flex-shrink-0`}></div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-black text-slate-400 uppercase tracking-wider whitespace-nowrap">{event.type}</span>
                    <span className="text-xs font-bold text-slate-400 whitespace-nowrap ml-2">{event.time}</span>
                  </div>
                  <p className="text-sm font-black text-slate-700 dark:text-slate-200 truncate">{event.title}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-10">
        <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-100 dark:border-slate-800">
          <div className="mb-6">
            <h3 className="text-lg font-black text-slate-800 dark:text-white tracking-tighter italic uppercase">{t.inventoryAlertTitle}</h3>
            <p className="text-xs text-slate-400 font-black uppercase tracking-wider mt-1">{t.inventoryAlertSubtitle}</p>
          </div>
          <div className="space-y-4">
            {inventoryAlerts.map((item, i) => {
              const meta = priorityMeta[item.priority] || priorityMeta.low;
              return (
                <div key={i} className="flex items-center gap-4 bg-slate-50 dark:bg-slate-800 rounded-[24px] p-4">
                  <div className={`p-3 rounded-[18px] ${meta.color} text-white shadow-md`}>
                    <AlertTriangle size={16} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-black text-slate-800 dark:text-slate-200">{item.name}（{item.sku}）</p>
                      <span className="text-xs font-black uppercase bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded-full text-slate-600 dark:text-slate-300">{meta.label}</span>
                    </div>
                    <p className="text-xs text-slate-400 font-bold uppercase mt-1">{t.inventoryAlertStock} {item.stock} 件 {t.inventoryAlertReorderPoint} {item.reorderPoint} 件 {t.inventoryAlertPendingOrders} {item.pendingOrders} 单 {t.inventoryAlertDaysOfStock} {item.daysOfStock}</p>
                    <p className="text-xs text-slate-500 mt-2">{item.suggestion}</p>
                  </div>
                </div>
              );
            })}
            {inventoryAlerts.length === 0 && (
              <div className="text-xs text-slate-400 font-bold uppercase">{t.inventoryAlertNone}</div>
            )}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-10">
        <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-100 dark:border-slate-800">
          <div className="mb-6">
            <h3 className="text-lg font-black text-slate-800 dark:text-white tracking-tighter italic uppercase">{t.recommendationReport}</h3>
            <p className="text-xs text-slate-400 font-black uppercase tracking-wider mt-1">{t.reportSubtitle}</p>
          </div>
          <div className="space-y-4">
            {recommendations.map((item, i) => (
              <div key={i} className="bg-slate-50 dark:bg-slate-800 rounded-[24px] p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-black text-slate-800 dark:text-slate-200">{item.title}</p>
                  <span className="text-xs font-black uppercase text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-1 rounded-full">{item.impact}</span>
                </div>
                <p className="text-xs text-slate-400 font-bold mt-2 uppercase">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-100 dark:border-slate-800">
          <div className="mb-6">
            <h3 className="text-lg font-black text-slate-800 dark:text-white tracking-tighter italic uppercase">{t.biEnhancement}</h3>
            <p className="text-xs text-slate-400 font-black uppercase tracking-wider mt-1">{t.biSubtitle}</p>
          </div>
          <div className="space-y-4">
            {biRoadmap.map((item, i) => (
              <div key={i} className="flex items-center gap-4 bg-slate-50 dark:bg-slate-800 rounded-[24px] p-4">
                <div className="p-3 rounded-[18px] bg-blue-600 text-white shadow-md">
                  <Zap size={16} />
                </div>
                <div>
                  <p className="text-sm font-black text-slate-800 dark:text-slate-200">{item.title}</p>
                  <p className="text-xs text-slate-400 font-bold uppercase mt-1">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;

