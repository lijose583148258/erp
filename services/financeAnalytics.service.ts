import api from '../utils/api';

export interface FinanceMonthlyTrendRow {
  period: string;
  revenue: number;
  received: number;
  outstanding: number;
  overdue: number;
  orderCount: number;
}

export interface FinanceCustomerRow {
  customerId: number;
  customerName: string;
  customerNameZh?: string | null;
  customerNameEn?: string | null;
  customerNameVi?: string | null;
  salespersonName: string | null;
  riskLevel: string | null;
  collectionsStatus: string;
  dunningLevel: number;
  revenue: number;
  received: number;
  receivable: number;
  overdue: number;
  paymentRate: number;
  creditHold: boolean;
  shipmentHold: boolean;
  nextActionAt: string | null;
}

export interface FinanceSummary {
  overview: {
    totalRevenue: number;
    totalReceived: number;
    totalReceivable: number;
    overdueAmount: number;
    dueSoonAmount: number;
    paymentRate: number;
    commissionPendingAmount: number;
    pendingVerificationCount: number;
    openPromiseCount: number;
    openPromiseAmount: number;
    openDisputeCount: number;
    creditHoldCustomerCount: number;
    shipmentHoldOrderCount: number;
    adjustmentNetAmount: number;
    adjustmentCount: number;
  };
  paymentStatusBreakdown: Record<string, { count: number; amount: number }>;
  agingBuckets: {
    current: number;
    '1_7': number;
    '8_15': number;
    '16_30': number;
    '31_60': number;
    '60_plus': number;
  };
  monthlyTrend: FinanceMonthlyTrendRow[];
  topCustomers: FinanceCustomerRow[];
  recentPayments: Array<{
    id: number;
    amount: number;
    method: string;
    status: string;
    createdAt: string;
    orderNo: string;
    customerName: string;
    customerNameZh?: string | null;
    customerNameEn?: string | null;
    customerNameVi?: string | null;
    milestoneTitle: string | null;
  }>;
  recentAdjustments: Array<{
    id: number;
    adjustmentNo: string;
    domain: string;
    targetRef: string | null;
    customerName: string | null;
    customerNameZh?: string | null;
    customerNameEn?: string | null;
    customerNameVi?: string | null;
    orderNo: string | null;
    batchNo: string | null;
    reason: string;
    quantityDelta: number | null;
    amountDelta: number | null;
    status: string;
    createdAt: string;
  }>;
  insights: string[];
}

export interface FinanceLedgerRow {
  entryNo: string;
  voucherType: string;
  sourceType: 'payment' | 'adjustment';
  sourceStatus: string;
  postingDate: string;
  customerName: string | null;
  customerNameZh?: string | null;
  customerNameEn?: string | null;
  customerNameVi?: string | null;
  orderNo: string | null;
  batchNo: string | null;
  sourceRef: string | null;
  amount: number;
  impactAmount: number;
  balanceAfter: number;
  note: string | null;
  createdAt: string;
}

export interface FinanceLedgerSummary {
  totalCount: number;
  postedCount: number;
  pendingCount: number;
  totalInflow: number;
  totalOutflow: number;
  netAmount: number;
  rows: FinanceLedgerRow[];
}

export interface FinanceCashflowRow {
  period: string;
  inflow: number;
  outflow: number;
  net: number;
  receiptCount: number;
  adjustmentCount: number;
  pendingReceiptAmount: number;
}

export interface FinanceCashflowSummary {
  totalInflow: number;
  totalOutflow: number;
  netCashflow: number;
  pendingReceiptAmount: number;
  rows: FinanceCashflowRow[];
}

export interface FinanceWorkspace {
  summary: FinanceSummary;
  ledger: FinanceLedgerSummary;
  cashflow: FinanceCashflowSummary;
}

export const financeAnalyticsService = {
  async getSummary(): Promise<FinanceSummary> {
    const response = await api.get<any, { success: boolean; data: FinanceSummary }>('/finance/summary');
    return response.data;
  },
  async getWorkspace(): Promise<FinanceWorkspace> {
    const response = await api.get<any, { success: boolean; data: FinanceWorkspace }>('/finance/workspace');
    return response.data;
  },
};
