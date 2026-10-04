import api, { ApiRequestOptions } from '../utils/api';

export interface CollectionSummary {
  totalOrders: number;
  totalReceivable: number;
  totalPaid: number;
  overdueAmount: number;
  dueSoonAmount: number;
  overdueCount: number;
  dueSoonCount: number;
  paidCount: number;
  partialCount: number;
  unpaidCount: number;
  pendingVerificationCount: number;
  openPromiseCount: number;
  openPromiseAmount: number;
  openDisputeCount: number;
  creditHoldCustomerCount: number;
  shipmentHoldOrderCount: number;
  agingBuckets: {
    current: number;
    '1_7': number;
    '8_15': number;
    '16_30': number;
    '31_60': number;
    '60_plus': number;
  };
  priorityActions: Array<{
    orderId: number;
    orderNo: string;
    customerName: string;
    customerNameZh?: string | null;
    customerNameEn?: string | null;
    customerNameVi?: string | null;
    customerDisplayName?: string | null;
    outstanding: number;
    daysOverdue: number;
    level: number;
    label: string;
    nextAction: string;
    channel: string;
    holdRecommended: boolean;
  }>;
  recentPayments: CollectionLedgerRecord[];
}

export interface CollectionPromiseRecord {
  id: number;
  promiseNo: string;
  customerId: number;
  customerName: string;
  customerNameZh?: string | null;
  customerNameEn?: string | null;
  customerNameVi?: string | null;
  customerDisplayName?: string | null;
  orderId: number;
  orderNo: string;
  promisedAmount: number;
  promisedAt: string;
  channel: string;
  contactName: string | null;
  contactPhone: string | null;
  status: string;
  note: string | null;
  createdAt: string;
}

