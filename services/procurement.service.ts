import api, { ApiRequestOptions } from '../utils/api';
import { OrderStatus } from '../types';
import type { Contact, CustomerAddress } from '../types';
import { ReceiptDiscrepancyCase, ReceiptDiscrepancyType, mapReceiptDiscrepancyCase } from './receiptDiscrepancy.service';
import { ApiDataResponse, ApiRecord, toApiRecord, toNumberValue, toOptionalString, toStringValue, toUnknownArray } from '../utils/apiMapping';
import { normalizeCustomerAddresses } from '../utils/customerAddressV2';

const parseAliases = (value: unknown): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map(item => String(item).trim()).filter(Boolean)));
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return Array.from(new Set(parsed.map(item => String(item).trim()).filter(Boolean)));
      }
    } catch {
      return Array.from(new Set(trimmed.split(/[\n,;，、]+/).map(item => String(item).trim()).filter(Boolean)));
    }
  }
  return [];
};

const parseContacts = (value: unknown): Contact[] => {
  const raw = typeof value === 'string'
    ? (() => {
      try {
        return JSON.parse(value);
      } catch {
        return [];
      }
    })()
    : value;

  if (!Array.isArray(raw)) return [];

  const contacts = raw
    .map((entry): Contact | null => {
      const item = toApiRecord(entry);
      const name = toStringValue(item.name || item.contactName).trim();
      const phone = toStringValue(item.phone || item.mobile || item.contactPhone).trim();
      const email = toStringValue(item.email || item.contactEmail).trim();
      if (!name && !phone && !email) return null;

      return {
        name,
        position: toStringValue(item.position || item.role),
        phone,
        email,
        isPrimary: Boolean(item.isPrimary),
        role: toOptionalString(item.role),
        department: toOptionalString(item.department),
        language: item.language as Contact['language'],
        mobile: toOptionalString(item.mobile),
        whatsapp: toOptionalString(item.whatsapp),
        wechat: toOptionalString(item.wechat),
        addressId: toOptionalString(item.addressId),
        siteLabel: toOptionalString(item.siteLabel),
      };
    })
    .filter((entry): entry is Contact => Boolean(entry));

  const primaryIndex = contacts.findIndex(contact => contact.isPrimary);
  return contacts.map((contact, index) => ({
    ...contact,
    isPrimary: primaryIndex >= 0 ? index === primaryIndex : index === 0,
  }));
};

