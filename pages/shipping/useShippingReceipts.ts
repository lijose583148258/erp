import { useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react';
import type { Shipment } from '../../types';
import { shipmentService, type ShipmentReceiptBundle } from '../../services/shipping.service';
import { reportClientIssue } from '../../utils/clientIssue';

type Notify = (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;

type ShippingReceiptForm = {
    quantity: string;
    acceptedQuantity: string;
    rejectedQuantity: string;
    discrepancyReason: string;
    note: string;
    file: File | null;
};

type UseShippingReceiptsOptions = {
    t: Record<string, string>;
    notify: Notify;
    setShipments: Dispatch<SetStateAction<Shipment[]>>;
    canWrite: boolean;
};

const createEmptyReceiptForm = (): ShippingReceiptForm => ({
    quantity: '',
    acceptedQuantity: '',
    rejectedQuantity: '0',
    discrepancyReason: '',
    note: '',
    file: null,
});

export const useShippingReceipts = ({ t, notify, setShipments, canWrite }: UseShippingReceiptsOptions) => {
    const [uploadingId, setUploadingId] = useState<string | null>(null);
    const [receiptDrawerShipment, setReceiptDrawerShipment] = useState<Shipment | null>(null);
    const [receiptBundle, setReceiptBundle] = useState<ShipmentReceiptBundle | null>(null);
    const [isReceiptLoading, setIsReceiptLoading] = useState(false);
    const [receiptForm, setReceiptForm] = useState<ShippingReceiptForm>(createEmptyReceiptForm);

    const fileInputRef = useRef<HTMLInputElement>(null);

    const resetReceiptForm = (shipment?: Shipment | null, bundle?: ShipmentReceiptBundle | null) => {
        const remaining = bundle?.receiptSummary.remainingQuantity ?? shipment?.quantity ?? 0;
        const nextQuantity = remaining > 0 ? String(remaining) : '';
        setReceiptForm({
            ...createEmptyReceiptForm(),
            quantity: nextQuantity,
            acceptedQuantity: nextQuantity,
        });
    };

    const handleFileUpload = (id: string) => {
        if (!canWrite) {
            notify('warning', '当前角色只能查看发货与签收凭证，不能上传签收凭证');
            return;
        }
        setUploadingId(id);
        fileInputRef.current?.click();
    };

    const handleOpenReceiptEvents = async (shipment: Shipment) => {
        try {
            setReceiptDrawerShipment(shipment);
            setIsReceiptLoading(true);
            const bundle = await shipmentService.getReceiptEvents(shipment.id);
            setReceiptBundle(bundle);
            resetReceiptForm(bundle.shipment, bundle);
        } catch (err) {
            reportClientIssue('shipping.receipt-events-load', err);
            notify('error', t.saveFail || '签收批次读取失败');
        } finally {
            setIsReceiptLoading(false);
        }
    };

    const handleReceiptFileChange = (file: File | null) => {
        setReceiptForm(prev => ({ ...prev, file }));
    };

    const handleSubmitReceiptEvent = async () => {
        if (!receiptDrawerShipment) return;
        if (!canWrite) {
            notify('warning', '当前角色只能查看签收批次，不能保存签收');
            return;
        }
        const quantity = Number(receiptForm.quantity);
        const acceptedQuantity = Number(receiptForm.acceptedQuantity || 0);
        const rejectedQuantity = Number(receiptForm.rejectedQuantity || 0);
        if (!Number.isFinite(quantity) || quantity <= 0 || Math.abs(quantity - acceptedQuantity - rejectedQuantity) > 0.000001) {
            notify('error', '本次签收必须等于正常签收与异常数量之和');
            return;
        }

        try {
            setIsReceiptLoading(true);
            const bundle = await shipmentService.createReceiptEvent(receiptDrawerShipment.id, {
                quantity,
                acceptedQuantity,
                rejectedQuantity,
                discrepancyReason: receiptForm.discrepancyReason || undefined,
                note: receiptForm.note || undefined,
                file: receiptForm.file,
            });
            setReceiptBundle(bundle);
            setReceiptDrawerShipment(bundle.shipment);
            setShipments(prev => prev.map(item => item.id === bundle.shipment.id ? bundle.shipment : item));
            resetReceiptForm(bundle.shipment, bundle);
            notify('success', '签收批次已记录');
        } catch (err) {
            reportClientIssue('shipping.receipt-event-submit', err);
            notify('error', t.saveFail || '签收批次保存失败');
        } finally {
            setIsReceiptLoading(false);
        }
    };

    const onFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0] && uploadingId) {
            if (!canWrite) {
                notify('warning', '当前角色只能查看发货与签收凭证，不能上传签收凭证');
                e.target.value = '';
                return;
            }
            const file = e.target.files[0];
            try {
                const updatedShipment = await shipmentService.uploadReceipt(uploadingId, file);
                setShipments(prev => prev.map(s => s.id === uploadingId ? updatedShipment : s));
                setUploadingId(null);
                notify('success', t.podSuccess || '签收凭证已上传');
            } catch (err) {
                reportClientIssue('shipping.receipt-upload', err);
                notify('error', t.saveFail || 'Failed to update status');
            } finally {
                e.target.value = '';
            }
        }
    };

    return {
        fileInputRef,
        uploadingId,
        receiptDrawerShipment,
        receiptBundle,
        receiptForm,
        isReceiptLoading,
        handleFileUpload,
        handleOpenReceiptEvents,
        handleReceiptFileChange,
        handleSubmitReceiptEvent,
        setReceiptDrawerShipment,
        setReceiptForm,
        onFileChange,
    };
};
