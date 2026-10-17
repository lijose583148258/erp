import React from 'react';
import { Info, X } from 'lucide-react';
import type { Shipment } from '../../types';
import { shipmentService } from '../../services/shipping.service';
import { useDialogFocus } from '../../app/useDialogFocus';
import { useAppContext } from '../../app/AppContext';
import { readShipmentIntent, prepareShipmentIntent, clearShipmentIntent, confirmShipmentSubmission, shipmentIntentPayload, isConfirmedShipmentRejection,
    type ShipmentIntent, type ShipmentSubmissionResult } from '../../services/shipmentSubmissionIntent';
import { buildShipmentDraftPayload, getEligibleShipmentLines, type ShipmentDispatchTarget } from '../../services/shipmentDispatchTarget';

export type ShipmentDraftDialogProps = {
    orderId: string;
    canWrite: boolean;
    onClose: () => void;
    readTarget: (orderId: string, signal?: AbortSignal) => Promise<ShipmentDispatchTarget | null>;
    onCreated: (shipment: Shipment, isCurrent: () => boolean, signal?: AbortSignal) => Promise<void>;
    onOpenShipment?: (shipmentId: string) => void;
    testIdPrefix?: string;
    language?: string;
};

const copy = {
    zh: { title: '按订单行创建发货草稿', close: '关闭', loading: '正在读取最新订单与未分配量…',
        intro: '先保存待发货草稿，不扣库存。批号、承运商和运单号可在发货工作台后补；实物预留和出库前必须核实真实批次与 QA 放行。',
        line: '订单行', choose: '请选择订单行', quantity: '本次数量', batch: '实际批号（可后补）', carrier: '承运商（选填）', tracking: '运单号（选填）',
        remaining: '未分配', ordered: '订购', accepted: '正常签收', create: '创建待发货单', saving: '正在保存…',
        empty: '当前没有可创建发货单的订单行。请核对订单状态、物料关联和履约证据；在途数量不能再次分配。',
        denied: '当前角色没有发货写入权限，不能创建发货单。', created: '待发货单已创建', readFailed: '创建已成功，但订单回读失败。禁止重复创建，请只重试读取。',
        retry: '只重试读取', uncertain: '创建结果尚未确认，原请求已保留。请确认原发货请求，不要另建。', refreshFailed: '未能刷新余量，提交已停用。',
    },
    en: { title: 'Create shipment draft by order line', close: 'Close', loading: 'Loading current order and unallocated quantity…',
        intro: 'Save a pending draft without issuing stock. Batch and transport details can be supplied later. Reservation and dispatch still require the real batch and QA release.',
        line: 'Order line', choose: 'Select an order line', quantity: 'Quantity for this shipment', batch: 'Actual batch (can be supplied later)', carrier: 'Carrier (optional)', tracking: 'Tracking number (optional)',
        remaining: 'Unallocated', ordered: 'Ordered', accepted: 'Accepted', create: 'Create pending shipment', saving: 'Saving…',
        empty: 'No eligible line remains. Check order status, material binding and fulfillment evidence. In-transit quantities cannot be allocated again.',
        denied: 'Your role cannot create shipments.', created: 'Pending shipment created', readFailed: 'Creation succeeded, but order readback failed. Do not create again; retry reading only.',
        retry: 'Retry reading only', uncertain: 'The original request is preserved. Confirm that request; do not create another shipment.', refreshFailed: 'Could not refresh the remainder. Submission is disabled.',
    },
    vi: { title: 'Tạo phiếu chờ giao theo dòng đơn hàng', close: 'Đóng', loading: 'Đang đọc đơn hàng và số lượng chưa phân bổ…',
        intro: 'Lưu phiếu nháp, chưa xuất kho. Có thể bổ sung lô và vận đơn sau. Giữ hàng và xuất kho vẫn phải xác minh lô thực tế và QA.',
        line: 'Dòng đơn hàng', choose: 'Chọn dòng đơn hàng', quantity: 'Số lượng đợt này', batch: 'Mã lô (có thể bổ sung sau)', carrier: 'Đơn vị vận chuyển (tùy chọn)', tracking: 'Mã vận đơn (tùy chọn)',
        remaining: 'Chưa phân bổ', ordered: 'Đã đặt', accepted: 'Đã nhận đạt', create: 'Tạo phiếu chờ giao', saving: 'Đang lưu…',
        empty: 'Không có dòng đủ điều kiện. Kiểm tra trạng thái, vật liệu và bằng chứng giao hàng. Không phân bổ lại số đang vận chuyển.',
        denied: 'Vai trò hiện tại không có quyền tạo phiếu giao hàng.', created: 'Đã tạo phiếu chờ giao', readFailed: 'Đã tạo phiếu nhưng chưa đọc lại được đơn hàng. Không tạo lại; chỉ thử đọc lại.',
        retry: 'Chỉ thử đọc lại', uncertain: 'Đã lưu yêu cầu gốc. Hãy xác nhận yêu cầu đó, không tạo phiếu mới.', refreshFailed: 'Không làm mới được số còn lại. Đã khóa gửi.',
    },
};
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

