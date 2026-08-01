import React, { useMemo } from 'react';
import { Download, FileText, WalletCards, ShieldCheck, Clock3 } from 'lucide-react';
import { useAppContext } from '../../app/AppContext';
import { FinanceLedgerSummary } from '../../services/financeAnalytics.service';
import { getCustomerDisplayName } from '../../utils/customerName';
import { exportFinanceCsv } from './finance.helpers';
import { MobileRecordCard, MobileRecordState } from '../../components/ui/MobileRecordCard';

interface FinanceLedgerPanelProps {
  data: FinanceLedgerSummary | null | undefined;
}

const FinanceLedgerPanel = ({ data }: FinanceLedgerPanelProps) => {
  const { notify, formatPrice, language, t } = useAppContext();
  const isLoading = data === undefined;
  const rows = data?.rows || [];

  const sourceTypeLabel = (type: string) => {
    const map: Record<string, string> = {
      payment: t.historyTab || '回款',
      adjustment: t.adjustment || '调整',
    };
    return map[type] || type;
  };

  const sourceStatusLabel = (status: string) => {
    const map: Record<string, string> = {
      verified: t.paymentVerified || '已核销',
      pending: t.paymentPending || '待确认',
      posted: t.ledgerPosted || '已过账',
      reversed: t.ledgerReversed || '已冲回',
    };
    return map[status] || status;
  };

  const summaryCards = useMemo(() => ([
    { label: t.ledgerCount || '流水数', value: isLoading ? '--' : (data?.totalCount ?? 0), icon: <FileText size={18} /> },
    { label: t.ledgerPosted || '已过账', value: isLoading ? '--' : (data?.postedCount ?? 0), icon: <ShieldCheck size={18} /> },
    { label: t.paymentPending || '待确认', value: isLoading ? '--' : (data?.pendingCount ?? 0), icon: <Clock3 size={18} /> },
    { label: t.ledgerNet || '净额', value: isLoading ? '--' : formatPrice(data?.netAmount || 0), icon: <WalletCards size={18} /> },
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
      notify('warning', t.ledgerNoExport || '暂无可导出的财务流水');
    }
  };

  return (
    <section className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[24px] border border-white/50 dark:border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.03)] overflow-hidden p-6 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-black tracking-tight flex items-center">
            <div className="w-2 h-8 bg-blue-600 rounded-full mr-4" />{t.ledgerTitle || '财务流水'}
          </h3>
          <p className="text-xs font-bold text-slate-600 tracking-wide mt-2">
            {t.ledgerSub || '回款、调整与冲回记录'}
          </p>
        </div>
        <button
          onClick={exportRows}
          className="flex items-center px-4 py-2.5 rounded-[12px] text-xs font-bold bg-blue-600 text-white shadow-sm active-shrink"
        >
          <Download size={16} className="mr-2.5" />{t.export || '导出 CSV'}
        </button>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {summaryCards.map(card => (
          <div key={card.label} className="rounded-[12px] border border-slate-100 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/60 p-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-slate-600">{card.label}</div>
              <div className="text-blue-600 dark:text-blue-400">{card.icon}</div>
            </div>
            <div className="mt-2 text-xl font-black tracking-tight text-slate-900 dark:text-white">{card.value}</div>
          </div>
        ))}
      </div>

      <div data-mobile-card-list className="space-y-3 md:hidden">
        {isLoading ? <MobileRecordState text={t.loading || '正在加载...'} /> : rows.length ? rows.map(row => (
          <MobileRecordCard
            key={`${row.sourceType}-${row.entryNo}-${row.createdAt}-mobile`}
            title={row.entryNo}
            subtitle={`${row.voucherType} · ${sourceTypeLabel(row.sourceType)}`}
            status={sourceStatusLabel(row.sourceStatus)}
            fields={[
              { label: t.customer || '往来方', value: customerLabel(row) || '--', fullWidth: true },
              { label: t.amount || '金额', value: formatPrice(row.amount) },
              { label: t.ledgerImpact || '影响', value: `${row.impactAmount >= 0 ? '+' : '-'}${formatPrice(Math.abs(row.impactAmount))}`, tone: row.impactAmount >= 0 ? 'positive' : 'negative' },
              { label: t.ledgerBalance || '余额', value: formatPrice(row.balanceAfter) },
              { label: t.assetDate || '日期', value: row.postingDate.slice(0, 10), mono: true },
              { label: '关联单据', value: row.orderNo || row.batchNo || row.sourceRef || '--', fullWidth: true, mono: true },
            ]}
          />
        )) : <MobileRecordState text={t.emptyState || '暂无记录'} />}
      </div>

      <div className="hidden overflow-x-auto no-scrollbar md:block">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-slate-100/50 dark:border-slate-800">
              <Th>{t.ledgerEntryNo || '流水号'}</Th>
              <Th>{t.ledgerType || '类型'}</Th>
              <Th>{t.customer || '往来方'}</Th>
              <Th>{t.amount || '金额'}</Th>
              <Th>{t.ledgerImpact || '影响'}</Th>
              <Th>{t.ledgerBalance || '余额'}</Th>
              <Th>{t.status || '状态'}</Th>
              <Th>{t.assetDate || '日期'}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-800/50">
            {isLoading ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-xs font-bold text-slate-600">{t.loading || '正在加载...'}</td>
              </tr>
            ) : rows.length ? (
              rows.map(row => (
                <tr key={`${row.sourceType}-${row.entryNo}-${row.createdAt}`} className="transition-colors duration-150 hover:bg-blue-50/20 motion-reduce:transition-none dark:hover:bg-blue-900/5">
                  <Td mono>{row.entryNo}</Td>
                  <Td>
                    <div className="font-black text-slate-900 dark:text-white text-sm">{row.voucherType}</div>
                    <div className="text-xs text-slate-600 mt-1">{sourceTypeLabel(row.sourceType)}</div>
                  </Td>
                  <Td>
                    <div className="font-bold text-slate-900 dark:text-white text-sm">{customerLabel(row) || '--'}</div>
                    <div className="text-xs text-slate-600 mt-1">{row.orderNo || row.batchNo || row.sourceRef || '--'}</div>
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
                <td colSpan={8} className="py-8 text-center text-xs font-bold text-slate-600">{t.emptyState || '暂无记录'}</td>
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

export default FinanceLedgerPanel;
