export const getCustomerDisplayName = (customer: {
    name: string;
    nameZh?: string | null;
    nameEn?: string | null;
    nameVi?: string | null;
}) => customer.nameZh || customer.nameEn || customer.nameVi || customer.name;

export interface PaymentStateInput {
    orderId: number;
    finalAmount: number;
    paidAmount: number;
    paymentStatus: string;
}

export interface AgingBucketSummary {
    current: number;
    '1_7': number;
    '8_15': number;
    '16_30': number;
    '31_60': number;
    '60_plus': number;
}

export interface ReceivablesSnapshot {
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
    agingBuckets: AgingBucketSummary;
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
        customerDisplayName?: string | null;
        milestoneTitle: string | null;
    }>;
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

export type ReceivablesBaseSnapshot = Omit<ReceivablesSnapshot, 'recentPayments'>;
