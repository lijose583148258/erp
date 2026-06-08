import { AlertTriangle, Calendar, CheckCircle2 } from 'lucide-react';
import { Column } from '../../components/DataTable';
import { getCustomerDisplayName } from '../../utils/customerName';
import { CommissionStatus, SalesOrder } from '../../types';
import {
  getEffectiveReceivableAmount,
  getOutstandingAmount,
  getReceivableAdjustmentAmount,
} from './salesOrderFormHelpers';

type CollectionView = {
  label: string;
  nextAction: string;
  tone: 'emerald' | 'amber' | 'orange' | 'rose' | 'slate';
  overdueDays: number;
};

type SalesOrderColumnDeps = {
  t: Record<string, string>;
  language: 'zh' | 'en' | 'vi';
  formatPrice: (amount: number) => string;
  getCollectionView: (order: SalesOrder) => CollectionView;
  openHistoryModal: (order: SalesOrder) => void;
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: '¥',
  USD: '$',
  VND: '₫',
  EUR: '€',
  HKD: 'HK$',
};

const AXIS_STYLE: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  confirmed: 'bg-blue-50 text-blue-700 border-blue-200',
  shipped: 'bg-violet-50 text-violet-700 border-violet-200',
  delivered: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelled: 'bg-slate-100 text-slate-500 border-slate-200',
  pending_release: 'bg-slate-100 text-slate-600 border-slate-200',
  ready_to_ship: 'bg-sky-50 text-sky-700 border-sky-200',
  in_transit: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  unpaid: 'bg-rose-50 text-rose-600 border-rose-200',
  payment_submitted: 'bg-amber-50 text-amber-700 border-amber-200',
  partial: 'bg-orange-50 text-orange-700 border-orange-200',
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  overdue: 'bg-rose-50 text-rose-700 border-rose-200',
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-rose-50 text-rose-700 border-rose-200',
  draft: 'bg-slate-100 text-slate-500 border-slate-200',
};

const AXIS_LABEL: Record<string, string> = {
  pending: '待确认',
  confirmed: '已确认',
  shipped: '已发货',
  delivered: '已交付',
  cancelled: '已取消',
  pending_release: '待放货',
  ready_to_ship: '待发运',
  in_transit: '运输中',
  unpaid: '未回款',
  payment_submitted: '待财务核验',
  partial: '部分收款',
  paid: '已结清',
  overdue: '逾期未清',
  approved: '已审批',
  rejected: '已驳回',
  draft: '草稿',
};

