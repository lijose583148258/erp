import api, { ApiRequestOptions } from '../utils/api';
import { Shipment } from '../types';
import { ApiDataResponse, toApiRecord, toApiRecordArray, toNumberValue, toOptionalString, toStringValue, toUnknownArray } from '../utils/apiMapping';
import { ReceiptDiscrepancyCase, ReceiptDiscrepancyType, mapReceiptDiscrepancyCase } from './receiptDiscrepancy.service';

export interface ShipmentReceiptEvent {
    id: string;
    receiptNo: string;
    shipmentId: string;
    quantity: number;
    acceptedQuantity: number;
    rejectedQuantity: number;
    unit: string;
    signedReceiptUrl?: string | null;
    discrepancyReason?: string | null;
    note?: string | null;
    receivedAt?: string;
    createdAt?: string;
}

export interface ShipmentReceiptSummary {
    shipmentQuantity: number;
    processedQuantity: number;
    acceptedQuantity: number;
    rejectedQuantity: number;
    remainingQuantity: number;
    receiptCount: number;
}

export interface ShipmentReceiptBundle {
    shipment: Shipment;
    receiptSummary: ShipmentReceiptSummary;
    receipts: ShipmentReceiptEvent[];
    discrepancyCases: ReceiptDiscrepancyCase[];
    discrepancyCase?: ReceiptDiscrepancyCase | null;
}

const mapShipment = (value: unknown, index = 0): Shipment => {
    const item = toApiRecord(value);
    const routes = ['深圳 -> 河内', '上海 -> 海防', '广州 -> 胡志明'];
    const route = toStringValue(item.route, routes[index % routes.length]);
    const isColdChain = item.isColdChain ?? index % 3 === 0;
    const temperature = item.temperature ?? (isColdChain ? 2 + (index % 4) : 22 + (index % 5));
    const firstItem = toApiRecordArray(item.items)[0] || {};
    const productName = toStringValue(item.productName || item.product || firstItem.productName, 'Chemical Goods');
    const quantity = toNumberValue(item.quantity ?? item.qty);

    return {
        ...item,
        id: toStringValue(item.id),
        orderId: toStringValue(item.orderNo || item.orderId),
        orderItemId: toOptionalString(item.orderItemId),
        materialId: toOptionalString(item.materialId),
        productBatchId: toOptionalString(item.productBatchId),
        customerId: toOptionalString(item.customerId),
        customerName: toStringValue(item.customerName || item.customerDisplayName || item.counterpartyName, 'Unknown'),
        sku: toStringValue(item.sku || item.productSku || firstItem.sku, productName),
        qty: quantity,
        quantity,
        shippedAt: item.shippedAt ? new Date(String(item.shippedAt)).toISOString().split('T')[0] : '-',
        deliveredAt: item.deliveredAt ? new Date(String(item.deliveredAt)).toISOString().split('T')[0] : undefined,
        status: toStringValue(item.status, 'pending'),
        productName,
        casNo: toOptionalString(item.casNo || item.cas || item.productCasNo || firstItem.casNo),
        msdsStatus: toStringValue(item.msdsStatus || item.msds_status || (item.msdsUrl || item.msdsDocumentUrl ? 'valid' : 'missing')),
        msdsUrl: toOptionalString(item.msdsUrl || item.msdsDocumentUrl),
        route,
        isColdChain: Boolean(isColdChain),
        temperature: toNumberValue(temperature),
        batchNo: toStringValue(item.batchNo, `BATCH-${1000 + index}`),
    };
};

const mapReceiptEvent = (value: unknown): ShipmentReceiptEvent => {
    const item = toApiRecord(value);
    return {
    ...item,
    id: toStringValue(item.id),
    receiptNo: toStringValue(item.receiptNo),
    shipmentId: toStringValue(item.shipmentId),
    quantity: toNumberValue(item.quantity),
    acceptedQuantity: toNumberValue(item.acceptedQuantity),
    rejectedQuantity: toNumberValue(item.rejectedQuantity),
    unit: toStringValue(item.unit, 'kg'),
    signedReceiptUrl: toOptionalString(item.signedReceiptUrl) || null,
    discrepancyReason: toOptionalString(item.discrepancyReason) || null,
    note: toOptionalString(item.note) || null,
    };
};

