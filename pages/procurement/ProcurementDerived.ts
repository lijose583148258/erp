import type { PurchaseOrder, Supplier } from '../../services/procurement.service';
import type { Language, SalesOrder } from '../../types';
import { matchesScopedSearch, splitSearchTerms } from '../../utils/scopedSearch';

type ProcurementTranslation = {
  pending: string;
  approved: string;
  activeTransit?: string;
  transit?: string;
  contractCancelled?: string;
};

export type ProcurementStatsSummary = {
  avgLead: number;
  risky: number;
  activeOrders: number;
};

export const buildProcurementStats = (
  suppliers: Supplier[],
  orders: PurchaseOrder[],
): ProcurementStatsSummary => ({
  avgLead: suppliers.length
    ? Math.round(suppliers.reduce((sum, supplier) => sum + supplier.leadTimeDays, 0) / suppliers.length)
    : 0,
  risky: suppliers.filter((supplier) => supplier.riskLevel === 'high').length,
  activeOrders: orders.filter((order) => order.status !== 'received').length,
});

export const getReceiptReadyCount = (orders: PurchaseOrder[]): number =>
  orders.filter((order) => ['approved', 'in_transit', 'received'].includes(order.status)).length;

export const getDisplayedPurchaseOrders = (
  orders: PurchaseOrder[],
  activeDesk: string,
): PurchaseOrder[] => (
  activeDesk === 'receipts'
    ? orders.filter((order) => ['approved', 'in_transit', 'received'].includes(order.status))
    : orders
);

export const filterSuppliers = (suppliers: Supplier[], supplierSearch: string): Supplier[] => {
  const terms = splitSearchTerms(supplierSearch);
  if (terms.length === 0) return suppliers;

  return suppliers.filter((supplier) => matchesScopedSearch([
    supplier.id,
    supplier.name,
    supplier.nameZh,
    supplier.nameEn,
    supplier.nameVi,
    supplier.supplierDisplayName,
    ...(supplier.nameAliases || []),
    supplier.category,
    supplier.contact,
    ...(supplier.contacts || []).flatMap((contact) => [
      contact.name,
      contact.role,
      contact.position,
      contact.phone,
      contact.email,
      contact.mobile,
      contact.department,
      contact.whatsapp,
      contact.wechat,
    ]),
    ...(supplier.addresses || []).flatMap((address) => [
      address.label,
      address.fullAddress,
      address.city,
      address.region,
      address.countryCode,
      address.registeredName,
      address.registrationNo,
      address.taxNo,
    ]),
  ], supplierSearch));
};

export const getSupplierDisplayName = (
  supplier: Pick<Supplier, 'name' | 'nameZh' | 'nameEn' | 'nameVi' | 'supplierDisplayName'> | null | undefined,
  language: Language,
): string => {
  if (!supplier) return '';
  if (language === 'en') return supplier.nameEn || supplier.name || supplier.nameZh || supplier.nameVi || supplier.supplierDisplayName || '';
  if (language === 'vi') return supplier.nameVi || supplier.nameEn || supplier.nameZh || supplier.name || supplier.supplierDisplayName || '';
  return supplier.nameZh || supplier.name || supplier.nameEn || supplier.nameVi || supplier.supplierDisplayName || '';
};

export const getPurchaseOrderStatusLabel = (
  status: PurchaseOrder['status'],
  language: Language,
  t: ProcurementTranslation,
): string => {
  if (status === 'pending') return t.pending;
  if (status === 'approved') return t.approved;
  if (status === 'in_transit') return t.activeTransit || t.transit || status;
  if (status === 'received') return language === 'en' ? 'Received' : language === 'vi' ? 'Đã nhận hàng' : '已收货';
  if (status === 'cancelled') return t.contractCancelled || status;
  return status;
};

export const formatProcurementDateOnly = (value?: string): string => {
  if (!value) return '-';
  const [datePart] = String(value).split('T');
  return datePart || value;
};

export const findLinkedSalesOrder = (
  salesOrders: SalesOrder[],
  salesOrderRef: string,
): SalesOrder | null =>
  salesOrders.find((salesOrder) => salesOrder.id === salesOrderRef || salesOrder.orderNo === salesOrderRef) || null;
