import { useEffect, useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react';
import type { Shipment } from '../../types';
import { shipmentService, type ShipmentReceiptBundle } from '../../services/shipping.service';
import { clearReceiptIntent, confirmReceiptSubmission, isConfirmedReceiptRejection, prepareReceiptIntent, readReceiptIntent, receiptIntentFacts, receiptIntentPayload,
    type ReceiptIntent, type ReceiptSubmissionResult } from '../../services/shipmentReceiptIntent';
import { useAppContext } from '../../app/AppContext';
import { useUnsavedForm } from '../../app/useUnsavedForm';
import { reportClientIssue } from '../../utils/clientIssue';

type Notify = (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
type ShippingReceiptForm = { quantity: string; acceptedQuantity: string; rejectedQuantity: string; discrepancyReason: string; note: string; file: File | null };
type UseShippingReceiptsOptions = { t: Record<string, string>; notify: Notify; setShipments: Dispatch<SetStateAction<Shipment[]>>; canWrite: boolean };
const emptyForm = (): ShippingReceiptForm => ({ quantity: '', acceptedQuantity: '', rejectedQuantity: '0', discrepancyReason: '', note: '', file: null });
const intentForm = ({ facts }: ReceiptIntent): ShippingReceiptForm => ({ quantity: String(facts.quantity), acceptedQuantity: String(facts.acceptedQuantity),
    rejectedQuantity: String(facts.rejectedQuantity), discrepancyReason: facts.discrepancyReason || '', note: facts.note || '', file: null });
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export const useShippingReceipts = ({ t, notify, setShipments, canWrite }: UseShippingReceiptsOptions) => {
    const { currentUser } = useAppContext(), actor = String(currentUser.id);
    const actorRef = useRef(actor); actorRef.current = actor;
    const active = useRef<{ actor: string; id: string; generation: number } | null>(null), generation = useRef(0), busy = useRef(false);
    const [uploadingId, setUploadingId] = useState<string | null>(null);
    const [drawer, setDrawer] = useState<{ actor: string; shipment: Shipment } | null>(null);
    const [receiptBundle, setReceiptBundle] = useState<ShipmentReceiptBundle | null>(null);
    const [isReceiptLoading, setIsReceiptLoading] = useState(false), [receiptError, setReceiptError] = useState('');
    const [receiptPending, setReceiptPending] = useState<ReceiptIntent | null>(null), [receiptCanRetry, setReceiptCanRetry] = useState(false);
    const [receiptForm, setForm] = useState<ShippingReceiptForm>(emptyForm), [resetKey, setResetKey] = useState(0);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const receiptDrawerShipment = drawer?.actor === actor ? drawer.shipment : null;
    const { requestClose } = useUnsavedForm({ sourceId: 'shipping-receipt-event', label: '签收批次', open: Boolean(receiptDrawerShipment),
        value: { ...receiptForm, file: receiptForm.file ? { name: receiptForm.file.name, size: receiptForm.file.size, lastModified: receiptForm.file.lastModified } : null }, resetKey });
    useEffect(() => {
        active.current = null; generation.current++; setDrawer(null); setReceiptBundle(null); setForm(emptyForm());
        setReceiptPending(null); setReceiptError(''); setReceiptCanRetry(false); setUploadingId(null); setIsReceiptLoading(false);
    }, [actor]);
    useEffect(() => () => { active.current = null; generation.current++; }, []);
    const current = (request: NonNullable<typeof active.current>) => actorRef.current === request.actor && active.current?.generation === request.generation && active.current.id === request.id;
    const resetReceiptForm = (bundle: ShipmentReceiptBundle) => {
        const quantity = bundle.receiptSummary.remainingQuantity > 0 ? String(bundle.receiptSummary.remainingQuantity) : '';
        setForm({ ...emptyForm(), quantity, acceptedQuantity: quantity }); setResetKey(v => v + 1);
    };
    const applyBundle = (bundle: ShipmentReceiptBundle, request: NonNullable<typeof active.current>) => {
        if (String(bundle.shipment.id) !== request.id) throw Error('签收回读不是原发货单，已停止保存。');
        if (!current(request)) return;
        setReceiptBundle(bundle); setDrawer({ actor: request.actor, shipment: bundle.shipment });
        setShipments(prev => prev.map(item => item.id === bundle.shipment.id ? bundle.shipment : item));
    };
    const accept = async (intent: ReceiptIntent, result: ReceiptSubmissionResult, request: NonNullable<typeof active.current>) => {
        await confirmReceiptSubmission(intent, result);
        if (!current(request)) return;
        clearReceiptIntent(localStorage, intent);
        applyBundle(result, request); setReceiptPending(null); setReceiptCanRetry(false); setReceiptError(''); resetReceiptForm(result);
        notify('success', '原签收批次已确认，未重复记录');
    };
    const recoverRejected = async (intent: ReceiptIntent, error: unknown, request: NonNullable<typeof active.current>) => {
        if (!await isConfirmedReceiptRejection(intent, error) || !current(request)) return false;
        try {
            clearReceiptIntent(localStorage, intent);
            setReceiptPending(null); setReceiptCanRetry(false); setReceiptBundle(null); setForm(emptyForm());
            const bundle = await shipmentService.getReceiptEvents(request.id);
            if (!current(request)) return true;
            applyBundle(bundle, request); resetReceiptForm(bundle);
            setReceiptError('原签收已明确拒绝且未新增签收；已读取最新剩余数量，请核对后修改。不会自动重提。');
            notify('warning', '原签收未记录，已恢复最新数量，请核对后纠正。');
        } catch (failure) {
            if (current(request)) { setReceiptError(`原签收拒绝证明已核对，但恢复失败：${message(failure)}。请关闭后重新读取原单。`); reportClientIssue('shipping.receipt-rejection-recovery', failure); }
        }
        return true;
    };
    const setReceiptDrawerShipment: Dispatch<SetStateAction<Shipment | null>> = value => {
        if (busy.current) return;
        requestClose(() => {
            const next = typeof value === 'function' ? value(receiptDrawerShipment) : value;
            active.current = null; generation.current++;
            setDrawer(next ? { actor, shipment: next } : null); setReceiptBundle(null); setReceiptPending(null); setReceiptCanRetry(false); setReceiptError('');
        });
    };
    const receiptFieldsLocked = isReceiptLoading || Boolean(receiptPending) || !receiptBundle;
    const setReceiptForm: Dispatch<SetStateAction<ShippingReceiptForm>> = value => {
        if (!receiptFieldsLocked && !busy.current) setForm(value);
    };
    const handleOpenReceiptEvents = async (shipment: Shipment) => {
        if (busy.current) return;
        const request = { actor, id: shipment.id, generation: ++generation.current }; active.current = request;
        busy.current = true; setDrawer({ actor, shipment }); setReceiptBundle(null); setForm(emptyForm()); setReceiptPending(null);
        setReceiptCanRetry(false); setReceiptError(''); setIsReceiptLoading(true);
        let intent: ReceiptIntent | null = null;
        try {
            intent = readReceiptIntent(localStorage, actor, shipment.id);
            if (intent && current(request)) { setReceiptPending(intent); setForm(intentForm(intent)); }
            if (intent) {
                const result = await shipmentService.findReceiptSubmission(shipment.id, intent.key);
                if (!current(request)) return;
                if (result) { await accept(intent, result, request); return; }
            }
            const bundle = await shipmentService.getReceiptEvents(shipment.id);
            if (!current(request)) return;
            applyBundle(bundle, request);
            if (intent) setReceiptCanRetry(true); else resetReceiptForm(bundle);
        } catch (error) {
            if (intent && await recoverRejected(intent, error, request)) return;
            if (current(request)) { setReceiptError(message(error)); reportClientIssue('shipping.receipt-events-load', error); }
        }
        finally { busy.current = false; if (current(request)) setIsReceiptLoading(false); }
    };
    const handleReceiptFileChange = (file: File | null) => {
        if (!busy.current && canWrite && (!receiptFieldsLocked || (receiptPending?.facts.file && receiptCanRetry))) setForm(prev => ({ ...prev, file }));
    };
    const handleSubmitReceiptEvent = async () => {
        const request = active.current;
        if (busy.current || !request || !current(request) || !canWrite) return;
        busy.current = true; setIsReceiptLoading(true); setReceiptError('');
        let intent = receiptPending;
        try {
            // Existing identities are always resolved by GET before any explicit same-key retry.
            const prior = readReceiptIntent(localStorage, request.actor, request.id);
            if (prior) {
                if (intent && prior.key !== intent.key) throw Error('原签收请求已变化，请关闭并重新读取。');
                intent = prior; setReceiptPending(intent); setReceiptCanRetry(false);
                const result = await shipmentService.findReceiptSubmission(request.id, intent.key);
                if (!current(request)) return;
                if (result) { await accept(intent, result, request); return; }
                if (!receiptCanRetry) { setReceiptCanRetry(true); setReceiptError('尚未找到原签收。核对原内容和凭证后，可明确重试同一请求。'); return; }
            } else {
                if (intent) throw Error('原签收身份已丢失，禁止另建签收。');
                if (!receiptBundle || receiptDrawerShipment?.status === 'delivered') throw Error('请重新打开原发货单并核对签收台账。');
                const facts = await receiptIntentFacts({ quantity: Number(receiptForm.quantity), acceptedQuantity: Number(receiptForm.acceptedQuantity || 0),
                    rejectedQuantity: Number(receiptForm.rejectedQuantity || 0), discrepancyReason: receiptForm.discrepancyReason, note: receiptForm.note, file: receiptForm.file });
                if (!current(request)) return;
                intent = prepareReceiptIntent(localStorage, request.actor, request.id, facts); setReceiptPending(intent);
            }
            const payload = await receiptIntentPayload(intent, receiptForm.file);
            if (!current(request)) return;
            const result = await shipmentService.createReceiptEvent(request.id, payload, intent.key, () => current(request));
            if (current(request)) await accept(intent, result, request);
        } catch (error) {
            if (intent && await recoverRejected(intent, error, request)) return;
            if (current(request)) { setReceiptError(`${message(error)}${intent ? '；保留原请求，只确认原签收，不另建批次。' : ''}`); setReceiptCanRetry(false); reportClientIssue('shipping.receipt-event-submit', error); }
        } finally { busy.current = false; if (current(request)) setIsReceiptLoading(false); }
    };

    const handleFileUpload = (id: string) => {
        if (!canWrite) { notify('warning', '当前角色只能查看发货与签收凭证，不能上传签收凭证'); return; }
        setUploadingId(id); fileInputRef.current?.click();
    };
    const onFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0] && uploadingId) {
            if (!canWrite) { e.target.value = ''; return; }
            const file = e.target.files[0], requestActor = actor;
            try {
                const updatedShipment = await shipmentService.uploadReceipt(uploadingId, file);
                if (actorRef.current !== requestActor) return;
                setShipments(prev => prev.map(s => s.id === uploadingId ? updatedShipment : s)); setUploadingId(null);
                notify('success', t.podSuccess || '签收凭证已上传');
            } catch (error) { if (actorRef.current === requestActor) { reportClientIssue('shipping.receipt-upload', error); notify('error', t.saveFail || '签收凭证保存失败'); } }
            finally { e.target.value = ''; }
        }
    };
    return { fileInputRef, uploadingId, receiptDrawerShipment, receiptBundle, receiptForm, isReceiptLoading, receiptError, receiptPending, receiptCanRetry,
        receiptFieldsLocked, handleFileUpload, handleOpenReceiptEvents, handleReceiptFileChange, handleSubmitReceiptEvent, setReceiptDrawerShipment, setReceiptForm, onFileChange };
};
