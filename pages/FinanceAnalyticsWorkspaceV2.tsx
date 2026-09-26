import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, RefreshCcw, TrendingUp, ReceiptText, Clock3, AlertTriangle, WalletCards, ShieldCheck, Users2, FileText } from 'lucide-react';
import { useAppContext } from '../app/AppContext';
import { DocumentInputGuide } from '../components/ui/DocumentInputGuide';
import { financeAnalyticsService, FinanceWorkspace } from '../services/financeAnalytics.service';
import FinanceLedgerPanel from './finance/FinanceLedgerPanel';
import FinanceCashflowPanel from './finance/FinanceCashflowPanel';
import ReceivableAdjustmentPanel from './finance/ReceivableAdjustmentPanel';
import { MobileRecordCard, MobileRecordState } from '../components/ui/MobileRecordCard';
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
      notify('error', error instanceof Error ? error.message : (t.loadDataFail || '财务数据加载失败'));
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

  const customerLabel = (row: { customerName?: string | null; customerNameZh?: string | null; customerNameEn?: string | null; customerNameVi?: string | null }) => getCustomerDisplayName({
    name: row.customerName || '',
    nameZh: row.customerNameZh || undefined,
    nameEn: row.customerNameEn || undefined,
    nameVi: row.customerNameVi || undefined,
  }, language);

  const statCards = useMemo(() => ([
    { title: t.totalYtd || '累计收入', value: isInitialLoading ? '--' : (overview ? formatPrice(overview.totalRevenue) : formatPrice(0)), color: 'bg-blue-600', icon: <TrendingUp size={24} /> },
    { title: t.monthlySales || '累计回款', value: isInitialLoading ? '--' : (overview ? formatPrice(overview.totalReceived) : formatPrice(0)), color: 'bg-emerald-500', icon: <WalletCards size={24} /> },
    { title: t.balanceTracking || '应收余额', value: isInitialLoading ? '--' : (overview ? formatPrice(overview.totalReceivable) : formatPrice(0)), color: 'bg-cyan-500', icon: <ReceiptText size={24} /> },
    { title: t.overduePayments || '逾期金额', value: isInitialLoading ? '--' : (overview ? formatPrice(overview.overdueAmount) : formatPrice(0)), color: 'bg-rose-500', icon: <AlertTriangle size={24} /> },
    { title: t.targetAchievement || '回款率', value: isInitialLoading ? '--' : (overview ? `${Math.round(overview.paymentRate * 100)}%` : '0%'), color: 'bg-violet-500', icon: <ShieldCheck size={24} /> },
    { title: t.paymentPending || '待核验', value: isInitialLoading ? '--' : (overview?.pendingVerificationCount ?? 0), color: 'bg-amber-500', icon: <Clock3 size={24} /> },
    { title: t.adjustment || '调整净额', value: isInitialLoading ? '--' : (overview ? formatPrice(overview.adjustmentNetAmount) : formatPrice(0)), color: 'bg-slate-700', icon: <FileText size={24} /> },
    { title: t.activeCustomers || '风控客户', value: isInitialLoading ? '--' : (overview?.creditHoldCustomerCount ?? 0), color: 'bg-indigo-600', icon: <Users2 size={24} /> },
  ]), [formatPrice, isInitialLoading, overview, t]);

  const paymentStatusLabel = (status: string) => ({
    verified: t.paymentVerified || '已核验',
    pending: t.paymentPending || '待确认',
    posted: t.ledgerPosted || '已过账',
    reversed: t.ledgerReversed || '已冲回',
  }[status] || status);

  const adjustmentStatusLabel = (status: string) => ({
    posted: t.ledgerPosted || '已过账',
    pending: t.paymentPending || '待确认',
    reversed: t.ledgerReversed || '已冲回',
  }[status] || status);

  const exportCsv = (rows: Array<Record<string, string | number | null | undefined>>, filename: string) => {
    if (!rows.length) return notify('warning', t.emptyState || '暂无可导出数据');
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

  const agingLabels = [
    { key: 'current', label: t.agingCurrent || '未逾期' },
    { key: '1_7', label: t.aging1_7 || '1-7 天' },
    { key: '8_15', label: t.aging8_15 || '8-15 天' },
    { key: '16_30', label: t.aging16_30 || '16-30 天' },
    { key: '31_60', label: t.aging31_60 || '31-60 天' },
    { key: '60_plus', label: t.aging60plus || '60 天以上' },
  ];

  const trendLabels = {
    revenue: t.income || '收入',
    received: t.monthlySales || '回款',
    outstanding: t.balanceTracking || '应收',
    overdue: t.overduePayments || '逾期',
  };

  return (
    <div className="space-y-8 pb-16 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">
            {t.performanceReport || '财务经营分析'}
          </h1>
          <p className="mt-2 text-sm font-bold text-slate-600 dark:text-slate-300">
            {t.financeWorkspaceSub || '看经营结果、查财务流水、处理应收调整与现金流。'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 rounded-[16px] border border-slate-200 bg-white/80 p-2 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
          <button onClick={() => void loadWorkspace()} className="flex items-center rounded-[12px] px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800">
            <RefreshCcw size={16} className="mr-2.5" />刷新
          </button>
          <button onClick={() => exportCsv(trendRows.map((row) => ({
            period: row.period,
            revenue: row.revenue,
            received: row.received,
            outstanding: row.outstanding,
            overdue: row.overdue,
            orderCount: row.orderCount,
          })), 'finance-trend.csv')} className="flex items-center rounded-[12px] bg-blue-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm">
            <Download size={16} className="mr-2.5" />{t.export || '导出 CSV'}
          </button>
        </div>
      </div>

      <DocumentInputGuide
        testId="finance-document-input-guide"
        eyebrow="财务经营 / 单据职责路线"
        title="先看经营结果，再进入正确的单据动作"
        description="财务经营页是分析与应收调整入口，真实收款核销仍在回款中心。看板只看经营结果；折让、坏账、短款、汇差进入应收调整；库存或生产差异不在财务页直接改。"
        tone="emerald"
        steps={[
          { title: '经营看板', description: '查看收入、已收、应收、逾期、账龄和现金流，不在看板里直接改钱。', badge: '看结果' },
          { title: '真实回款', description: '客户实际付款、分批回款、核验到账，必须进入回款中心处理。', badge: '回款' },
          { title: '应收调整', description: '折让、坏账、短款、汇差先建调整单，再过账影响有效应收。', badge: '调账' },
          { title: '回读对账', description: '保存、过账、冲回后必须回读订单、台账、账龄和最近记录，确认数据没有丢。', badge: '证据' },
        ]}
        boundaries={[
          { title: '财务页可以做', items: ['经营分析', '账龄查看', '应收调整', '过账/冲回', '现金流台账'] },
          { title: '财务页不直接做', items: ['客户真实付款核验', '库存出入库', '生产完工扣料', '采购收货', '货抵批次交付'] },
        ]}
        evidence={['订单应收更新', '台账能查到', '账龄同步变化', '冲回保留痕迹']}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {statCards.map((card) => (
          <div key={card.title} className="min-w-0 rounded-[18px] border border-slate-200 bg-white/80 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
            <div className={`mb-4 flex h-11 w-11 items-center justify-center rounded-[14px] ${card.color} text-white`}>{card.icon}</div>
            <p className="text-xs font-bold text-slate-600 dark:text-slate-300">{card.title}</p>
            <p className="mt-2 whitespace-nowrap text-xl font-black tabular-nums text-slate-900 dark:text-white">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <section className="rounded-[20px] border border-slate-200 bg-white/70 p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/70 xl:col-span-2">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-xl font-black text-slate-900 dark:text-white">{t.revenueTrend || '收入与回款趋势'}</h2>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{trendRows.length} 期</span>
          </div>
          <div className="space-y-4">
            {(trendRows.length ? trendRows : [{ period: '--', revenue: 0, received: 0, outstanding: 0, overdue: 0, orderCount: 0 }]).map((row) => (
              <div key={row.period} className="rounded-[14px] border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-800/40">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-bold text-slate-900 dark:text-white">{row.period}</span>
                  <span className="text-xs font-bold text-slate-600 dark:text-slate-300">{row.orderCount} 单</span>
                </div>
                <TrendBar label={trendLabels.revenue} value={row.revenue} max={maxTrendAmount} color="bg-blue-600" formatPrice={formatPrice} />
                <TrendBar label={trendLabels.received} value={row.received} max={maxTrendAmount} color="bg-emerald-500" formatPrice={formatPrice} />
                <TrendBar label={trendLabels.outstanding} value={row.outstanding} max={maxTrendAmount} color="bg-cyan-500" formatPrice={formatPrice} />
                <TrendBar label={trendLabels.overdue} value={row.overdue} max={maxTrendAmount} color="bg-rose-500" formatPrice={formatPrice} />
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[20px] border border-slate-200 bg-white/70 p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
          <h2 className="mb-5 text-xl font-black text-slate-900 dark:text-white">{t.agingTitle || '应收账龄'}</h2>
          <div className="space-y-3">
            {agingLabels.map(({ key, label }) => {
              const value = Number(summary?.agingBuckets?.[key as keyof typeof summary.agingBuckets] || 0);
              return (
                <div key={key}>
                  <div className="mb-1 flex justify-between text-xs font-bold text-slate-600 dark:text-slate-300">
                    <span>{label}</span>
                    <span>{formatPrice(value)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.min(100, (value / Math.max(1, overview?.totalReceivable || 1)) * 100)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <RecentPaymentsTable
          rows={summary?.recentPayments || []}
          loading={isInitialLoading}
          t={t}
          formatPrice={formatPrice}
          customerLabel={customerLabel}
          statusLabel={paymentStatusLabel}
        />
        <RecentAdjustmentsTable
          rows={summary?.recentAdjustments || []}
          loading={isInitialLoading}
          t={t}
          customerLabel={customerLabel}
          statusLabel={adjustmentStatusLabel}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <FinanceLedgerPanel data={ledger} />
        <FinanceCashflowPanel data={cashflow} />
      </div>

      <ReceivableAdjustmentPanel />
    </div>
  );
};

const TrendBar = ({ label, value, max, color, formatPrice }: { label: string; value: number; max: number; color: string; formatPrice: (value: number) => string }) => (
  <div className="grid grid-cols-[76px_minmax(0,1fr)_110px] items-center gap-2 text-xs">
    <span className="font-bold text-slate-600 dark:text-slate-300">{label}</span>
    <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
    </div>
    <span className="text-right font-bold text-slate-700 dark:text-slate-200">{formatPrice(value)}</span>
  </div>
);

const RecentPaymentsTable = ({ rows, loading, t, formatPrice, customerLabel, statusLabel }: any) => (
  <section className="rounded-[20px] border border-slate-200 bg-white/70 p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
    <h2 className="mb-5 text-xl font-black text-slate-900 dark:text-white">{t.historyTab || '最近回款'}</h2>
    <div data-mobile-card-list className="space-y-3 md:hidden">
      {loading ? <MobileRecordState text={t.loading || '正在加载...'} /> : rows.length ? rows.map((record: any) => (
        <MobileRecordCard
          key={record.id}
          title={record.orderNo || `#${record.id}`}
          subtitle={customerLabel(record)}
          status={statusLabel(record.status)}
          fields={[
            { label: t.id || '编号', value: record.id, mono: true },
            { label: t.amount || '金额', value: formatPrice(record.amount), tone: 'positive' },
          ]}
        />
      )) : <MobileRecordState text={t.emptyState || '暂无记录'} />}
    </div>
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full text-left">
        <thead><tr><Th>{t.id || '编号'}</Th><Th>{t.orderNo || '订单'}</Th><Th>{t.customer || '客户'}</Th><Th>{t.amount || '金额'}</Th><Th>{t.status || '状态'}</Th></tr></thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {loading ? <EmptyRow colSpan={5} text={t.loading || '正在加载...'} /> : rows.length ? rows.map((record: any) => (
            <tr key={record.id}>
              <Td mono>{record.id}</Td><Td>{record.orderNo}</Td><Td>{customerLabel(record)}</Td><Td>{formatPrice(record.amount)}</Td><Td>{statusLabel(record.status)}</Td>
            </tr>
          )) : <EmptyRow colSpan={5} text={t.emptyState || '暂无记录'} />}
        </tbody>
      </table>
    </div>
  </section>
);

const RecentAdjustmentsTable = ({ rows, loading, t, customerLabel, statusLabel }: any) => (
  <section className="rounded-[20px] border border-slate-200 bg-white/70 p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
    <h2 className="mb-5 text-xl font-black text-slate-900 dark:text-white">{t.adjustment || '最近调整'}</h2>
    <div data-mobile-card-list className="space-y-3 md:hidden">
      {loading ? <MobileRecordState text={t.loading || '正在加载...'} /> : rows.length ? rows.map((record: any) => {
        const delta = Number(record.amountDelta || record.quantityDelta || 0);
        return (
          <MobileRecordCard
            key={record.id}
            title={record.adjustmentNo || `#${record.id}`}
            subtitle={record.targetRef || record.orderNo || record.batchNo || customerLabel(record) || '--'}
            status={statusLabel(record.status)}
            fields={[
              { label: t.amount || '变动', value: `${delta >= 0 ? '+' : ''}${record.amountDelta ?? record.quantityDelta ?? 0}`, tone: delta >= 0 ? 'positive' : 'negative' },
              { label: t.notes || '原因', value: record.reason || '--', fullWidth: true },
              { label: '业务域', value: record.domain || '--' },
              { label: t.customer || '对象', value: customerLabel(record) || '--' },
            ]}
          />
        );
      }) : <MobileRecordState text={t.emptyState || '暂无记录'} />}
    </div>
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full text-left">
        <thead><tr><Th>{t.id || '编号'}</Th><Th>{t.customer || '对象'}</Th><Th>{t.amount || '变动'}</Th><Th>{t.notes || '原因'}</Th><Th>{t.status || '状态'}</Th></tr></thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {loading ? <EmptyRow colSpan={5} text={t.loading || '正在加载...'} /> : rows.length ? rows.map((record: any) => (
            <tr key={record.id}>
              <Td mono>{record.adjustmentNo}</Td>
              <Td><div className="font-bold text-slate-900 dark:text-white">{record.targetRef || record.orderNo || record.batchNo || '--'}</div><div className="text-xs text-slate-600 dark:text-slate-300">{customerLabel(record)}</div></Td>
              <Td>{Number(record.amountDelta || record.quantityDelta || 0) >= 0 ? '+' : ''}{record.amountDelta ?? record.quantityDelta ?? 0}</Td>
              <Td><div className="font-bold text-slate-900 dark:text-white">{record.reason}</div><div className="text-xs text-slate-600 dark:text-slate-300">{record.domain}</div></Td>
              <Td>{statusLabel(record.status)}</Td>
            </tr>
          )) : <EmptyRow colSpan={5} text={t.emptyState || '暂无记录'} />}
        </tbody>
      </table>
    </div>
  </section>
);

const EmptyRow = ({ colSpan, text }: { colSpan: number; text: string }) => (
  <tr><td colSpan={colSpan} className="py-8 text-center text-xs font-bold text-slate-600 dark:text-slate-300">{text}</td></tr>
);

const Th = ({ children }: { children: React.ReactNode }) => (
  <th className="px-3 py-3 text-xs font-bold text-slate-600 dark:text-slate-300">{children}</th>
);

const Td = ({ children, mono = false }: { children: React.ReactNode; mono?: boolean }) => (
  <td className={`px-3 py-3 text-sm font-bold text-slate-700 dark:text-slate-200 ${mono ? 'font-mono text-xs' : ''}`}>{children}</td>
);

export default FinanceAnalyticsWorkspaceV2;
