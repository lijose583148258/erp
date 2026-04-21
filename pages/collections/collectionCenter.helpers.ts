import * as XLSX from 'xlsx';

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
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Export');
  XLSX.writeFile(workbook, filename);
};

export const paymentBadge = (status: string) => {
  if (status === 'verified' || status === 'paid') return 'bg-emerald-50 text-emerald-600 border-emerald-100';
  if (status === 'partial') return 'bg-amber-50 text-amber-600 border-amber-100';
  return 'bg-slate-50 text-slate-500 border-slate-100';
};

export const riskBadge = (riskLevel: string) => {
  if (riskLevel === 'critical') return 'bg-rose-50 text-rose-600 border-rose-100';
  if (riskLevel === 'high') return 'bg-orange-50 text-orange-600 border-orange-100';
  if (riskLevel === 'medium') return 'bg-amber-50 text-amber-600 border-amber-100';
  return 'bg-emerald-50 text-emerald-600 border-emerald-100';
};

export const statusBadge = (status: string) => {
  if (['kept', 'resolved', 'paid'].includes(status)) return 'bg-emerald-50 text-emerald-600 border-emerald-100';
  if (['missed', 'rejected', 'open'].includes(status)) return 'bg-rose-50 text-rose-600 border-rose-100';
  if (['reviewing', 'promised'].includes(status)) return 'bg-amber-50 text-amber-600 border-amber-100';
  if (['cancelled', 'withdrawn'].includes(status)) return 'bg-slate-50 text-slate-500 border-slate-100';
  return 'bg-slate-50 text-slate-500 border-slate-100';
};