function ShipmentDialog({ orderId, canWrite, onClose, onCreated, readTarget, onOpenShipment, language, testIdPrefix = 'shipping-order-shipment' }: ShipmentDraftDialogProps) {
    const { currentUser } = useAppContext();
    const actor = String(currentUser.id), scope = `order:${orderId}`;
    const t = language === 'en' ? copy.en : language === 'vi' ? copy.vi : copy.zh;
    const dialogRef = React.useRef<HTMLDivElement>(null);
    const mounted = React.useRef(false), generation = React.useRef(0), busy = React.useRef(false);
    const live = React.useRef({ actor, orderId, canWrite }); live.current = { actor, orderId, canWrite };
    const callbacks = React.useRef({ readTarget, onCreated }); callbacks.current = { readTarget, onCreated };
    const controller = React.useRef<AbortController | null>(null);
    const createdRef = React.useRef<Shipment | null>(null);
    const confirmedIntent = React.useRef<ShipmentIntent | null>(null);
    const uncertainRef = React.useRef(false);
    const [order, setOrder] = React.useState<ShipmentDispatchTarget | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [saving, setSaving] = React.useState(false);
    const [created, setCreated] = React.useState<Shipment | null>(null);
    const [uncertain, setUncertain] = React.useState(false);
    const [intent, setIntent] = React.useState<ShipmentIntent | null>(null);
    const [error, setError] = React.useState('');
    const [lineId, setLineId] = React.useState('');
    const [quantity, setQuantity] = React.useState('');
    const [batchNo, setBatchNo] = React.useState('');
    const [carrier, setCarrier] = React.useState('');
    const [trackingNo, setTrackingNo] = React.useState('');
    const close = React.useCallback(() => { if (!busy.current) onClose(); }, [onClose]);
    useDialogFocus(true, dialogRef, close);
    const isCurrent = (token: number) => mounted.current && generation.current === token
        && live.current.actor === actor && live.current.orderId === orderId;

    React.useEffect(() => {
        mounted.current = true;
        const token = ++generation.current, abort = new AbortController(); controller.current = abort;
        try {
            const saved = readShipmentIntent(localStorage, actor, scope);
            if (saved) {
                if (saved.facts.orderId !== Number(orderId)) throw Error('原发货请求与当前订单不一致，禁止另建请求。');
                setIntent(saved); uncertainRef.current = true; setUncertain(true);
                setLineId(String(saved.facts.orderItemId || '')); setQuantity(String(saved.facts.quantity));
                setBatchNo(saved.facts.batchNo || ''); setCarrier(saved.facts.carrier || ''); setTrackingNo(saved.facts.trackingNo || '');
            }
        } catch (reason) { uncertainRef.current = true; setUncertain(true); setError(errorText(reason)); }
        callbacks.current.readTarget(orderId, abort.signal).then(fresh => {
            if (!mounted.current || generation.current !== token || live.current.actor !== actor || live.current.orderId !== orderId) return;
            if (fresh && fresh.id !== orderId) throw Error('发货候选订单身份不一致，提交已停用。');
            setOrder(fresh);
        }).catch(reason => {
            if (mounted.current && generation.current === token && live.current.actor === actor && live.current.orderId === orderId) setError(errorText(reason));
        }).finally(() => { if (mounted.current && generation.current === token && live.current.actor === actor && live.current.orderId === orderId) setLoading(false); });
        return () => { mounted.current = false; generation.current += 1; abort.abort(); };
    }, [orderId, actor, scope]);

    const lines = getEligibleShipmentLines(order);
    const selectedLine = lines.find(line => String(line.orderItemId) === lineId);
    const readCreated = async (shipment: Shipment, token: number) => {
        if (!isCurrent(token)) return;
        if (confirmedIntent.current) {
            clearShipmentIntent(localStorage, confirmedIntent.current);
            confirmedIntent.current = null; uncertainRef.current = false; setIntent(null); setUncertain(false);
        }
        // Consumers read current server data, never insert the immutable pending ACK as live state.
        await callbacks.current.onCreated(shipment, () => isCurrent(token), controller.current?.signal);
    };
    const retryRead = async () => {
        if (busy.current || !createdRef.current) return;
        const token = generation.current;
        busy.current = true; setSaving(true); setError('');
        try { await readCreated(createdRef.current, token); }
        catch (reason) { if (isCurrent(token)) setError(`${t.readFailed} ${errorText(reason)}`); }
        finally { busy.current = false; if (isCurrent(token)) setSaving(false); }
    };
    const acceptSubmission = async (original: ShipmentIntent, result: ShipmentSubmissionResult, token: number) => {
        await confirmShipmentSubmission(original, result);
        if (!isCurrent(token)) return;
        // Lock before storage cleanup or readback; neither failure permits another creation.
        createdRef.current = result.shipment; confirmedIntent.current = original; setCreated(result.shipment);
        await readCreated(result.shipment, token);
    };
    const recoverOriginal = async () => {
        if (busy.current || !intent || !canWrite || createdRef.current) return;
        const token = generation.current, original = intent;
        busy.current = true; setSaving(true); setError('');
        try {
            let result = await shipmentService.findSubmission(original.key);
            if (!isCurrent(token) || !live.current.canWrite) return;
            if (!result) result = await shipmentService.createSubmission(shipmentIntentPayload(original), original.key);
            if (!isCurrent(token)) return;
            await acceptSubmission(original, result, token);
        } catch (reason) { if (isCurrent(token)) setError(`${createdRef.current ? `${t.readFailed} ` : ''}${errorText(reason)}`); }
        finally { busy.current = false; if (isCurrent(token)) setSaving(false); }
    };
    const createShipment = async (event: React.FormEvent) => {
        event.preventDefault();
        if (busy.current || createdRef.current || uncertainRef.current || loading) return;
        if (!canWrite) { setError(t.denied); return; }
        if (!order) return;
        const token = generation.current;
        let payload: Partial<Shipment>;
        try { payload = buildShipmentDraftPayload(order, { orderItemId: lineId, quantity, batchNo, carrier, trackingNo }); }
        catch (reason) { setError(errorText(reason)); return; }
        let original: ShipmentIntent;
        try { original = prepareShipmentIntent(localStorage, actor, scope, payload); }
        catch (reason) { uncertainRef.current = true; setUncertain(true); setError(errorText(reason)); return; }
        setIntent(original); busy.current = true; setSaving(true); setError('');
        try {
            if (!isCurrent(token) || !live.current.canWrite) return;
            const result = await shipmentService.createSubmission(shipmentIntentPayload(original), original.key);
            if (!isCurrent(token)) return;
            await acceptSubmission(original, result, token);
        } catch (reason) {
            if (!isCurrent(token)) return;
            if (createdRef.current) { setError(`${t.readFailed} ${errorText(reason)}`); return; }
            const rejected = await isConfirmedShipmentRejection(original, reason);
            if (!isCurrent(token)) return;
            if (rejected) {
                try { clearShipmentIntent(localStorage, original); setIntent(null); uncertainRef.current = false; setUncertain(false); }
                catch (cleanupError) { uncertainRef.current = true; setUncertain(true); setError(errorText(cleanupError)); return; }
            } else { uncertainRef.current = true; setUncertain(true); }
            let message = errorText(reason);
            try {
                const fresh = await callbacks.current.readTarget(orderId, controller.current?.signal);
                if (!isCurrent(token)) return;
                if (fresh && fresh.id !== orderId) throw Error('发货候选订单身份不一致。');
                setOrder(fresh);
            } catch (refreshError) {
                if (!isCurrent(token)) return;
                message += ` ${t.refreshFailed} ${errorText(refreshError)}`; setOrder(null);
            }
            if (isCurrent(token)) setError(message);
        } finally { busy.current = false; if (isCurrent(token)) setSaving(false); }
    };

    const disabled = loading || saving || !canWrite || Boolean(created) || uncertain;
    const numericQuantity = Number(quantity);
    const invalidDraft = !selectedLine || !quantity.trim() || !Number.isFinite(numericQuantity)
        || numericQuantity <= 0 || numericQuantity > selectedLine.unallocatedQuantity;
    return <div data-testid={`${testIdPrefix}-modal`} className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-900/60 p-3 backdrop-blur-sm sm:p-6">
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${testIdPrefix}-title`} tabIndex={-1}
            className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-[28px] bg-white p-5 shadow-2xl dark:bg-slate-900 sm:p-7">
            <div className="mb-5 flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="text-xs font-black tracking-wide text-indigo-600">{order?.orderNo || orderId}</p>
                    <h3 id={`${testIdPrefix}-title`} className="mt-1 text-lg font-black text-slate-900 dark:text-white">{t.title}</h3></div>
                <button type="button" data-testid={`${testIdPrefix}-close`} aria-label={t.close} onClick={close} disabled={saving} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 disabled:opacity-50"><X size={20} /></button>
            </div>
            <p className="mb-4 flex items-start gap-2 rounded-xl bg-indigo-50 p-3 text-sm text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200"><Info size={18} className="mt-0.5 shrink-0" />{t.intro}</p>
            {loading && <p role="status" className="py-4 text-sm text-slate-600 dark:text-slate-300">{t.loading}</p>}
            {!canWrite && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{t.denied}</p>}
            {error && <p role="alert" data-testid={`${testIdPrefix}-error`} className="mb-4 break-words rounded-xl bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{error}</p>}
            {uncertain && <p role="status" className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{t.uncertain}</p>}
            {intent && !created && <button type="button" data-testid={`${testIdPrefix}-recover`} disabled={saving || !canWrite} onClick={recoverOriginal}
                className="mb-4 min-h-11 rounded-xl border border-amber-300 px-3 font-bold disabled:opacity-50">{language === 'en' ? 'Confirm original request' : language === 'vi' ? 'Xác nhận yêu cầu gốc' : '确认原发货请求'}</button>}
            {created && <div data-testid={`${testIdPrefix}-success`} role="status" className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                <p className="font-bold">{t.created}: {created.shipmentNo || created.id}</p>
                <p>{created.productName} · {created.quantity} {created.unit} · {created.batchNo}</p>
                {onOpenShipment && <button type="button" data-testid={`${testIdPrefix}-open-original`} onClick={() => { if (!busy.current) onOpenShipment(created.id); }} disabled={saving} className="mr-2 mt-2 min-h-11 rounded-xl border border-emerald-300 px-3 font-bold disabled:opacity-50">{language === 'en' ? 'Read original reservation' : language === 'vi' ? 'Đọc giữ kho phiếu gốc' : '查看原单预留'}</button>}
                <button type="button" onClick={retryRead} disabled={saving} className="mt-2 min-h-11 rounded-xl border border-emerald-300 px-3 font-bold disabled:opacity-50">{t.retry}</button>
            </div>}
            {!loading && !created && lines.length === 0 && <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">{t.empty}</p>}
            <form onSubmit={createShipment} className="space-y-4">
                <label className="block space-y-1 text-sm font-bold text-slate-700 dark:text-slate-200">{t.line}
                    <select data-autofocus data-testid={`${testIdPrefix}-line`} value={lineId} disabled={disabled || lines.length === 0}
                        onChange={event => { setLineId(event.target.value); setQuantity(String(lines.find(line => String(line.orderItemId) === event.target.value)?.unallocatedQuantity ?? '')); setBatchNo(''); }} className="app-control min-h-11 w-full">
                        <option value="">{t.choose}</option>{lines.map(line => <option key={line.orderItemId} value={line.orderItemId}>#{line.orderItemId} {line.productName} — {t.remaining} {line.unallocatedQuantity} {line.unit}</option>)}
                    </select>
                </label>
                {selectedLine && <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">{t.ordered} {selectedLine.orderedQuantity} {selectedLine.unit} · {t.accepted} {selectedLine.acceptedQuantity} {selectedLine.unit} · {t.remaining} <b>{selectedLine.unallocatedQuantity} {selectedLine.unit}</b></p>}
                <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block space-y-1 text-sm font-bold text-slate-700 dark:text-slate-200">{t.quantity}{selectedLine ? ` (${selectedLine.unit})` : ''}
                        <input data-testid={`${testIdPrefix}-quantity`} type="number" inputMode="decimal" step="any" min="0" max={selectedLine?.unallocatedQuantity} value={quantity} onChange={event => setQuantity(event.target.value)} disabled={disabled || !selectedLine} required className="app-control min-h-11 w-full" />
                    </label>
                    <label className="block space-y-1 text-sm font-bold text-slate-700 dark:text-slate-200">{t.batch}
                        <input data-testid={`${testIdPrefix}-batch`} value={batchNo} onChange={event => setBatchNo(event.target.value)} disabled={disabled || !selectedLine} className="app-control min-h-11 w-full" />
                    </label>
                    <label className="block space-y-1 text-sm font-bold text-slate-700 dark:text-slate-200">{t.carrier}
                        <input value={carrier} onChange={event => setCarrier(event.target.value)} disabled={disabled} className="app-control min-h-11 w-full" />
                    </label>
                    <label className="block space-y-1 text-sm font-bold text-slate-700 dark:text-slate-200">{t.tracking}
                        <input value={trackingNo} onChange={event => setTrackingNo(event.target.value)} disabled={disabled} className="app-control min-h-11 w-full" />
                    </label>
                </div>
                <button data-testid={`${testIdPrefix}-create`} type="submit" disabled={disabled || invalidDraft} className="min-h-11 w-full rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-black text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">{saving ? t.saving : t.create}</button>
            </form>
        </div>
    </div>;
}

export default function ShipmentDraftDialog(props: ShipmentDraftDialogProps) {
    const { currentUser } = useAppContext();
    return <ShipmentDialog key={`${currentUser.id}.${props.orderId}`} {...props} />;
}
