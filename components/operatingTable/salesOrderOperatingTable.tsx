import React from 'react';
import type { SalesOrder } from '../../types';
import type { EnterpriseColumn } from '../ui/EnterpriseDataGrid';
import { CopyableCode, DateCell, type LabelMap, MoneyCell, Pill, QuantityCell, StackText, text, type Tone } from './BusinessCells';

export type SalesOrderOperatingRow = {
  id: string | number;
  orderNo?: string;
  customerName?: string;
  customerCode?: string;
  ownerName?: string;
  orderDate?: string;
  deliveryDate?: string;
  productSummary?: string;
  totalAmount?: number;
  paidAmount?: number;
  currency?: string;
  orderedQuantity?: number;
  shippedQuantity?: number;
  quantityUnit?: string;
  orderStatus?: string;
  fulfillmentStatus?: string;
  fulfillment?: SalesOrder['fulfillment'];
  paymentStatus?: string;
  overdueDays?: number;
  creditRisk?: 'normal' | 'watch' | 'blocked' | string;
  stockRisk?: 'normal' | 'shortage' | string;
};

export type SalesOrderOperatingAction = 'review' | 'purchase' | 'ship' | 'sign' | 'collect' | 'risk' | 'open';

export type SalesOrderNextAction = {
  key: SalesOrderOperatingAction;
  labelKey: string;
  fallback: string;
  tone: Tone;
  target: string;
};

const statusTone = (status?: string): Tone => {
  if (!status) return 'neutral';
  if (['completed', 'paid', 'signed', 'active', 'approved'].includes(status)) return 'success';
  if (['ready_to_ship', 'shipping', 'partial_shipped', 'processing'].includes(status)) return 'info';
  if (['pending', 'draft', 'waiting', 'unpaid', 'partially_delivered'].includes(status)) return 'warning';
  if (['overdue', 'blocked', 'cancelled', 'shortage', 'rejected'].includes(status)) return 'danger';
  return 'neutral';
};

export const getSalesOrderRiskTone = (row: SalesOrderOperatingRow): Tone => {
  if (row.creditRisk === 'blocked' || row.paymentStatus === 'overdue' || Number(row.overdueDays || 0) > 0) return 'danger';
  if (row.stockRisk === 'shortage' || row.fulfillmentStatus === 'ready_to_ship' || row.paymentStatus === 'unpaid') return 'warning';
  return 'neutral';
};

export const getSalesOrderNextAction = (row: SalesOrderOperatingRow): SalesOrderNextAction => {
  if (row.creditRisk === 'blocked' || row.paymentStatus === 'overdue') return { key: 'risk', labelKey: 'order.action.risk', fallback: 'Review risk', tone: 'danger', target: 'risk' };
  if (row.orderStatus === 'draft' || row.orderStatus === 'pending') return { key: 'review', labelKey: 'order.action.review', fallback: 'Review', tone: 'warning', target: 'orders' };
  if (row.stockRisk === 'shortage') return { key: 'purchase', labelKey: 'order.action.purchase', fallback: 'Arrange purchase', tone: 'warning', target: 'procurement' };
  if (['ready_to_ship', 'partial_shipped', 'partially_delivered'].includes(row.fulfillmentStatus || '')) return { key: 'ship', labelKey: 'order.action.ship', fallback: 'Arrange shipment', tone: 'info', target: 'shipping' };
  if (row.fulfillmentStatus === 'shipped') return { key: 'sign', labelKey: 'order.action.sign', fallback: 'Confirm receipt', tone: 'info', target: 'shipping' };
  if (row.paymentStatus === 'unpaid' || row.paymentStatus === 'partial') return { key: 'collect', labelKey: 'order.action.collect', fallback: 'Collect payment', tone: 'warning', target: 'collections' };
  return { key: 'open', labelKey: 'order.action.open', fallback: 'Open', tone: 'neutral', target: 'orders' };
};

