import React, { useMemo } from 'react';
import { Download, TrendingUp, WalletCards, CircleDollarSign, Clock3 } from 'lucide-react';
import { useAppContext } from '../../app/AppContext';
import { FinanceCashflowSummary } from '../../services/financeAnalytics.service';
import { exportFinanceCsv } from './finance.helpers';

interface FinanceCashflowPanelProps {
  data: FinanceCashflowSummary | null | undefined;
}

const FinanceCashflowPanel: React.FC<FinanceCashflowPanelProps> = ({ data }) => {
  const { notify, formatPrice, t } = useAppContext();
  const isLoading = data === undefined;
  const rows = data?.rows || [];

  const summaryCards = useMemo(() => ([
    { label: t.cashflowInflow || 'Total Inflow', value: isLoading ? '…' : formatPrice(data?.totalInflow || 0), icon: <TrendingUp size={18} /> },
    { label: t.cashflowOutflow || 'Total Outflow', value: isLoading ? '…' : formatPrice(data?.totalOutflow || 0), icon: <CircleDollarSign size={18} /> },
    { label: t.cashflowNet || 'Net Cashflow', value: isLoading ? '…' : formatPrice(data?.netCashflow || 0), icon: <WalletCards size={18} /> },
    { label: t.cashflowPending || 'Pending Receipts', value: isLoading ? '…' : formatPrice(data?.pendingReceiptAmount || 0), icon: <Clock3 size={18} /> },
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
      notify('warning', t.cashflowNoExport || 'No cashflow data to export');
    }
  };

  return (
    <section className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.03)] overflow-hidden p-8 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-2xl font-black tracking-tighter italic flex items-center">
            <div className="w-2 h-8 bg-emerald-500 rounded-full mr-4" />{t.cashflowTitle || 'Cashflow Overview'}
          </h3>
          <p className="text-xs font-bold text-slate-400 tracking-wide mt-2">
            {t.cashflowSub || 'Posted receipts and net adjustment impact'}
          </p>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center px-5 py-3 rounded-[18px] text-xs font-bold bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-xl shadow-emerald-500/25 active-shrink"
        >
          <Download size={16} className="mr-2.5" />{t.export || 'Export CSV'}
        </button>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {summaryCards.map((card) => (
          <div key={card.label} className="rounded-[24px] border border-slate-100 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/60 p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-slate-400">{card.label}</div>
              <div className="text-emerald-600 dark:text-emerald-400">{card.icon}</div>
            </div>
            <div className="mt-3 text-2xl font-black tracking-tight text-slate-900 dark:text-white">{card.value}</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto no-scrollbar">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-slate-100/50 dark:border-slate-800">
              <Th>{t.cashflowPeriod || 'Period'}</Th>
              <Th>{t.cashflowInflow || 'Inflow'}</Th>
              <Th>{t.cashflowOutflow || 'Outflow'}</Th>
              <Th>{t.cashflowNet || 'Net'}</Th>
              <Th>{t.cashflowReceiptCount || 'Receipts'}</Th>
              <Th>{t.cashflowAdjCount || 'Adjustments'}</Th>
              <Th>{t.cashflowPending || 'Pending'}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
            {isLoading ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-xs font-bold text-slate-400">{t.loading || 'Loading…'}</td>
              </tr>
            ) : rows.length ? (
              rows.map((row) => (
                <tr key={row.period} className="hover:bg-emerald-50/20 dark:hover:bg-emerald-900/5 transition-all">
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
                <td colSpan={7} className="py-8 text-center text-xs font-bold text-slate-400">{t.emptyState || 'No records'}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};

const Th = ({ children }: { children: React.ReactNode }) => (
  <th className="py-4 px-3 text-xs font-bold text-slate-400 whitespace-nowrap">{children}</th>
);

const Td = ({ children, mono = false, className = '' }: { children: React.ReactNode; mono?: boolean; className?: string }) => (
  <td className={`py-4 px-3 text-sm text-slate-700 dark:text-slate-200 ${mono ? 'font-mono text-xs' : 'font-bold'} ${className}`}>{children}</td>
);

export default FinanceCashflowPanel;