export interface CollectionDisputeRecord {
  id: number;
  disputeNo: string;
  customerId: number;
  customerName: string;
  customerNameZh?: string | null;
  customerNameEn?: string | null;
  customerNameVi?: string | null;
  customerDisplayName?: string | null;
  orderId: number;
  orderNo: string;
  disputedAmount: number | null;
  reasonCategory: string;
  reason: string;
  evidenceJson: string | null;
  status: string;
  note: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface CollectionHoldRecord {
  scope: 'customer-credit' | 'customer-shipment' | 'order-shipment';
  id: number;
  customerId: number;
  customerName: string;
  customerNameZh?: string | null;
  customerNameEn?: string | null;
  customerNameVi?: string | null;
  customerDisplayName?: string | null;
  orderId: number | null;
  orderNo: string | null;
  reason: string | null;
  source: string | null;
  status: boolean;
  updatedAt: string | null;
}

export interface CollectionLedgerRecord {
  id: number;
  amount: number;
  method: string;
  status: string;
  date: string;
  note: string | null;
  payerName: string | null;
  isProxy: boolean;
  createdAt: string;
  verifiedBy: number | null;
  orderId: number;
  orderNo: string;
  contractNo: string | null;
  customerId: number;
  customerName: string;
  customerNameZh?: string | null;
  customerNameEn?: string | null;
  customerNameVi?: string | null;
  customerDisplayName?: string | null;
  riskLevel: string;
  finalAmount: number;
  paidAmount: number;
  receivableAdjustmentAmount?: number;
  paymentStatus: string;
  milestoneId: number | null;
  milestoneTitle: string | null;
  milestonePercentage: number | null;
}

export type PaymentReversalReason = 'registration_error' | 'bank_return';
export type PaymentReversalDecision = 'approve' | 'reject';
export interface OriginalPaymentFacts {
  version: 'original-payment-facts/v1';
  id: number;
  orderId: number;
  amount: number;
  currency: string;
  exchangeRate: number;
  baseAmount: number;
  method: string;
  date: string;
  payerName: string | null;
  isProxy: boolean;
  note: string | null;
  verifiedBy: number | null;
  milestoneId: number | null;
  createdAt: string;
}
export interface PaymentReversalRequestReceipt {
  version: 'payment-reversal-request/v1';
  requestId: string;
  requestKey: string;
  paymentId: number;
  orderId: number;
  requestedBy: number;
  amount: number;
  currency: string;
  status: 'pending';
  auditId: number;
  requestedAt: string;
  reasonCategory: PaymentReversalReason;
  reason: string;
}
export interface PaymentReversalReviewReceipt {
  version: 'payment-reversal-review/v1';
  requestId: string;
  reviewKey: string;
  paymentId: number;
  orderId: number;
  requestedBy: number;
  reviewedBy: number;
  amount: number;
  currency: string;
  status: 'posted' | 'rejected';
  auditId: number;
  reviewedAt: string;
  beforePaidAmount: number;
  afterPaidAmount: number;
  reversalId: string | null;
}
export interface PaymentReversalRequestRecord {
  id: string;
  paymentId: number;
  status: 'pending' | 'posted' | 'rejected';
  requestedBy: number;
  reasonCategory: PaymentReversalReason;
  reason: string;
  createdAt: string;
  reviewedBy: number | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  originalPayment: OriginalPaymentFacts;
  requestReceipt: PaymentReversalRequestReceipt;
  reviewReceipt: PaymentReversalReviewReceipt | null;
}
export interface PaymentReversalOrderSnapshot {
  id: number;
  currency: string;
  finalAmount: number;
  paidAmount: number;
  receivableAdjustmentAmount: number;
  paymentStatus: string;
}
export interface PaymentReversalHistory {
  paymentId: number;
  paymentStatus: string;
  originalPayment: OriginalPaymentFacts;
  currentOrder: PaymentReversalOrderSnapshot;
  /** Server-side eligibility includes barter ownership, not just the method label. */
  eligibility: { allowed: boolean; errorCode?: string; message?: string };
  requests: PaymentReversalRequestRecord[];
  reversal: null | {
    id: string;
    requestId: string;
    amount: number;
    currency: string;
    postedBy: number;
    auditId: number;
    postedAt: string;
    receipt: PaymentReversalReviewReceipt;
  };
}
export interface PaymentReversalResult {
  replayed: boolean;
  request: PaymentReversalRequestRecord;
  receipt: PaymentReversalRequestReceipt | PaymentReversalReviewReceipt;
  currentOrder: PaymentReversalOrderSnapshot;
}

export interface CollectionOverdueRecord {
  orderId: number;
  orderNo: string;
  dueDate: string;
  daysOverdue: number;
  level: number;
  label: string;
  nextAction: string;
  channel: string;
  holdRecommended: boolean;
  outstanding: number;
  finalAmount: number;
  paidAmount: number;
  receivableAdjustmentAmount?: number;
  paymentStatus: string;
  customerId: number;
  customerName: string;
  customerNameZh?: string | null;
  customerNameEn?: string | null;
  customerNameVi?: string | null;
  customerDisplayName?: string | null;
  contactName: string | null;
  contactPhone: string | null;
  ownerName: string;
  riskLevel: string;
  overdueAmount: number;
  collectionsStatus: string;
  dunningLevel: number;
  nextActionAt: string | null;
  reminderCount: number;
  lastReminderAt: string | null;
  contractNo: string | null;
  contractTitle: string | null;
}

export interface CollectionMilestoneRecord {
  id: number;
  title: string;
  percentage: number;
  targetAmount: number;
  paidAmount: number;
  remainingAmount: number;
  dueDate: string | null;
  status: string;
  notes: string | null;
  contractId: number;
  contractNo: string;
  contractTitle: string;
  customerId: number;
  customerName: string;
  customerNameZh?: string | null;
  customerNameEn?: string | null;
  customerNameVi?: string | null;
  customerDisplayName?: string | null;
}

export interface BatchReminderResult {
  totalCount: number;
  createdCount: number;
  skippedCount: number;
}

export type CollectionListOptions = ApiRequestOptions & {
  page?: number;
  pageSize?: number;
  search?: string;
};

export interface CollectionListMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface CollectionListResult<T> {
  data: T[];
  meta: CollectionListMeta;
}

const normalizeListMeta = (meta: Partial<CollectionListMeta> | undefined, fallbackPageSize: number, rowCount: number): CollectionListMeta => {
  const page = Number(meta?.page || 1);
  const pageSize = Number(meta?.pageSize || fallbackPageSize);
  const total = Number(meta?.total ?? rowCount);
  const totalPages = Number(meta?.totalPages || Math.max(1, Math.ceil(total / Math.max(1, pageSize))));
  return { page, pageSize, total, totalPages };
};

export interface CollectionWorkbenchBundle {
  summary: CollectionSummary | null;
  ledger: CollectionLedgerRecord[];
  ledgerMeta?: CollectionListMeta;
  overdue: CollectionOverdueRecord[];
  overdueMeta?: CollectionListMeta;
  milestones: CollectionMilestoneRecord[];
  promises: CollectionPromiseRecord[];
  disputes: CollectionDisputeRecord[];
  holds: CollectionHoldRecord[];
  errors: string[];
}

export const collectionsService = {
  async getWorkbench(options: ApiRequestOptions = {}): Promise<CollectionWorkbenchBundle> {
    const response = await api.get<any, { success: boolean; data: CollectionWorkbenchBundle }>('/collections/workbench', { signal: options.signal });
    return {
      summary: response.data?.summary ?? null,
      ledger: Array.isArray(response.data?.ledger) ? response.data.ledger : [],
      ledgerMeta: response.data?.ledgerMeta,
      overdue: Array.isArray(response.data?.overdue) ? response.data.overdue : [],
      overdueMeta: response.data?.overdueMeta,
      milestones: Array.isArray(response.data?.milestones) ? response.data.milestones : [],
      promises: Array.isArray(response.data?.promises) ? response.data.promises : [],
      disputes: Array.isArray(response.data?.disputes) ? response.data.disputes : [],
      holds: Array.isArray(response.data?.holds) ? response.data.holds : [],
      errors: Array.isArray(response.data?.errors) ? response.data.errors : [],
    };
  },

  async getSummary(options: ApiRequestOptions = {}): Promise<CollectionSummary> {
    const response = await api.get<any, { success: boolean; data: CollectionSummary }>('/collections/summary', { signal: options.signal });
    return response.data;
  },

  async getLedger(options: ApiRequestOptions = {}): Promise<CollectionLedgerRecord[]> {
    const response = await api.get<any, { success: boolean; data: CollectionLedgerRecord[] }>('/collections/ledger?pageSize=100', { signal: options.signal });
    return Array.isArray(response.data) ? response.data : [];
  },

  async getOverdueOrdersPage(options: CollectionListOptions = {}): Promise<CollectionListResult<CollectionOverdueRecord>> {
    const params = new URLSearchParams();
    const pageSize = options.pageSize ?? 100;
    params.set('pageSize', String(pageSize));
    if (options.page) params.set('page', String(options.page));
    if (options.search?.trim()) params.set('search', options.search.trim());
    const response = await api.get<any, { success: boolean; data: CollectionOverdueRecord[]; meta?: CollectionListMeta }>(`/collections/overdue?${params.toString()}`, { signal: options.signal });
    const rows = Array.isArray(response.data) ? response.data : [];
    return {
      data: rows,
      meta: normalizeListMeta(response.meta, pageSize, rows.length),
    };
  },

  async getOverdueOrders(options: CollectionListOptions = {}): Promise<CollectionOverdueRecord[]> {
    const result = await this.getOverdueOrdersPage(options);
    return result.data;
  },

  async getMilestones(): Promise<CollectionMilestoneRecord[]> {
    const response = await api.get<any, { success: boolean; data: CollectionMilestoneRecord[] }>('/collections/milestones');
    return Array.isArray(response.data) ? response.data : [];
  },

  async getPromises(): Promise<CollectionPromiseRecord[]> {
    const response = await api.get<any, { success: boolean; data: CollectionPromiseRecord[] }>('/collections/promises');
    return Array.isArray(response.data) ? response.data : [];
  },

  async getDisputes(): Promise<CollectionDisputeRecord[]> {
    const response = await api.get<any, { success: boolean; data: CollectionDisputeRecord[] }>('/collections/disputes');
    return Array.isArray(response.data) ? response.data : [];
  },

  async getHolds(): Promise<CollectionHoldRecord[]> {
    const response = await api.get<any, { success: boolean; data: CollectionHoldRecord[] }>('/collections/holds');
    return Array.isArray(response.data) ? response.data : [];
  },

  async syncOverdue(): Promise<number> {
    const response = await api.post<any, { success: boolean; data: { updatedCustomers: number } }>('/collections/sync-overdue');
    return response.data?.updatedCustomers ?? 0;
  },

  async verifyPayment(paymentId: number): Promise<void> {
    await api.post(`/collections/payments/${paymentId}/verify`, {});
  },

  async getPaymentReversalHistory(paymentId: number, options: ApiRequestOptions = {}): Promise<PaymentReversalHistory> {
    const response = await api.get<any, { success: boolean; data: PaymentReversalHistory }>(`/collections/payments/${paymentId}/reversal-requests`, { signal: options.signal });
    return response.data;
  },

  async requestPaymentReversal(paymentId: number, payload: { requestKey: string; reasonCategory: PaymentReversalReason; reason: string }): Promise<PaymentReversalResult> {
    const response = await api.post<any, { success: boolean; data: PaymentReversalResult }>(`/collections/payments/${paymentId}/reversal-requests`, payload);
    return response.data;
  },

  async reviewPaymentReversal(requestId: string, payload: { reviewKey: string; decision: PaymentReversalDecision; note: string }): Promise<PaymentReversalResult> {
    const response = await api.post<any, { success: boolean; data: PaymentReversalResult }>(`/collections/payment-reversal-requests/${encodeURIComponent(requestId)}/review`, payload);
    return response.data;
  },

  async createReminder(orderId: number): Promise<void> {
    await api.post(`/collections/orders/${orderId}/remind`, {});
  },

  async createBatchReminders(orderIds: number[]): Promise<BatchReminderResult> {
    const response = await api.post<any, { success: boolean; data: BatchReminderResult }>('/collections/orders/remind-batch', { orderIds });
    return response.data;
  },

  async createPromise(payload: {
    customerId: number;
    orderId: number;
    promisedAmount: number;
    promisedAt: string;
    channel?: string;
    contactName?: string;
    contactPhone?: string;
    note?: string;
  }): Promise<CollectionPromiseRecord> {
    const response = await api.post<any, { success: boolean; data: CollectionPromiseRecord }>('/collections/promises', payload);
    return response.data;
  },

  async updatePromiseStatus(promiseId: number, status: 'kept' | 'missed' | 'cancelled'): Promise<void> {
    await api.patch(`/collections/promises/${promiseId}/status`, { status });
  },

  async createDispute(payload: {
    customerId: number;
    orderId: number;
    disputedAmount?: number | null;
    reasonCategory: string;
    reason: string;
    evidenceJson?: string | null;
    note?: string | null;
  }): Promise<CollectionDisputeRecord> {
    const response = await api.post<any, { success: boolean; data: CollectionDisputeRecord }>('/collections/disputes', payload);
    return response.data;
  },

  async updateDisputeStatus(disputeId: number, status: 'reviewing' | 'resolved' | 'rejected' | 'withdrawn'): Promise<void> {
    await api.patch(`/collections/disputes/${disputeId}/status`, { status });
  },

  async setCustomerHold(customerId: number, payload: { type: 'credit' | 'shipment'; reason: string; source?: string }): Promise<void> {
    await api.post(`/collections/customers/${customerId}/hold`, payload);
  },

  async releaseCustomerHold(customerId: number, type: 'credit' | 'shipment'): Promise<void> {
    await api.delete(`/collections/customers/${customerId}/hold`, { data: { type } });
  },

  async setOrderShipmentHold(orderId: number, payload: { reason: string; source?: string }): Promise<void> {
    await api.post(`/collections/orders/${orderId}/shipment-hold`, payload);
  },

  async releaseOrderShipmentHold(orderId: number): Promise<void> {
    await api.delete(`/collections/orders/${orderId}/shipment-hold`);
  },
};