export const createSalesOrderOperatingColumns = (
  labels?: LabelMap,
  formatMoney?: (value: number, currency?: string) => string,
): EnterpriseColumn<SalesOrderOperatingRow>[] => [
  {
    key: 'order',
    header: text(labels, 'order.column.order', 'Order'),
    width: '180px',
    sortable: true,
    searchText: (row) => [row.orderNo, row.customerName, row.customerCode].filter(Boolean).join(' '),
    render: (row) => <StackText title={<CopyableCode value={row.orderNo || row.id} />} subtitle={row.customerName || '-'} />,
  },
  {
    key: 'owner',
    header: text(labels, 'order.column.owner', 'Owner'),
    accessor: (row) => row.ownerName || '-',
    sortable: true,
    defaultVisible: false,
    width: '120px',
  },
  {
    key: 'productSummary',
    header: text(labels, 'order.column.products', 'Products'),
    accessor: (row) => row.productSummary || '-',
    searchText: (row) => row.productSummary || '',
    width: '220px',
  },
  {
    key: 'amount',
    header: text(labels, 'order.column.amount', 'Amount'),
    isNumeric: true,
    sortable: true,
    width: '140px',
    searchText: (row) => String(row.totalAmount || 0),
    render: (row) => <MoneyCell value={row.totalAmount} currency={row.currency} format={formatMoney} />,
  },
  {
    key: 'quantityProgress',
    header: text(labels, 'order.column.shipped', 'Shipped'),
    isNumeric: true,
    width: '160px',
    render: (row) => row.fulfillment?.lines.length ? (
      <span className="block space-y-1 text-right">
        {row.fulfillment.lines.map(line => <span className="block" key={line.orderItemId}>
          <span className="block text-[11px] text-slate-500">{line.productName}</span>
          <QuantityCell value={line.dispatchedQuantity} unit={line.unit} /> / <QuantityCell value={line.orderedQuantity} unit={line.unit} />
        </span>)}
      </span>
    ) : (
      <span className="block text-right">
        <QuantityCell value={row.shippedQuantity || 0} unit={row.quantityUnit} />
        <span className="block text-[11px] font-bold text-slate-400">/ {Number(row.orderedQuantity || 0).toLocaleString()}</span>
      </span>
    ),
  },
  {
    key: 'dates',
    header: text(labels, 'order.column.dates', 'Dates'),
    width: '150px',
    render: (row) => <StackText title={<DateCell value={row.orderDate} />} subtitle={<DateCell value={row.deliveryDate} />} />,
  },
  {
    key: 'status',
    header: text(labels, 'order.column.status', 'Status'),
    width: '170px',
    sortable: true,
    searchText: (row) => [row.orderStatus, row.fulfillmentStatus, row.paymentStatus].filter(Boolean).join(' '),
    render: (row) => (
      <span className="flex flex-wrap gap-1" data-testid={`order-fulfillment-${row.id}`}>
        <Pill tone={statusTone(row.orderStatus)}>{text(labels, `status.${row.orderStatus || 'unknown'}`, row.orderStatus || 'Unknown')}</Pill>
        <Pill tone={statusTone(row.fulfillmentStatus)}>{text(labels, `status.${row.fulfillmentStatus || 'unknown'}`, row.fulfillmentStatus || 'Unknown')}</Pill>
        <Pill tone={statusTone(row.paymentStatus)}>{text(labels, `status.${row.paymentStatus || 'unknown'}`, row.paymentStatus || 'Unknown')}</Pill>
        {row.fulfillment?.lines.filter(line => line.outstandingQuantity > 0).map(line => <span key={line.orderItemId} className="block w-full text-xs text-amber-800 dark:text-amber-200">
          {line.productName} · {text(labels, 'order.fulfillment.outstanding', 'Still owed')} {Number(line.outstandingQuantity.toPrecision(12))} {line.unit}
        </span>)}
        {row.fulfillment?.needsReview && <span className="block w-full text-xs text-rose-600">{text(labels, 'order.fulfillment.review', 'Fulfillment evidence needs review')}</span>}
      </span>
    ),
  },
  {
    key: 'risk',
    header: text(labels, 'order.column.risk', 'Risk'),
    width: '130px',
    render: (row) => {
      const tone = getSalesOrderRiskTone(row);
      const key = tone === 'danger' ? 'risk.danger' : tone === 'warning' ? 'risk.warning' : 'risk.normal';
      return <Pill tone={tone}>{text(labels, key, tone)}</Pill>;
    },
  },
  {
    key: 'nextAction',
    header: text(labels, 'order.column.nextAction', 'Next'),
    width: '150px',
    render: (row) => {
      const action = getSalesOrderNextAction(row);
      return <Pill tone={action.tone}>{text(labels, action.labelKey, action.fallback)}</Pill>;
    },
  },
];
