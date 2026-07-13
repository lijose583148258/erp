import { exportObjectsToXlsx } from '../../utils/spreadsheetIO';
import { getStatusBorderBadgeClassName } from '../../components/ui/statusBadgeLogic';

export const formatDate = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().split('T')[0];
};

export const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toISOString().split('T')[0]} ${date.toTimeString().slice(0, 5)}`;
};

export const getPromiseTiming = (value?: string | null) => {
  if (!value) return '未设置承诺时间';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diffHours = Math.round((date.getTime() - Date.now()) / 3600000);
  if (diffHours >= 0) return `剩余 ${diffHours} 小时`;
  return `超时 ${Math.abs(diffHours)} 小时`;
};

export const getElapsedDays = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const diffDays = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
  return `${diffDays} 天`;
};

export const getHoldStrategy = (scope: 'customer-credit' | 'customer-shipment' | 'order-shipment') => {
  if (scope === 'customer-credit') return '暂停授信，复核回款计划';
  if (scope === 'customer-shipment') return '暂停发货，等待财务放行';
  return '订单冻结，经理复核后释放';
};

export const getCollectionCustomerLabel = (row: {
  customerName?: string | null;
  customerNameZh?: string | null;
  customerNameEn?: string | null;
  customerNameVi?: string | null;
  customerDisplayName?: string | null;
}) => row.customerDisplayName || row.customerNameZh || row.customerNameEn || row.customerNameVi || row.customerName || '-';

export const riskRank = (riskLevel: string) => {
  if (riskLevel === 'critical') return 4;
  if (riskLevel === 'high') return 3;
  if (riskLevel === 'medium') return 2;
  return 1;
};

export const exportRows = (filename: string, rows: Record<string, unknown>[]) => {
  void exportObjectsToXlsx(rows, filename, 'Export');
};

export const paymentBadge = (status: string) => {
  if (status === 'verified' || status === 'paid') return getStatusBorderBadgeClassName('verified');
  if (status === 'partial') return getStatusBorderBadgeClassName('partial');
  return getStatusBorderBadgeClassName('unknown');
};

export const riskBadge = (riskLevel: string) => {
  if (riskLevel === 'critical') return getStatusBorderBadgeClassName('critical');
  if (riskLevel === 'high') return getStatusBorderBadgeClassName('high');
  if (riskLevel === 'medium') return getStatusBorderBadgeClassName('medium');
  return getStatusBorderBadgeClassName('low');
};

export const statusBadge = (status: string) => {
  if (status === 'open') return getStatusBorderBadgeClassName('exception');
  return getStatusBorderBadgeClassName(status);
};
