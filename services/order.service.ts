import api, { ApiRequestOptions } from '../utils/api';
import { SalesOrder, OrderStatus, CommissionStatus, PaymentRecord, HistoryLog, CollectionPromiseSnapshot } from '../types';
import { ApiDataResponse, toApiRecord, toApiRecordArray, toNumberValue, toOptionalString, toStringValue, toUnknownArray } from '../utils/apiMapping';
import { decorateSalesOrder } from '../utils/orderCommercialState';

const normalizeDate = (value: unknown) => {
    if (!value) return '';
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().split('T')[0];
};

const mapPaymentRecord = (value: unknown): PaymentRecord => {
    const record = toApiRecord(value);
    return {
    ...record,
    id: toStringValue(record.id),
    orderId: toOptionalString(record.orderId),
    date: normalizeDate(record.date || record.createdAt),
    amount: toNumberValue(record.amount),
    currency: toOptionalString(record.currency),
    exchangeRate: record.exchangeRate != null ? toNumberValue(record.exchangeRate) : undefined,
    baseAmount: record.baseAmount != null ? toNumberValue(record.baseAmount) : undefined,
    method: toStringValue(record.method),
    isProxy: Boolean(record.isProxy),
    payerName: toOptionalString(record.payerName),
    note: toOptionalString(record.note),
    recordedBy: toOptionalString(record.recordedBy || record.verifiedBy),
    status: String(record.status || '').toLowerCase() === 'verified' ? 'verified' : 'pending',
    createdByRole: record.createdByRole as PaymentRecord['createdByRole'],
    milestoneId: toOptionalString(record.milestoneId),
    };
};

const mapHistoryLog = (value: unknown): HistoryLog => {
    const log = toApiRecord(value);
    return {
    id: toStringValue(log.id),
    date: String(log.date || log.createdAt || new Date().toISOString()),
    action: String(log.action || ''),
    user: String(log.user || log.operatorName || log.username || ''),
    details: String(log.details || ''),
    };
};

const mapCollectionPromise = (value: unknown): CollectionPromiseSnapshot => {
    const record = toApiRecord(value);
    return {
    ...record,
    id: toStringValue(record.id),
    promiseNo: toOptionalString(record.promiseNo),
    promisedAmount: toNumberValue(record.promisedAmount),
    promisedAt: String(record.promisedAt || record.createdAt || ''),
    channel: toOptionalString(record.channel),
    contactName: toOptionalString(record.contactName),
    contactPhone: toOptionalString(record.contactPhone),
    note: toOptionalString(record.note),
    status: toOptionalString(record.status),
    createdAt: record.createdAt ? String(record.createdAt) : undefined,
    };
};

const mapSalesOrderItem = (value: unknown): SalesOrder['items'][number] => {
    const orderItem = toApiRecord(value);
    return {
        ...orderItem,
        sku: toStringValue(orderItem.sku),
        productName: toStringValue(orderItem.productName || orderItem.name),
        packagingSpec: toStringValue(orderItem.packagingSpec),
        quantity: toNumberValue(orderItem.quantity),
        unit: toStringValue(orderItem.unit, 'kg'),
        unitPrice: toNumberValue(orderItem.unitPrice),
        discount: toNumberValue(orderItem.discount),
        taxAmount: toNumberValue(orderItem.taxAmount),
        amount: toNumberValue(orderItem.amount ?? orderItem.totalPrice),
    };
};

const mapExtraItem = (value: unknown): NonNullable<SalesOrder['extraItems']>[number] => {
    const item = toApiRecord(value);
    return {
        productName: toStringValue(item.productName || item.name),
        quantity: toNumberValue(item.quantity),
        type: item.type === 'compensation' ? 'compensation' : 'gift',
        note: toOptionalString(item.note),
    };
};

