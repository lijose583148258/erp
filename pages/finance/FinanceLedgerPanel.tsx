import React, { useMemo } from 'react';
import { Download, FileText, WalletCards, ShieldCheck, Clock3 } from 'lucide-react';
import { useAppContext } from '../../app/AppContext';
import { FinanceLedgerSummary } from '../../services/financeAnalytics.service';
import { getCustomerDisplayName } from '../../utils/customerName';
import { exportFinanceCsv } from './finance.helpers';

interface FinanceLedgerPanelProps {
  data: FinanceLedgerSummary | null | undefined;
}

const FinanceLedgerPanel = ({ data }: FinanceLedgerPanelProps) => {
  const { notify, formatPrice, language, t } = useAppContext();
  const isLoading = data === undefined;

  const rows = data?.rows || [];

  // 使用 t() 国际化状态标签，不再硬编码中文
  const sourceTypeLabel = (type: string) => {
    const map: Record<string, string> = {
      payment: t.historyTab || 'Payment',
      adjustment: t.adjustment || 'Adjustment',
    };
    return map[type] || type;
  };

  const sourceStatusLabel = (status: string) => {
    const map: Record<string, string> = {
      verified: t.paymentVerified || 'Verified',
      pending: t.paymentPending || 'Pending',
      posted: t.contractActive || 'Posted',
      reversed: t.ledgerReversed || 'Reversed',
    };
    return map[status] || status;
  };

  const summaryCards = useMemo(() => ([
    { label: t.ledgerCount || 'Entries', value: isLoading ? '…' : (data?.totalCount ?? 0), icon: <FileText size={18} /> },
    { label: t.ledgerPosted || 'Posted', value: isLoading ? '…' : (data?.postedCount ?? 0), icon: <ShieldCheck size={18} /> },
    { label: t.paymentPending || 'Pending', value: isLoading ? '…' : (data?.pendingCount ?? 0), icon: <Clock3 size={18} /> },
    { label: t.ledgerNet || 'Net', value: isLoading ? '…' : formatPrice(data?.netAmount || 0), icon: <WalletCards size={18} /> },
  ]), [data?.netAmount, data?.pendingCount, data?.postedCount, data?.totalCount, formatPrice, isLoading, t]);

  const customerLabel = (row: FinanceLedgerSummary['rows'][number]) => getCustomerDisplayName({
    name: row.customerName || '',
    nameZh: row.customerNameZh || '',
    nameEn: row.customerNameEn || '',
    nameVi: row.customerNameVi || '',
  }, language);

  const exportRows = () => {
    const success = exportFinanceCsv(rows.map(row => ({
      entryNo: row.entryNo,
      voucherType: row.voucherType,
      sourceType: row.sourceType,
      sourceStatus: row.sourceStatus,
      postingDate: row.postingDate,
      customerName: customerLabel(row),
      orderNo: row.orderNo || '',
      batchNo: row.batchNo || '',
      sourceRef: row.sourceRef || '',
      amount: row.amount,
      impactAmount: row.impactAmount,
      balanceAfter: row.balanceAfter,
      note: row.note || '',
    })), 'finance-ledger.csv');

    if (!success) {
      notify('warning', t.ledgerNoExport || 'No ledger data to export');
    }
  };

  return (
    <section className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.03)] overflow-hidden p-8 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-2xl font-black tracking-tighter italic flex items-center">
            <div className="w-2 h-8 bg-blue-600 rounded-full mr-4" />{t.ledgerTitle || 'Finance Ledger'}
          </h3>
          <p className="text-xs font-bold text-slate-400 tracking-wide mt-2">
            {t.ledgerSub || 'Payments, adjustments and reversals'}
          </p>
        </div>
        <button
          onClick={exportRows}
          className="flex items-center px-5 py-3 rounded-[18px] text-xs font-bold bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-xl shadow-blue-500/30 active-shrink"
        >
          <Download size={16} className="mr-2.5" />{t.export || 'Export CSV'}
        </button>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {summaryCards.map(card => (
          <div key={card.label} className="rounded-[24px] border border-slate-100 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/60 p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-slate-400">{card.label}</div>
              <div className="text-blue-600 dark:text-blue-400">{card.icon}</div>
            </div>
            <div className="mt-3 text-2xl font-black tracking-tight text-slate-900 dark:text-white">{card.value}</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto no-scrollbar">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-slate-100/50 dark:border-slate-800">
              <Th>{t.ledgerEntryNo || 'Entry No.'}</Th>
              <Th>{t.ledgerType || 'Type'}</Th>
              <Th>{t.customer || 'Entity'}</Th>
              <Th>{t.amount || 'Amount'}</Th>
              <Th>{t.ledgerImpact || 'Impact'}</Th>
              <Th>{t.ledgerBalance || 'Balance'}</Th>
              <Th>{t.status || 'Status'}</Th>
              <Th>{t.assetDate || 'Date'}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
            {isLoading ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-xs font-bold text-slate-400">{t.loading || 'Loading…'}</td>
              </tr>
            ) : rows.length ? (
              rows.map(row => (
                <tr key={`${row.sourceType}-${row.entryNo}-${row.createdAt}`} className="hover:bg-blue-50/20 dark:hover:bg-blue-900/5 transition-all">
                  <Td mono>{row.entryNo}</Td>
                  <Td>
                    <div className="font-black text-slate-900 dark:text-white text-sm">{row.voucherType}</div>
                    <div className="text-xs text-slate-400 mt-1">{sourceTypeLabel(row.sourceType)}</div>
                  </Td>
                  <Td>
                    <div className="font-bold text-slate-900 dark:text-white text-sm">{customerLabel(row) || '—'}</div>
                    <div className="text-xs text-slate-400 mt-1">{row.orderNo || row.batchNo || row.sourceRef || '—'}</div>
                  </Td>
                  <Td>{formatPrice(row.amount)}</Td>
                  <Td className={row.impactAmount >= 0 ? 'text-emerald-600 font-black' : 'text-rose-500 font-black'}>
                    {row.impactAmount >= 0 ? '+' : '-'}
                    {formatPrice(Math.abs(row.impactAmount))}
                  </Td>
                  <Td className="font-black">{formatPrice(row.balanceAfter)}</Td>
                  <Td>
                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${row.sourceStatus === 'verified' || row.sourceStatus === 'posted'
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                      : row.sourceStatus === 'pending'
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      {sourceStatusLabel(row.sourceStatus)}
                    </span>
                  </Td>
                  <Td mono>{row.postingDate.slice(0, 10)}</Td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="py-8 text-center text-xs font-bold text-slate-400">{t.emptyState || 'No records'}</td>
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

export default FinanceLedgerPanel;