const mapReceiptSummary = (value: unknown): ShipmentReceiptSummary => {
    const item = toApiRecord(value);
    return {
        shipmentQuantity: toNumberValue(item.shipmentQuantity),
        processedQuantity: toNumberValue(item.processedQuantity),
        acceptedQuantity: toNumberValue(item.acceptedQuantity),
        rejectedQuantity: toNumberValue(item.rejectedQuantity),
        remainingQuantity: toNumberValue(item.remainingQuantity),
        receiptCount: toNumberValue(item.receiptCount),
    };
};

const mapReceiptBundle = (value: unknown): ShipmentReceiptBundle => {
    const item = toApiRecord(value);
    return {
        shipment: mapShipment(item.shipment || {}),
        receiptSummary: mapReceiptSummary(item.receiptSummary || {}),
        receipts: toUnknownArray(item.receipts).map(mapReceiptEvent),
        discrepancyCases: toUnknownArray(item.discrepancyCases).map(mapReceiptDiscrepancyCase),
        discrepancyCase: item.discrepancyCase ? mapReceiptDiscrepancyCase(item.discrepancyCase) : null,
    };
};

const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('read_failed'));
    reader.readAsDataURL(file);
});

export const shipmentService = {
    async getAll(options: ApiRequestOptions = {}): Promise<Shipment[]> {
        const response = await api.get<unknown, ApiDataResponse<unknown[]>>('/shipping', { signal: options.signal });
        const data = response.data || [];
        return data.map((item: unknown, index: number) => mapShipment(item, index));
    },

    async create(shipment: Partial<Shipment>): Promise<Shipment> {
        const response = await api.post<unknown, ApiDataResponse<unknown>>('/shipping', shipment);
        return mapShipment(response.data || {});
    },

    async updateStatus(id: string, status: string, receiptUrl?: string): Promise<Shipment> {
        const payload: { status: string; signedReceiptUrl?: string } = { status };
        if (receiptUrl) {
            payload.signedReceiptUrl = receiptUrl;
        }
        const response = await api.patch<unknown, ApiDataResponse<unknown>>(`/shipping/${id}/status`, payload);
        return mapShipment(response.data || {});
    },

    async uploadReceipt(id: string, file: File): Promise<Shipment> {
        const dataUrl = await readFileAsDataUrl(file);

        const response = await api.post<unknown, ApiDataResponse<unknown>>(`/shipping/${id}/receipt`, {
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            dataUrl,
        });
        const data = toApiRecord(response.data || {});
        return mapShipment(data.shipment || data);
    },

    async getReceiptEvents(id: string): Promise<ShipmentReceiptBundle> {
        const response = await api.get<unknown, ApiDataResponse<unknown>>(`/shipping/${id}/receipts`);
        return mapReceiptBundle(response.data || {});
    },

    async createReceiptEvent(id: string, receipt: {
        quantity: number;
        acceptedQuantity: number;
        rejectedQuantity: number;
        discrepancyType?: ReceiptDiscrepancyType;
        discrepancyReason?: string;
        note?: string;
        file?: File | null;
    }): Promise<ShipmentReceiptBundle> {
        let filePayload = {};
        if (receipt.file) {
            filePayload = {
                fileName: receipt.file.name,
                mimeType: receipt.file.type || 'application/octet-stream',
                dataUrl: await readFileAsDataUrl(receipt.file),
            };
        }

        const response = await api.post<unknown, ApiDataResponse<unknown>>(`/shipping/${id}/receipt-events`, {
            quantity: receipt.quantity,
            acceptedQuantity: receipt.acceptedQuantity,
            rejectedQuantity: receipt.rejectedQuantity,
            discrepancyType: receipt.discrepancyType,
            discrepancyReason: receipt.discrepancyReason,
            note: receipt.note,
            ...filePayload,
        });
        return mapReceiptBundle(response.data || {});
    }
};
