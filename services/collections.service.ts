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

export interface CollectionWorkbenchBundle {
  summary: CollectionSummary | null;
  ledger: CollectionLedgerRecord[];
  overdue: CollectionOverdueRecord[];
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
      overdue: Array.isArray(response.data?.overdue) ? response.data.overdue : [],
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

  async getOverdueOrders(options: ApiRequestOptions = {}): Promise<CollectionOverdueRecord[]> {
    const response = await api.get<any, { success: boolean; data: CollectionOverdueRecord[] }>('/collections/overdue?pageSize=100', { signal: options.signal });
    return Array.isArray(response.data) ? response.data : [];
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
