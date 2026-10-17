import React from 'react';
import { useAppContext } from '../../app/AppContext';
import { can } from '../../app/permissions';
import { shipmentService } from '../../services/shipping.service';
import { getEligibleShipmentLines, type ShipmentDispatchTarget } from '../../services/shipmentDispatchTarget';
import { listOrderShipmentIntents, type ShipmentIntent } from '../../services/shipmentSubmissionIntent';
import ShipmentDraftDialog from './ShipmentDraftDialog';

type Props = { onRefresh: (signal?: AbortSignal) => Promise<void>; onOpenShipment: (shipmentId: string) => void };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

function ShippingReadyEditor({ onRefresh, onOpenShipment }: Props) {
    const { currentUser, language } = useAppContext(), actor = String(currentUser.id);
    const mounted = React.useRef(false), request = React.useRef(0), busy = React.useRef(false);
    const controller = React.useRef<AbortController | null>(null);
    const [open, setOpen] = React.useState(false), [loading, setLoading] = React.useState(false);
    const [targets, setTargets] = React.useState<ShipmentDispatchTarget[]>([]);
    const [pending, setPending] = React.useState<ShipmentIntent[]>([]);
    const [storageError, setStorageError] = React.useState(''), [error, setError] = React.useState('');
    const [orderId, setOrderId] = React.useState<string | null>(null);
    const t = language === 'en'
        ? { open: 'Create draft by order line', order: 'Available order', choose: 'Select an order', loading: 'Reading available order lines…', empty: 'No eligible unallocated order line.', pending: 'Unconfirmed original requests', recover: 'Confirm original request', close: 'Close candidates', intro: 'Create a pending draft only. Unknown batch and transport details can be supplied later; reservation and dispatch still require real stock and QA release.' }
        : language === 'vi'
            ? { open: 'Tạo phiếu nháp theo dòng đơn', order: 'Đơn có thể giao', choose: 'Chọn đơn hàng', loading: 'Đang đọc dòng đơn chưa phân bổ…', empty: 'Chưa có dòng đơn đủ điều kiện.', pending: 'Yêu cầu gốc chưa xác nhận', recover: 'Xác nhận yêu cầu gốc', close: 'Đóng danh sách', intro: 'Chỉ tạo phiếu chờ giao. Có thể bổ sung lô và vận đơn sau; giữ kho và xuất kho vẫn cần tồn thực tế và QA.' }
            : { open: '按订单行建发货草稿', order: '可发货订单', choose: '请选择真实订单', loading: '正在读取最新可发货订单行…', empty: '当前没有可分配的合格订单行。', pending: '尚未确认的原发货请求', recover: '确认原发货请求', close: '收起候选订单', intro: '先建待发货草稿，不扣库存。未知批号和运输资料可后补；真实预留、出库仍需核实库存和 QA 放行。' };

    const readPending = React.useCallback(() => {
        try {
            const originals = listOrderShipmentIntents(localStorage, actor);
            if (mounted.current) { setPending(originals); setStorageError(''); }
            return originals;
        } catch (failure) {
            if (mounted.current) { setStorageError(message(failure)); setTargets([]); }
            throw failure;
        }
    }, [actor]);
    React.useEffect(() => {
        mounted.current = true; controller.current = new AbortController();
        try { readPending(); } catch { /* The visible storage fault blocks new drafts. */ }
        return () => { mounted.current = false; request.current += 1; controller.current?.abort(); };
    }, [readPending]);

    const readTargets = async (signal?: AbortSignal) => {
        const generation = ++request.current;
        const fresh = await shipmentService.getDispatchTargets({ signal });
        if (mounted.current && generation === request.current && !signal?.aborted) setTargets(fresh);
        return fresh;
    };
    const openCandidates = async () => {
        if (busy.current) return;
        setOpen(true); setError(''); busy.current = true; setLoading(true);
        try { readPending(); await readTargets(controller.current?.signal); }
        catch (failure) { if (mounted.current) { setError(message(failure)); setTargets([]); } }
        finally { busy.current = false; if (mounted.current) setLoading(false); }
    };
    const closeDialog = () => {
        setOrderId(null);
        try { readPending(); } catch { /* Keep the fault visible and fail closed. */ }
    };
    const readTarget = async (id: string, signal?: AbortSignal) => {
        const fresh = await readTargets(signal);
        return fresh.find(target => target.id === id) ?? null;
    };
    const readCreated = async (_shipment: unknown, isCurrent: () => boolean, signal?: AbortSignal) => {
        // Only real readbacks refresh the workbench; an old pending ACK is not current shipment state.
        await Promise.all([readTargets(signal), onRefresh(signal)]);
        if (isCurrent() && mounted.current) readPending();
    };
    const eligible = targets.filter(target => getEligibleShipmentLines(target).length > 0);
    return <div className="space-y-3">
        <button type="button" data-testid="shipping-order-draft-open" onClick={() => { void openCandidates(); }} disabled={loading}
            className="min-h-11 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{t.open}</button>
        {(storageError || error) && <p role="alert" data-testid="shipping-order-draft-error" className="break-words rounded-xl bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{storageError || error}</p>}
        {pending.length > 0 && <div className="space-y-2 rounded-xl border border-amber-200 p-3 dark:border-amber-900">
            <p className="text-sm font-bold">{t.pending}</p>
            {pending.map(original => <button key={original.scope} type="button" data-testid={`shipping-order-recover-${original.facts.orderId}`}
                onClick={() => setOrderId(String(original.facts.orderId))} className="mr-2 min-h-11 rounded-xl border border-amber-300 px-3 text-sm font-bold">
                {t.recover} #{original.facts.orderId} · {original.facts.productName} · {original.facts.quantity} {original.facts.unit}
            </button>)}
        </div>}
        {open && <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-sm text-slate-600 dark:text-slate-300">{t.intro}</p>
            {loading && <p role="status" className="text-sm">{t.loading}</p>}
            {!loading && !error && !storageError && eligible.length === 0 && <p className="text-sm">{t.empty}</p>}
            <label className="block space-y-1 text-sm font-bold">{t.order}
                <select data-testid="shipping-order-draft-order" value={orderId || ''} onChange={event => { if (event.target.value) setOrderId(event.target.value); }}
                    disabled={loading || Boolean(storageError) || Boolean(error)} className="app-control min-h-11 w-full">
                    <option value="">{t.choose}</option>{eligible.map(target => <option key={target.id} value={target.id}>{target.orderNo || target.id} · {target.customer.nameZh || target.customer.name || target.customer.nameEn || target.customer.nameVi || target.customer.id}</option>)}
                </select>
            </label>
            <button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm font-bold dark:border-slate-700">{t.close}</button>
        </div>}
        {orderId && <ShipmentDraftDialog orderId={orderId} canWrite readTarget={readTarget} onCreated={readCreated} language={language} onClose={closeDialog}
            onOpenShipment={shipmentId => { closeDialog(); onOpenShipment(shipmentId); }} />}
    </div>;
}

export default function ShippingReadyPanel(props: Props) {
    const { currentUser } = useAppContext();
    if (!can(currentUser, 'orders.shippingReady.read') || !can(currentUser, 'shipping.write')) return null;
    return <ShippingReadyEditor key={String(currentUser.id)} {...props} />;
}