const renderAxisBadge = (value?: string | null) => {
  const key = String(value || '').toLowerCase();
  if (!key) return <span className="text-xs font-bold text-slate-400">--</span>;

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${
        AXIS_STYLE[key] || 'bg-slate-100 text-slate-600 border-slate-200'
      }`}
    >
      {AXIS_LABEL[key] || value}
    </span>
  );
};

const renderMultiCurrencyAmount = ({
  amount,
  currency,
  baseAmount,
}: {
  amount: number;
  currency?: string;
  baseAmount?: number;
}) => {
  const cur = (currency ?? 'CNY').toUpperCase();
  const symbol = CURRENCY_SYMBOLS[cur] ?? `${cur} `;
  const showBase = cur !== 'CNY' && baseAmount != null;
  const formatNumber = (value: number, code: string) =>
    code === 'VND'
      ? Math.round(value).toLocaleString('vi-VN')
      : value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="text-right tabular-nums">
      <div className="font-mono text-sm font-black text-slate-900 dark:text-slate-100">
        {symbol}
        {formatNumber(amount, cur)}
        {cur !== 'CNY' && <span className="ml-1 text-[10px] font-bold text-slate-400">{cur}</span>}
      </div>
      {showBase && (
        <div className="mt-0.5 text-[11px] font-mono text-slate-400">≈ ¥{formatNumber(baseAmount!, 'CNY')}</div>
      )}
    </div>
  );
};

export const buildSalesOrderColumns = ({
  t,
  language,
  formatPrice,
  getCollectionView,
  openHistoryModal,
}: SalesOrderColumnDeps): Column<SalesOrder>[] => [
  {
    header: t.orderNo,
    key: 'id',
    accessor: (row) => (
      <div>
        <span className="block font-mono text-sm font-black text-slate-900 dark:text-white">#{row.id}</span>
        <span className="mt-1 flex items-center text-[10px] font-bold text-slate-400">
          <Calendar size={10} className="mr-1" />
          {row.orderDate}
        </span>
      </div>
    ),
  },
  {
    header: t.customer,
    key: 'customer',
    accessor: (row) => (
      <div className="space-y-1">
        <div className="font-semibold text-slate-800 dark:text-slate-300">
          {getCustomerDisplayName(
            {
              name: row.customerName,
              nameZh: row.customerNameZh,
              nameEn: row.customerNameEn,
              nameVi: row.customerNameVi,
              displayName: row.customerDisplayName,
            },
            language,
          )}
        </div>
        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">订单 {row.orderNo || '--'}</div>
      </div>
    ),
  },
  {
    header: '单据轴',
    key: 'documentAxis',
    accessor: (row) => renderAxisBadge(row.status),
  },
  {
    header: '履约轴',
    key: 'fulfillmentAxis',
    accessor: (row) => renderAxisBadge(row.fulfillmentStatus),
  },
  {
    header: '财务轴',
    key: 'financialAxis',
    accessor: (row) => renderAxisBadge(row.financialStatus || row.paymentStatus),
  },
  {
    header: t.balanceTracking,
    key: 'finance',
    isNumeric: true,
    accessor: (row) => {
      const collectionView = getCollectionView(row);
      const isOverdue = row.financialStatus === 'overdue';
      const finalAmount = Number(row.finalAmount || row.totalAmount || 0);
      const effectiveReceivableAmount = getEffectiveReceivableAmount(row);
      const receivableAdjustmentAmount = getReceivableAdjustmentAmount(row);
      const outstandingAmount = getOutstandingAmount(row);
      const progress = effectiveReceivableAmount > 0 ? Math.min((Number(row.paidAmount || 0) / effectiveReceivableAmount) * 100, 100) : 0;
      const paidBaseAmount = row.baseAmount && finalAmount > 0 ? (Number(row.paidAmount || 0) / finalAmount) * row.baseAmount : undefined;

      return (
        <div
          className="w-48 cursor-pointer text-right"
          onClick={(event) => {
            event.stopPropagation();
            openHistoryModal(row);
          }}
        >
          {renderMultiCurrencyAmount({ amount: Number(row.paidAmount || 0), currency: row.currency, baseAmount: paidBaseAmount })}
          <div className="mt-1 text-[10px] font-bold text-slate-400">
            未收 {formatPrice(outstandingAmount)}
          </div>
          {receivableAdjustmentAmount > 0 ? (
            <div className="mt-1 text-[10px] font-bold text-amber-600">
              应收调整 -{formatPrice(receivableAdjustmentAmount)}
            </div>
          ) : null}
          <div className="my-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className={`h-full rounded-full transition-all ${progress === 100 ? 'bg-emerald-500' : isOverdue ? 'bg-rose-400' : 'bg-blue-500'}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          {isOverdue ? (
            <div className="flex items-center justify-end text-[10px] font-black text-rose-500">
              <AlertTriangle size={10} className="mr-1" />
              逾期 {collectionView.overdueDays} 天
            </div>
          ) : row.financialStatus === 'paid' || row.paymentStatus === 'paid' ? (
            <div className="flex items-center justify-end text-[10px] font-black text-emerald-600">
              <CheckCircle2 size={10} className="mr-1" />
              已结清
            </div>
          ) : (
            <div className="text-[10px] font-medium text-slate-400">到期 {row.dueDate || '--'}</div>
          )}
          <div className="mt-1.5 flex justify-end">
            <span
              className={`rounded-md border px-2 py-0.5 text-[11px] font-black uppercase tracking-widest ${
                collectionView.tone === 'emerald'
                  ? 'border-emerald-100 bg-emerald-50 text-emerald-600'
                  : collectionView.tone === 'amber'
                    ? 'border-amber-100 bg-amber-50 text-amber-700'
                    : collectionView.tone === 'orange'
                      ? 'border-orange-100 bg-orange-50 text-orange-700'
                      : collectionView.tone === 'rose'
                        ? 'border-rose-100 bg-rose-50 text-rose-700'
                        : 'border-slate-100 bg-slate-50 text-slate-500'
              }`}
            >
              {collectionView.label}
            </span>
          </div>
        </div>
      );
    },
  },
  {
    header: t.commissionStatus,
    key: 'commissionAxis',
    accessor: (row) => {
      const statusMap: Record<string, string> = {
        [CommissionStatus.APPROVED]: 'approved',
        [CommissionStatus.REJECTED]: 'rejected',
        [CommissionStatus.PENDING]: 'pending',
        [CommissionStatus.NOT_SUBMITTED]: 'draft',
      };
      return renderAxisBadge(statusMap[row.commissionStatus ?? ''] || 'draft');
    },
  },
  {
    header: '到期日',
    key: 'dueDate',
    accessor: (row) => <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{row.dueDate || '--'}</span>,
  },
  {
    header: '净额',
    key: 'finalAmount',
    isNumeric: true,
    accessor: (row) => <span className="font-mono font-black">{formatPrice(row.finalAmount || row.totalAmount)}</span>,
  },
];
