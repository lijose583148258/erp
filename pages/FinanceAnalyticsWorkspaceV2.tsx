import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, RefreshCcw, TrendingUp, ReceiptText, Clock3, AlertTriangle, WalletCards, ShieldCheck, Users2, FileText } from 'lucide-react';
import { useAppContext } from '../app/AppContext';
import { financeAnalyticsService, FinanceWorkspace } from '../services/financeAnalytics.service';
import FinanceLedgerPanel from './finance/FinanceLedgerPanel';
import FinanceCashflowPanel from './finance/FinanceCashflowPanel';
import ReceivableAdjustmentPanel from './finance/ReceivableAdjustmentPanel';
import { getCustomerDisplayName } from '../utils/customerName';

const FinanceAnalyticsWorkspaceV2: React.FC = () => {
  const { t, notify, formatPrice, language } = useAppContext();
  const [workspace, setWorkspace] = useState<FinanceWorkspace | null>(null);
  const [loading, setLoading] = useState(false);
  const isInitialLoading = loading && !workspace;

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    try {
      const data = await financeAnalyticsService.getWorkspace();
      setWorkspace(data);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : (t.loadDataFail || 'Failed to load financial data'));
    } finally {
      setLoading(false);
    }
  }, [notify, t.loadDataFail]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const summary = workspace?.summary;
  const ledger = workspace?.ledger;
  const cashflow = workspace?.cashflow;
  const overview = summary?.overview;
  const trendRows = summary?.monthlyTrend || [];
  const maxTrendAmount = Math.max(1, ...trendRows.map((item) => Math.max(item.revenue, item.received, item.outstanding, item.overdue)));

  const customerLabel = (row: { customerName?: string; customerNameZh?: string | null; customerNameEn?: string | null; customerNameVi?: string | null }) => getCustomerDisplayName({
    name: row.customerName || '',
    nameZh: row.customerNameZh || undefined,
    nameEn: row.customerNameEn || undefined,
    nameVi: row.customerNameVi || undefined,
  }, language);

  // KPI 卡片标题均使用 t() 国际化，不再硬编码
  const statCards = useMemo(() => ([
    { title: t.totalYtd || 'Total Revenue', value: isInitialLoading ? '…' : (overview ? formatPrice(overview.totalRevenue) : formatPrice(0)), color: 'bg-blue-600', icon: <TrendingUp size={24} /> },
    { title: t.monthlySales || 'Total Received', value: isInitialLoading ? '…' : (overview ? formatPrice(overview.totalReceived) : formatPrice(0)), color: 'bg-emerald-500', icon: <WalletCards size={24} /> },
    { title: t.balanceTracking || 'Receivables', value: isInitialLoading ? '…' : (overview ? formatPrice(overview.totalReceivable) : formatPrice(0)), color: 'bg-cyan-500', icon: <ReceiptText size={24} /> },
    { title: t.overduePayments || 'Overdue', value: isInitialLoading ? '…' : (overview ? formatPrice(overview.overdueAmount) : formatPrice(0)), color: 'bg-rose-500', icon: <AlertTriangle size={24} /> },
    { title: t.targetAchievement || 'Payment Rate', value: isInitialLoading ? '…' : (overview ? `${Math.round(overview.paymentRate * 100)}%` : '0%'), color: 'bg-violet-500', icon: <ShieldCheck size={24} /> },
    { title: t.paymentPending || 'Pending', value: isInitialLoading ? '…' : (overview?.pendingVerificationCount ?? 0), color: 'bg-amber-500', icon: <Clock3 size={24} /> },
    { title: t.adjustment || 'Adj. Net', value: isInitialLoading ? '…' : (overview ? formatPrice(overview.adjustmentNetAmount) : formatPrice(0)), color: 'bg-slate-700', icon: <FileText size={24} /> },
    { title: t.activeCustomers || 'Credit Holds', value: isInitialLoading ? '…' : (overview?.creditHoldCustomerCount ?? 0), color: 'bg-indigo-600', icon: <Users2 size={24} /> },
  ]), [formatPrice, isInitialLoading, overview, t]);

  // 使用 t() 国际化状态标签
  const paymentStatusLabel = (status: string) => {
    const map: Record<string, string> = {
      verified: t.paymentVerified || 'Verified',
      pending: t.paymentPending || 'Pending',
      posted: t.contractActive || 'Posted',
      reversed: t.ledgerReversed || 'Reversed',
    };
    return map[status] || status;
  };

  const adjustmentStatusLabel = (status: string) => {
    const map: Record<string, string> = {
      posted: t.ledgerPosted || 'Posted',
      pending: t.paymentPending || 'Pending',
      reversed: t.ledgerReversed || 'Reversed',
    };
    return map[status] || status;
  };

  const exportCsv = (rows: Array<Record<string, string | number | null | undefined>>, filename: string) => {
    if (!rows.length) return notify('warning', t.emptyState || 'No data to export');
    const headers = Object.keys(rows[0]);
    const escape = (value: string | number | null | undefined) => {
      const text = value === null || value === undefined ? '' : String(value);
      return `"${text.replace(/"/g, '""')}"`;
    };
    const csv = [headers.join(','), ...rows.map((row) => headers.map((key) => escape(row[key])).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 账龄标签（国际化友好的中性标签）
  const agingLabels = [
    { key: 'current', label: t.agingCurrent || 'Current' },
    { key: '1_7', label: t.aging1_7 || '1–7 days' },
    { key: '8_15', label: t.aging8_15 || '8–15 days' },
    { key: '16_30', label: t.aging16_30 || '16–30 days' },
    { key: '31_60', label: t.aging31_60 || '31–60 days' },
    { key: '60_plus', label: t.aging60plus || '60+ days' },
  ];

  // 趋势图行标签
  const trendLabels = {
    revenue: t.income || 'Revenue',
    received: t.monthlySales || 'Received',
    outstanding: t.balanceTracking || 'Outstanding',
    overdue: t.overduePayments || 'Overdue',
  };

  return (
    <div className="space-y-10 pb-16 animate-in fade-in slide-in-from-bottom-4 duration-1000">
      {/* 页面头部 */}
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-4xl font-black tracking-tighter italic bg-gradient-to-br from-slate-900 to-slate-500 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">
            {t.performanceReport || 'Finance & Operations'}
          </h1>
          <p className="text-blue-600 dark:text-blue-400 font-bold text-sm mt-3 opacity-80">
            {t.financeWorkspaceSub || 'Overview, ledger, cashflow & exports'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-2 rounded-[28px] border border-white/50 dark:border-slate-800 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <button onClick={() => void loadWorkspace()} className="flex items-center px-6 py-3 rounded-[22px] text-xs font-bold text-slate-400">
            <RefreshCcw size={16} className="mr-2.5" />{t.revenueTrend || 'Refresh'}
          </button>
          <button onClick={() => exportCsv(trendRows.map((row) => ({
            period: row.period,
            revenue: row.revenue,
            received: row.received,
            outstanding: row.outstanding,
            overdue: row.overdue,
            orderCount: row.orderCount,
          })), 'finance-trend.csv')} className="flex items-center px-6 py-3 rounded-[22px] text-xs font-bold bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-xl shadow-blue-500/30 active-shrink">
            <Download size={16} className="mr-2.5" />{t.export || 'Export CSV'}
          </button>
        </div>
      </div>

      {/* KPI 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-8">
        {statCards.map((card) => (
          <div key={card.title} className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-8 rounded-[40px] border border-white/50 dark:border-slate-800 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.02)]">
            <div className={`p-4 ${card.color} text-white rounded-[22px] shadow-xl shadow-current/20 w-fit mb-8`}>{card.icon}</div>
            <p className="text-xs font-bold text-slate-400">{card.title}</p>
            <p className="text-3xl font-black text-slate-900 dark:text-white tracking-tighter mt-2 break-words">{card.value}</p>
          </div>
        ))}
      </div>

      {/* 趋势图 + 账龄/洞察侧栏 */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
        <section className="xl:col-span-8 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.03)] overflow-hidden p-8 space-y-8">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-2xl font-black tracking-tighter italic flex items-center">
              <div className="w-2 h-8 bg-blue-600 rounded-full mr-4" />{t.revenueTrend || 'Revenue Trend'}
            </h2>
            <div className="text-xs font-bold text-slate-400 bg-slate-100 dark:bg-slate-800 px-4 py-2 rounded-full">
              {isInitialLoading ? (t.loading || '…') : `${trendRows.length} ${t.month || 'mo.'}`}
            </div>
          </div>

          <div className="space-y-4">
            {isInitialLoading ? (
              <div className="rounded-[28px] border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50 p-6 text-center text-xs font-bold text-slate-400">
                {t.loading || 'Loading…'}
              </div>
            ) : (
              trendRows.map((row) => (
                <div key={row.period} className="rounded-[28px] border border-slate-100 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-black text-slate-900 dark:text-white">{row.period}</div>
                      <div className="text-xs text-slate-400 mt-1">{row.orderCount} {t.records || 'orders'}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-xs font-bold text-slate-400">
                    {[
                      { key: 'revenue', value: row.revenue, color: 'bg-blue-600' },
                      { key: 'received', value: row.received, color: 'bg-emerald-500' },
                      { key: 'outstanding', value: row.outstanding, color: 'bg-cyan-500' },
                      { key: 'overdue', value: row.overdue, color: 'bg-rose-500' },
                    ].map(({ key, value, color }) => (
                      <div key={key} className="space-y-2">
                        <div className="flex justify-between gap-1">
                          <span>{trendLabels[key as keyof typeof trendLabels]}</span>
                          <span>{formatPrice(value)}</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                          <div className={`h-full ${color} rounded-full`} style={{ width: `${(value / maxTrendAmount) * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <aside className="xl:col-span-4 space-y-8">
          {/* 账龄结构 */}
          <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.03)] overflow-hidden p-8 space-y-5">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-2xl font-black tracking-tighter italic flex items-center"><div className="w-2 h-8 bg-blue-600 rounded-full mr-4" />{t.agingTitle || 'Aging'}</h2>
            </div>
            {isInitialLoading ? (
              <div className="rounded-[24px] border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/60 p-4 text-center text-xs font-bold text-slate-400">
                {t.loading || 'Loading…'}
              </div>
            ) : summary ? (
              <div className="space-y-3">
                {agingLabels.map(({ key, label }) => {
                  const value = (summary.agingBuckets as Record<string, number>)[key] || 0;
                  return (
                    <div key={key} className="space-y-1.5">
                      <div className="flex justify-between text-xs font-bold text-slate-400">
                        <span>{label}</span>
                        <span>{formatPrice(value)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-blue-600 to-cyan-500 rounded-full" style={{ width: `${Math.min(100, (value / Math.max(1, summary.overview.totalReceivable)) * 100)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-[24px] border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/60 p-4 text-center text-xs font-bold text-slate-400">
                {t.emptyState || 'No data'}
              </div>
            )}
          </div>

          {/* 经营洞察 */}
          <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.03)] overflow-hidden p-8 space-y-5">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-2xl font-black tracking-tighter italic flex items-center"><div className="w-2 h-8 bg-blue-600 rounded-full mr-4" />{t.smartInsight || 'Insights'}</h2>
            </div>
            <div className="space-y-3">
              {isInitialLoading ? (
                <div className="rounded-[24px] border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/60 p-4 text-center text-xs font-bold text-slate-400">
                  {t.loading || 'Loading…'}
                </div>
              ) : (summary?.insights || []).length ? (
                (summary?.insights || []).map((insight, index) => (
                  <div key={index} className="rounded-[24px] border border-slate-100 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/60 p-4 text-sm font-bold text-slate-700 dark:text-slate-200 leading-7">{insight}</div>
                ))
              ) : (
                <div className="rounded-[24px] border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/60 p-4 text-center text-xs font-bold text-slate-400">
                  {t.emptyState || 'No data'}
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      <ReceivableAdjustmentPanel onChanged={loadWorkspace} />

      {/* 最近收款 & 最近调账 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        {/* 收款表 */}
        <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.03)] overflow-hidden p-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-black tracking-tighter italic flex items-center"><div className="w-2 h-8 bg-blue-600 rounded-full mr-4" />{t.history || 'Recent Payments'}</h2>
            <div className="text-xs font-bold text-slate-400 bg-slate-100 dark:bg-slate-800 px-4 py-2 rounded-full">{isInitialLoading ? '…' : `${summary?.recentPayments.length || 0}`}</div>
          </div>
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-left">
              <thead><tr className="border-b border-slate-100/50 dark:border-slate-800">
                <Th>{t.id || 'ID'}</Th><Th>{t.orderNo || 'Order'}</Th><Th>{t.customer || 'Customer'}</Th><Th>{t.amount || 'Amount'}</Th><Th>{t.status || 'Status'}</Th>
              </tr></thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
                {isInitialLoading ? (
                  <tr><td colSpan={5} className="py-8 text-center text-xs font-bold text-slate-400">{t.loading || 'Loading…'}</td></tr>
                ) : (summary?.recentPayments || []).length ? (
                  (summary?.recentPayments || []).map((record) => (
                    <tr key={record.id} className="hover:bg-blue-50/20 dark:hover:bg-blue-900/5 transition-all">
                      <Td mono>{record.id}</Td><Td>{record.orderNo}</Td><Td>{customerLabel(record)}</Td><Td>{formatPrice(record.amount)}</Td><Td>{paymentStatusLabel(record.status)}</Td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan={5} className="py-8 text-center text-xs font-bold text-slate-400">{t.emptyState || 'No records'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 调账表 */}
        <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.03)] overflow-hidden p-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-black tracking-tighter italic flex items-center"><div className="w-2 h-8 bg-blue-600 rounded-full mr-4" />{t.adjustment || 'Recent Adjustments'}</h2>
            <div className="text-xs font-bold text-slate-400 bg-slate-100 dark:bg-slate-800 px-4 py-2 rounded-full">{isInitialLoading ? '…' : `${summary?.recentAdjustments.length || 0}`}</div>
          </div>
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-left">
              <thead><tr className="border-b border-slate-100/50 dark:border-slate-800">
                <Th>{t.id || 'No.'}</Th><Th>{t.customer || 'Entity'}</Th><Th>{t.amount || 'Delta'}</Th><Th>{t.notes || 'Reason'}</Th><Th>{t.status || 'Status'}</Th>
              </tr></thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
                {isInitialLoading ? (
                  <tr><td colSpan={5} className="py-8 text-center text-xs font-bold text-slate-400">{t.loading || 'Loading…'}</td></tr>
                ) : (summary?.recentAdjustments || []).length ? (
                  (summary?.recentAdjustments || []).map((record) => (
                    <tr key={record.id} className="hover:bg-blue-50/20 dark:hover:bg-blue-900/5 transition-all">
                      <Td mono>{record.adjustmentNo}</Td>
                      <Td>
                        <div className="font-bold text-slate-900 dark:text-white text-sm">{record.targetRef || record.orderNo || record.batchNo || '—'}</div>
                        <div className="text-xs text-slate-400 mt-1">{customerLabel(record)}</div>
                      </Td>
                      <Td>{Number(record.amountDelta || record.quantityDelta || 0) >= 0 ? '+' : ''}{record.amountDelta ?? record.quantityDelta ?? 0}</Td>
                      <Td><div className="text-sm font-bold text-slate-900 dark:text-white">{record.reason}</div><div className="text-xs text-slate-400 mt-1">{record.domain}</div></Td>
                      <Td>{adjustmentStatusLabel(record.status)}</Td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan={5} className="py-8 text-center text-xs font-bold text-slate-400">{t.emptyState || 'No records'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 财务台账 + 现金流面板 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <FinanceLedgerPanel data={ledger} />
        <FinanceCashflowPanel data={cashflow} />
      </div>
    </div>
  );
};

const Th = ({ children }: { children: React.ReactNode }) => <th className="py-4 px-3 text-xs font-bold text-slate-400 whitespace-nowrap">{children}</th>;
const Td = ({ children, mono = false, className = '' }: { children: React.ReactNode; mono?: boolean; className?: string }) => <td className={`py-4 px-3 text-sm text-slate-700 dark:text-slate-200 ${mono ? 'font-mono text-xs' : 'font-bold'} ${className}`}>{children}</td>;

export default FinanceAnalyticsWorkspaceV2;
