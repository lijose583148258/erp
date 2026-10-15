import api, { ApiRequestOptions } from '../utils/api';
import { Shipment } from '../types';
import { ApiDataResponse, toApiRecord, toNumberValue, toOptionalString, toStringValue, toUnknownArray } from '../utils/apiMapping';
import { ReceiptDiscrepancyCase, ReceiptDiscrepancyType, mapReceiptDiscrepancyCase } from './receiptDiscrepancy.service';
import type { ShipmentSubmissionAck, ShipmentSubmissionResult } from './shipmentSubmissionIntent';
import { mapShipment } from './shipmentReadModel';

export type ShipmentOccurrence = { occurredAt: string; timeZone: string };
export type ShipmentSupplementPatch = { batchNo?: string; carrier?: string | null; trackingNo?: string | null; dispatchOccurrence?: ShipmentOccurrence | null };
type SupplementSnapshot = { batchNo: string | null; carrier: string | null; trackingNo: string | null; dispatchOccurrence: ShipmentOccurrence | null };
export type ShipmentSupplementView = {
    shipment: Shipment & { createdAt: string; updatedAt: string; reservationAuditId: number | null };
    versionId: number | null; dispatchOccurrence: ShipmentOccurrence | null;
    history: Array<{ auditId: number; actorId: number; enteredAt: string; reason: string | null; changedFields: string[];
        before: SupplementSnapshot; after: SupplementSnapshot }>;
};
export type ShipmentSupplementInput = { expectedAuditId: number | null; expectedUpdatedAt: string; patch: ShipmentSupplementPatch; reason?: string };
export type ShipmentReservationBundle = {
    state: 'legacy_unknown' | 'unreserved' | 'reserved' | 'released' | 'consumed'; activeQuantity: number;
    reservation: { schema: 'shipment-reservation/v1'; auditId: number; actorId: number; action: 'reserve' | 'release' | 'consume';
        shipmentId: number; previousAuditId: number | null; quantity: number; unit: string; batchNo: string; reason: string | null } | null;
    shipment: { id: number; shipmentNo: string; status: string; quantity: number; unit: string; batchNo: string | null; materialId: number | null };
};

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
        return data.map((item: unknown) => mapShipment(item));
    },

    async create(shipment: Partial<Shipment>): Promise<Shipment> {
        const response = await api.post<unknown, ApiDataResponse<unknown>>('/shipping', shipment);
        return mapShipment(response.data || {});
    },

    async createSubmission(shipment: Partial<Shipment>, key: string): Promise<ShipmentSubmissionResult> {
        const response = await api.post<unknown, ApiDataResponse<unknown> & { submission?: ShipmentSubmissionAck; replayed?: boolean }>('/shipping', shipment,
            { headers: { 'Idempotency-Key': key } });
        return { shipment: mapShipment(response.data || {}), submission: response.submission, replayed: response.replayed };
    },

    async findSubmission(key: string): Promise<ShipmentSubmissionResult | null> {
        try {
            const response = await api.get<unknown, ApiDataResponse<unknown> & { submission?: ShipmentSubmissionAck }>(`/shipping/submissions/${encodeURIComponent(key)}`);
            return { shipment: mapShipment(response.data || {}), submission: response.submission, replayed: true };
        } catch (error) {
            if ((error as { status?: number }).status === 404) return null;
            throw error;
        }
    },

    async updateStatus(id: string, status: string, receiptUrl?: string): Promise<Shipment> {
        const payload: { status: string; signedReceiptUrl?: string } = { status };
        if (receiptUrl) {
            payload.signedReceiptUrl = receiptUrl;
        }
        const response = await api.patch<unknown, ApiDataResponse<unknown>>(`/shipping/${id}/status`, payload);
        return mapShipment(response.data || {});
    },

    async getSupplement(id: string): Promise<ShipmentSupplementView> {
        const response = await api.get<unknown, ApiDataResponse<ShipmentSupplementView>>(`/shipping/${id}/supplement`);
        if (!response.data) throw new Error('发货补录资料回读缺失');
        return response.data;
    },
    async supplement(id: string, input: ShipmentSupplementInput): Promise<ShipmentSupplementView> {
        const response = await api.patch<unknown, ApiDataResponse<ShipmentSupplementView>>(`/shipping/${id}/supplement`, input);
        if (!response.data) throw new Error('补录结果尚未确认，请重新读取原发货单');
        return response.data;
    },

    async getReservation(id: string): Promise<ShipmentReservationBundle> {
        const response = await api.get<unknown, ApiDataResponse<ShipmentReservationBundle>>(`/shipping/${id}/reservation`);
        if (!response.data || Number(response.data.shipment?.id) !== Number(id)
            || !['legacy_unknown', 'unreserved', 'reserved', 'released', 'consumed'].includes(response.data.state)
            || !Number.isFinite(response.data.activeQuantity) || response.data.activeQuantity < 0
            || !Number.isFinite(response.data.shipment.quantity) || response.data.shipment.quantity <= 0) throw new Error('预留状态回读未确认');
        return response.data;
    },
    async changeReservation(id: string, action: 'reserve' | 'release', expectedAuditId: number | null, reason?: string): Promise<void> {
        const response = await api.post<unknown, ApiDataResponse<{ reservation: NonNullable<ShipmentReservationBundle['reservation']> }>>(
            `/shipping/${id}/${action === 'reserve' ? 'reserve' : 'release-reservation'}`, { expectedAuditId, ...(action === 'release' ? { reason } : {}) });
        if (!response.data || response.data.reservation?.shipmentId !== Number(id) || response.data.reservation.action !== action
            || response.data.reservation.previousAuditId !== expectedAuditId) throw new Error('预留回执未确认，请只重新读取原单');
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