const mapOrderResponse = (value: unknown): SalesOrder => {
    const item = toApiRecord(value);
    const customer = toApiRecord(item.customer);
    const customerName = toStringValue(item.customerName || item.customerDisplayName || customer.name || customer.nameZh || customer.nameEn || customer.nameVi);
    const customerNameZh = toOptionalString(item.customerNameZh || customer.nameZh);
    const customerNameEn = toOptionalString(item.customerNameEn || customer.nameEn);
    const customerNameVi = toOptionalString(item.customerNameVi || customer.nameVi);
    const customerDisplayName = toStringValue(
        item.customerDisplayName
        || customer.displayName
        || customerNameZh
        || customerNameEn
        || customerNameVi
        || customerName,
    );

    return decorateSalesOrder({
        ...item,
        id: toStringValue(item.id),
        orderNo: toOptionalString(item.orderNo),
        contractId: toOptionalString(item.contractId),
        customerId: toStringValue(item.customerId),
        customerName,
        customerNameZh,
        customerNameEn,
        customerNameVi,
        customerDisplayName,
        totalAmount: toNumberValue(item.totalAmount),
        finalAmount: item.finalAmount != null ? toNumberValue(item.finalAmount) : undefined,
        baseAmount: item.baseAmount != null ? toNumberValue(item.baseAmount) : undefined,
        paidAmount: toNumberValue(item.paidAmount),
        commissionAmount: item.commissionAmount != null ? toNumberValue(item.commissionAmount) : undefined,
        paymentTermsDays: toNumberValue(item.paymentTermsDays ?? item.paymentTerms),
        items: toApiRecordArray(item.items).map(mapSalesOrderItem),
        extraItems: toUnknownArray(item.extraItems).map(mapExtraItem),
        paymentRecords: toUnknownArray(item.paymentRecords).map(mapPaymentRecord),
        historyLogs: toUnknownArray(item.historyLogs).map(mapHistoryLog),
        collectionPromises: toUnknownArray(item.collectionPromises).map(mapCollectionPromise),
        orderDate: normalizeDate(item.orderDate),
        dueDate: item.dueDate ? normalizeDate(item.dueDate) : undefined,
    });
};

export const orderService = {
    async getAll(options: ApiRequestOptions = {}): Promise<SalesOrder[]> {
        const response = await api.get<unknown, ApiDataResponse<unknown[]>>('/orders?pageSize=100', { signal: options.signal });
        const list = Array.isArray(response.data) ? response.data : [];
        return list.map(mapOrderResponse);
    },

    async getById(id: string): Promise<SalesOrder> {
        const response = await api.get<unknown, ApiDataResponse<unknown>>(`/orders/${id}`);
        return mapOrderResponse(response.data);
    },

    async create(order: SalesOrder): Promise<SalesOrder> {
        const payload = {
            customerId: Number(order.customerId),
            customerName: order.customerName,
            items: order.items,
            paymentTerms: order.paymentTermsDays,
            notes: order.notes,
            contractId: order.contractId ? Number(order.contractId) : null,
            extraItems: order.extraItems,
            taxInclusive: order.taxInclusive,
            commissionRate: 3,
        };

        const response = await api.post<unknown, ApiDataResponse<unknown>>('/orders', payload);
        return mapOrderResponse(response.data);
    },

    async update(order: SalesOrder, userName: string): Promise<SalesOrder> {
        void userName;
        const payload = {
            ...order,
            customerId: Number(order.customerId),
            contractId: order.contractId ? Number(order.contractId) : null,
        };
        const response = await api.put<unknown, ApiDataResponse<unknown>>(`/orders/${order.id}`, payload);
        return mapOrderResponse(response.data);
    },

    async updateStatus(id: string, status: OrderStatus): Promise<SalesOrder> {
        const response = await api.patch<unknown, ApiDataResponse<unknown>>(`/orders/${id}/status`, { status });
        return mapOrderResponse(response.data);
    },

    async recordPayment(orderId: string, payment: PaymentRecord): Promise<SalesOrder> {
        const response = await api.post<unknown, ApiDataResponse<unknown>>(`/orders/${orderId}/payment`, {
            amount: payment.amount,
            method: payment.method,
            date: payment.date,
            note: payment.note,
            isProxy: payment.isProxy,
            payerName: payment.payerName,
        });
        return mapOrderResponse(response.data);
    },

    async verifyPayment(orderId: string, paymentId: string): Promise<SalesOrder> {
        const response = await api.post<unknown, ApiDataResponse<unknown>>(`/orders/${orderId}/payment/${paymentId}/verify`);
        return mapOrderResponse(response.data);
    },

    async auditCommission(_id: string, _status: CommissionStatus): Promise<void> {
        // 提成审核状态已由后端流程更新，这里保持兼容占位。
        return Promise.resolve();
    }
};
