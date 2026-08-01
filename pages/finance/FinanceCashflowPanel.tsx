import React, { useMemo } from 'react';
import { Download, TrendingUp, WalletCards, CircleDollarSign, Clock3 } from 'lucide-react';
import { useAppContext } from '../../app/AppContext';
import { FinanceCashflowSummary } from '../../services/financeAnalytics.service';
import { exportFinanceCsv } from './finance.helpers';
import { MobileRecordCard, MobileRecordState } from '../../components/ui/MobileRecordCard';

interface FinanceCashflowPanelProps {
  data: FinanceCashflowSummary | null | undefined;
}

const FinanceCashflowPanel: React.FC<FinanceCashflowPanelProps> = ({ data }) => {
  const { notify, formatPrice, t } = useAppContext();
  const isLoading = data === undefined;
  const rows = data?.rows || [];

  const summaryCards = useMemo(() => ([
    { label: t.cashflowInflow || '总流入', value: isLoading ? '--' : formatPrice(data?.totalInflow || 0), icon: <TrendingUp size={18} /> },
    { label: t.cashflowOutflow || '总流出', value: isLoading ? '--' : formatPrice(data?.totalOutflow || 0), icon: <CircleDollarSign size={18} /> },
    { label: t.cashflowNet || '净现金流', value: isLoading ? '--' : formatPrice(data?.netCashflow || 0), icon: <WalletCards size={18} /> },
    { label: t.cashflowPending || '待确认回款', value: isLoading ? '--' : formatPrice(data?.pendingReceiptAmount || 0), icon: <Clock3 size={18} /> },
  ]), [data?.netCashflow, data?.pendingReceiptAmount, data?.totalInflow, data?.totalOutflow, formatPrice, isLoading, t]);

  const handleExport = () => {
    const success = exportFinanceCsv(rows.map((row) => ({
      period: row.period,
      inflow: row.inflow,
      outflow: row.outflow,
      net: row.net,
      receiptCount: row.receiptCount,
      adjustmentCount: row.adjustmentCount,
      pendingReceiptAmount: row.pendingReceiptAmount,
    })), 'finance-cashflow.csv');

    if (!success) {
      notify('warning', t.cashflowNoExport || '暂无可导出的现金流数据');
    }
  };

  return (
    <section className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[24px] border border-white/50 dark:border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.03)] overflow-hidden p-6 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-black tracking-tight flex items-center">
            <div className="w-2 h-8 bg-emerald-500 rounded-full mr-4" />{t.cashflowTitle || '现金流概览'}
          </h3>
          <p className="text-xs font-bold text-slate-600 tracking-wide mt-2">
            {t.cashflowSub || '已过账回款与调整影响'}
          </p>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center px-4 py-2.5 rounded-[12px] text-xs font-bold bg-emerald-600 text-white shadow-sm active-shrink"
        >
          <Download size={16} className="mr-2.5" />{t.export || '导出 CSV'}
        </button>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {summaryCards.map((card) => (
          <div key={card.label} className="rounded-[12px] border border-slate-100 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/60 p-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-slate-600">{card.label}</div>
              <div className="text-emerald-600 dark:text-emerald-400">{card.icon}</div>
            </div>
            <div className="mt-2 text-xl font-black tracking-tight text-slate-900 dark:text-white">{card.value}</div>
          </div>
        ))}
      </div>

      <div data-mobile-card-list className="space-y-3 md:hidden">
        {isLoading ? <MobileRecordState text={t.loading || '正在加载...'} /> : rows.length ? rows.map(row => (
          <MobileRecordCard
            key={`${row.period}-mobile`}
            title={row.period}
            status={`${row.receiptCount} ${t.cashflowReceiptCount || '回款笔数'}`}
            fields={[
              { label: t.cashflowInflow || '流入', value: formatPrice(row.inflow), tone: 'positive' },
              { label: t.cashflowOutflow || '流出', value: formatPrice(row.outflow), tone: 'negative' },
              { label: t.cashflowNet || '净额', value: formatPrice(row.net), tone: row.net >= 0 ? 'positive' : 'negative' },
              { label: t.cashflowPending || '待确认', value: formatPrice(row.pendingReceiptAmount) },
              { label: t.cashflowAdjCount || '调整笔数', value: row.adjustmentCount },
            ]}
          />
        )) : <MobileRecordState text={t.emptyState || '暂无记录'} />}
      </div>

      <div className="hidden overflow-x-auto no-scrollbar md:block">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-slate-100/50 dark:border-slate-800">
              <Th>{t.cashflowPeriod || '期间'}</Th>
              <Th>{t.cashflowInflow || '流入'}</Th>
              <Th>{t.cashflowOutflow || '流出'}</Th>
              <Th>{t.cashflowNet || '净额'}</Th>
              <Th>{t.cashflowReceiptCount || '回款笔数'}</Th>
              <Th>{t.cashflowAdjCount || '调整笔数'}</Th>
              <Th>{t.cashflowPending || '待确认'}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
            {isLoading ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-xs font-bold text-slate-600">{t.loading || '正在加载...'}</td>
              </tr>
            ) : rows.length ? (
              rows.map((row) => (
                <tr key={row.period} className="transition-colors duration-150 hover:bg-emerald-50/20 motion-reduce:transition-none dark:hover:bg-emerald-900/5">
                  <Td mono>{row.period}</Td>
                  <Td>{formatPrice(row.inflow)}</Td>
                  <Td>{formatPrice(row.outflow)}</Td>
                  <Td className={row.net >= 0 ? 'text-emerald-600 font-black' : 'text-rose-500 font-black'}>{formatPrice(row.net)}</Td>
                  <Td>{row.receiptCount}</Td>
                  <Td>{row.adjustmentCount}</Td>
                  <Td>{formatPrice(row.pendingReceiptAmount)}</Td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="py-8 text-center text-xs font-bold text-slate-600">{t.emptyState || '暂无记录'}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};

const Th = ({ children }: { children: React.ReactNode }) => (
  <th className="py-3 px-3 text-xs font-bold text-slate-600 whitespace-nowrap">{children}</th>
);

const Td = ({ children, mono = false, className = '' }: { children: React.ReactNode; mono?: boolean; className?: string }) => (
  <td className={`py-3 px-3 text-sm text-slate-700 dark:text-slate-200 ${mono ? 'font-mono text-xs' : 'font-bold'} ${className}`}>{children}</td>
);

export default FinanceCashflowPanel;