export interface PurchaseOrder {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierNameZh?: string;
  supplierNameEn?: string;
  supplierNameVi?: string;
  nameAliases?: string[];
  supplierDisplayName?: string;
  item: string;
  quantity: number;
  unit: string;
  price: number;
  currency?: string;
  exchangeRate?: number;
  taxRate?: number;
  taxAmount?: number;
  freightCost?: number;
  dutyCost?: number;
  insuranceCost?: number;
  otherCost?: number;
  landedCostAmount?: number;
  landedUnitCost?: number;
  eta: string;
  status: 'pending' | 'approved' | 'in_transit' | 'received' | 'cancelled';
  salesOrderRef?: string;
  salesOrderId?: string;
  isB2B?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface PurchaseReceipt {
  id: string;
  receiptNo: string;
  purchaseOrderId: string;
  quantity: number;
  acceptedQuantity: number;
  rejectedQuantity: number;
  unit: string;
  batchNo?: string | null;
  stockEntryRef?: string | null;
  discrepancyReason?: string | null;
  note?: string | null;
  receivedAt?: string;
  createdAt?: string;
}

export interface PurchaseReceiptSummary {
  orderedQuantity: number;
  processedQuantity: number;
  acceptedQuantity: number;
  rejectedQuantity: number;
  remainingQuantity: number;
  receiptCount: number;
}

export interface PurchaseReceiptBundle {
  purchaseOrder: PurchaseOrder;
  receiptSummary: PurchaseReceiptSummary;
  receipts: PurchaseReceipt[];
  discrepancyCases: ReceiptDiscrepancyCase[];
  discrepancyCase?: ReceiptDiscrepancyCase | null;
}

export interface Supplier {
  id: string;
  name: string;
  nameZh?: string;
  nameEn?: string;
  nameVi?: string;
  nameAliases?: string[];
  contacts?: Contact[];
  addresses?: CustomerAddress[];
  supplierDisplayName?: string;
  category: string;
  rating: number;
  leadTimeDays: number;
  riskLevel: 'low' | 'medium' | 'high';
  contact: string;
  status?: 'active' | 'inactive';
}

export interface B2BLinkResult {
  success: boolean;
  message: string;
  purchaseOrder?: PurchaseOrder;
  salesOrder?: LinkedSalesOrderRef;
}

export interface LinkedSalesOrderRef extends ApiRecord {
  id?: string;
  orderNo?: string;
  customerName?: string;
  customerNameZh?: string;
  customerNameEn?: string;
  customerNameVi?: string;
  customerDisplayName?: string;
  status?: string;
}

const mapLinkedSalesOrder = (value: unknown): LinkedSalesOrderRef => {
  const item = toApiRecord(value);
  return {
    ...item,
    id: toOptionalString(item.id),
    orderNo: toOptionalString(item.orderNo),
    customerName: toOptionalString(item.customerName),
    customerNameZh: toOptionalString(item.customerNameZh),
    customerNameEn: toOptionalString(item.customerNameEn),
    customerNameVi: toOptionalString(item.customerNameVi),
    customerDisplayName: toOptionalString(item.customerDisplayName),
    status: toOptionalString(item.status),
  };
};

const mapSupplier = (value: unknown): Supplier => {
  const item = toApiRecord(value);
  return {
  ...item,
  id: toStringValue(item.id),
  name: toStringValue(item.name),
  nameZh: toOptionalString(item.nameZh),
  nameEn: toOptionalString(item.nameEn),
  nameVi: toOptionalString(item.nameVi),
  nameAliases: parseAliases(item.nameAliases),
  contacts: parseContacts(item.contacts || item.contactsJson),
  addresses: normalizeCustomerAddresses(item.addresses || item.addressesJson || item.address || null) as CustomerAddress[],
  supplierDisplayName: toStringValue(item.supplierDisplayName || item.nameZh || item.nameEn || item.nameVi || item.name),
  category: toStringValue(item.category),
  contact: toStringValue(item.contact),
  riskLevel: (item.riskLevel || 'low') as Supplier['riskLevel'],
  rating: toNumberValue(item.rating),
  leadTimeDays: toNumberValue(item.leadTimeDays),
  status: (item.status || 'active') as Supplier['status'],
  };
};

const mapOrder = (value: unknown): PurchaseOrder => {
  const item = toApiRecord(value);
  return {
  ...item,
  id: toStringValue(item.id),
  supplierId: toStringValue(item.supplierId),
  supplierName: toStringValue(item.supplierName),
  supplierNameZh: toOptionalString(item.supplierNameZh),
  supplierNameEn: toOptionalString(item.supplierNameEn),
  supplierNameVi: toOptionalString(item.supplierNameVi),
  supplierDisplayName: toStringValue(item.supplierDisplayName || item.supplierNameZh || item.supplierNameEn || item.supplierNameVi || item.supplierName),
  item: toStringValue(item.item),
  quantity: toNumberValue(item.quantity),
  unit: toStringValue(item.unit),
  price: toNumberValue(item.price),
  currency: toStringValue(item.currency, 'CNY'),
  exchangeRate: toNumberValue(item.exchangeRate, 1),
  taxRate: toNumberValue(item.taxRate),
  taxAmount: toNumberValue(item.taxAmount),
  freightCost: toNumberValue(item.freightCost),
  dutyCost: toNumberValue(item.dutyCost),
  insuranceCost: toNumberValue(item.insuranceCost),
  otherCost: toNumberValue(item.otherCost),
  landedCostAmount: toNumberValue(item.landedCostAmount),
  landedUnitCost: toNumberValue(item.landedUnitCost),
  eta: toStringValue(item.eta),
  status: (item.status || 'pending') as PurchaseOrder['status'],
  salesOrderRef: toStringValue(item.salesOrderRef),
  salesOrderId: toOptionalString(item.salesOrderId) || '',
  isB2B: Boolean(item.isB2B),
  createdAt: toStringValue(item.createdAt, new Date().toISOString()),
  updatedAt: toStringValue(item.updatedAt, new Date().toISOString()),
  };
};

const mapReceipt = (value: unknown): PurchaseReceipt => {
  const item = toApiRecord(value);
  return {
  ...item,
  id: toStringValue(item.id),
  receiptNo: toStringValue(item.receiptNo || item.id),
  purchaseOrderId: toStringValue(item.purchaseOrderId),
  quantity: toNumberValue(item.quantity),
  acceptedQuantity: toNumberValue(item.acceptedQuantity),
  rejectedQuantity: toNumberValue(item.rejectedQuantity),
  unit: toStringValue(item.unit, 'kg'),
  batchNo: toOptionalString(item.batchNo) || null,
  stockEntryRef: toOptionalString(item.stockEntryRef) || null,
  discrepancyReason: toOptionalString(item.discrepancyReason) || null,
  note: toOptionalString(item.note) || null,
  receivedAt: toOptionalString(item.receivedAt || item.createdAt),
  createdAt: toOptionalString(item.createdAt || item.receivedAt),
  };
};

const mapReceiptSummary = (value: unknown): PurchaseReceiptSummary => {
  const item = toApiRecord(value);
  return {
  orderedQuantity: toNumberValue(item.orderedQuantity),
  processedQuantity: toNumberValue(item.processedQuantity),
  acceptedQuantity: toNumberValue(item.acceptedQuantity),
  rejectedQuantity: toNumberValue(item.rejectedQuantity),
  remainingQuantity: toNumberValue(item.remainingQuantity),
  receiptCount: toNumberValue(item.receiptCount),
  };
};

const mapReceiptBundle = (value: unknown): PurchaseReceiptBundle => {
  const item = toApiRecord(value);
  return {
  purchaseOrder: mapOrder(item.purchaseOrder || {}),
  receiptSummary: mapReceiptSummary(item.receiptSummary || {}),
  receipts: toUnknownArray(item.receipts).map(mapReceipt),
  discrepancyCases: toUnknownArray(item.discrepancyCases).map(mapReceiptDiscrepancyCase),
  discrepancyCase: item.discrepancyCase ? mapReceiptDiscrepancyCase(item.discrepancyCase) : null,
  };
};

export const procurementService = {
  async getAllOrders(): Promise<PurchaseOrder[]> {
    const response = await api.get<unknown, ApiDataResponse<unknown[]>>('/procurement/orders?pageSize=100');
    const list = Array.isArray(response.data) ? response.data : [];
    return list.map(mapOrder);
  },

  async createOrder(order: Partial<PurchaseOrder>): Promise<PurchaseOrder> {
    const payload = {
      supplierId: Number(order.supplierId),
      supplierName: order.supplierName,
      supplierNameZh: order.supplierNameZh,
      supplierNameEn: order.supplierNameEn,
      supplierNameVi: order.supplierNameVi,
      item: order.item,
      quantity: order.quantity,
      unit: order.unit,
      price: order.price,
      currency: order.currency || 'CNY',
      exchangeRate: order.exchangeRate ?? 1,
      taxRate: order.taxRate ?? 0,
      taxAmount: order.taxAmount ?? 0,
      freightCost: order.freightCost ?? 0,
      dutyCost: order.dutyCost ?? 0,
      insuranceCost: order.insuranceCost ?? 0,
      otherCost: order.otherCost ?? 0,
      eta: order.eta,
      status: order.status || 'pending',
      salesOrderRef: order.salesOrderRef,
      salesOrderId: order.salesOrderId,
      isB2B: order.isB2B || false,
    };

    const response = await api.post<unknown, ApiDataResponse<unknown>>('/procurement/orders', payload);
    return mapOrder(response.data);
  },

  async updateOrderStatus(id: string, status: PurchaseOrder['status']): Promise<PurchaseOrder> {
    const response = await api.patch<unknown, ApiDataResponse<unknown>>(`/procurement/orders/${id}/status`, { status });
    return mapOrder(response.data);
  },

  async getOrderReceipts(id: string): Promise<PurchaseReceiptBundle> {
    const response = await api.get<unknown, ApiDataResponse<unknown>>(`/procurement/orders/${id}/receipts`);
    return mapReceiptBundle(response.data);
  },

  async createReceipt(id: string, receipt: {
    quantity: number;
    acceptedQuantity: number;
    rejectedQuantity: number;
    discrepancyType?: ReceiptDiscrepancyType;
    batchNo?: string;
    discrepancyReason?: string;
    note?: string;
  }): Promise<PurchaseReceiptBundle> {
    const response = await api.post<unknown, ApiDataResponse<unknown>>(`/procurement/orders/${id}/receipts`, receipt);
    return mapReceiptBundle(response.data);
  },

  async getAllSuppliers(search = '', options: ApiRequestOptions = {}): Promise<Supplier[]> {
    const query = search ? `?pageSize=100&search=${encodeURIComponent(search)}` : '?pageSize=100';
    const response = await api.get<unknown, ApiDataResponse<unknown[]>>(`/procurement/suppliers${query}`, { signal: options.signal });
    const list = Array.isArray(response.data) ? response.data : [];
    return list.map(mapSupplier);
  },

  async createSupplier(supplier: Omit<Supplier, 'id'>): Promise<Supplier> {
    const response = await api.post<unknown, ApiDataResponse<unknown>>('/procurement/suppliers', supplier);
    return mapSupplier(response.data);
  },

  async linkB2BOrder(purchaseOrderId: string, salesOrderId: string): Promise<B2BLinkResult> {
    try {
      const response = await api.post<unknown, ApiDataResponse<ApiRecord>>(`/procurement/orders/${purchaseOrderId}/link-b2b`, { salesOrderId });
      return {
        success: true,
        message: '关联成功',
        purchaseOrder: response.data.purchaseOrder ? mapOrder(response.data.purchaseOrder) : undefined,
        salesOrder: response.data.salesOrder ? mapLinkedSalesOrder(response.data.salesOrder) : undefined,
      };
    } catch (error: unknown) {
      return {
        success: false,
        message: error instanceof Error ? error.message : '关联失败',
        purchaseOrder: undefined,
        salesOrder: undefined,
      };
    }
  },

  async getB2BStatus(salesOrderId: string): Promise<{ linked: boolean; purchaseOrder?: PurchaseOrder }> {
    try {
      const response = await api.get<unknown, ApiDataResponse<ApiRecord>>(`/procurement/b2b-status/${salesOrderId}`);
      return {
        linked: Boolean(response.data.linked),
        purchaseOrder: response.data.purchaseOrder ? mapOrder(response.data.purchaseOrder) : undefined,
      };
    } catch {
      return { linked: false };
    }
  },

  async syncB2BStatus(salesOrderId: string, salesStatus: OrderStatus): Promise<B2BLinkResult> {
    try {
      const response = await api.post<unknown, ApiDataResponse<ApiRecord>>(`/procurement/sync-b2b/${salesOrderId}`, { salesStatus });
      return {
        success: true,
        message: '同步成功',
        purchaseOrder: response.data.purchaseOrder ? mapOrder(response.data.purchaseOrder) : undefined,
        salesOrder: response.data.salesOrder ? mapLinkedSalesOrder(response.data.salesOrder) : undefined,
      };
    } catch (error: unknown) {
      return {
        success: false,
        message: error instanceof Error ? error.message : '同步失败',
        purchaseOrder: undefined,
        salesOrder: undefined,
      };
    }
  },
};

export default procurementService;
