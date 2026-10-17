import React from 'react';
import { X } from 'lucide-react';
import { shipmentService, type ShipmentReservationBundle } from '../../services/shipping.service';
import { useAppContext } from '../../app/AppContext';
import { useDialogFocus } from '../../app/useDialogFocus';
import { useUnsavedForm } from '../../app/useUnsavedForm';

const copy = {
    zh: { title: '实物库存预留', intro: '只占用本发货单的真实批次与数量，不扣库存、不记成本；真正发运时才出库。预售欠货仍由补单计划处理。',
        states: { legacy_unknown: '旧单无预留凭证，不能追认为已预留', unreserved: '未预留', reserved: '已预留', released: '已释放', consumed: '已随真实出库消费' },
        batch: '批次', quantity: '本单数量', active: '当前占用', actor: '最近操作人', reason: '释放原因',
        reserve: '预留本单库存', release: '释放本单预留', refresh: '只重新读取', close: '关闭', saving: '处理中…',
        missing: '批次或物料未齐，先补录真实批次，再核实放行与库存。', supply: '补录批次资料',
        unknown: '结果尚未确认，操作已停用。只回读原单，不自动再预留或释放。', saved: '已回读最新预留状态。', denied: '当前角色只能读取预留状态。' },
    en: { title: 'Physical stock reservation', intro: 'Hold only this shipment’s real batch and quantity. Stock and cost post on actual dispatch, not on reservation. Presale shortages remain supply-plan obligations.',
        states: { legacy_unknown: 'Legacy shipment: no reservation proof', unreserved: 'Not reserved', reserved: 'Reserved', released: 'Released', consumed: 'Consumed by actual dispatch' },
        batch: 'Batch', quantity: 'Shipment quantity', active: 'Current hold', actor: 'Latest actor', reason: 'Release reason',
        reserve: 'Reserve this shipment', release: 'Release this hold', refresh: 'Read original only', close: 'Close', saving: 'Working…',
        missing: 'Supply the real batch first; release and availability are still checked by the server.', supply: 'Supply batch details',
        unknown: 'The result is unknown. Read the original only; no automatic re-reservation or release.', saved: 'Latest reservation state read back.', denied: 'Your role is read-only.' },
    vi: { title: 'Giữ tồn kho thực tế', intro: 'Chỉ giữ đúng lô và số lượng của phiếu này. Chưa xuất kho hay ghi giá vốn; thiếu hàng bán trước vẫn cần kế hoạch bổ sung.',
        states: { legacy_unknown: 'Phiếu cũ chưa có bằng chứng giữ kho', unreserved: 'Chưa giữ kho', reserved: 'Đã giữ kho', released: 'Đã giải phóng', consumed: 'Đã dùng khi xuất kho thực tế' },
        batch: 'Lô', quantity: 'Số lượng phiếu', active: 'Đang giữ', actor: 'Người thao tác gần nhất', reason: 'Lý do giải phóng',
        reserve: 'Giữ kho cho phiếu này', release: 'Giải phóng giữ kho', refresh: 'Chỉ đọc lại phiếu', close: 'Đóng', saving: 'Đang xử lý…',
        missing: 'Bổ sung lô thực tế trước. Máy chủ vẫn kiểm tra QA và tồn kho.', supply: 'Bổ sung lô',
        unknown: 'Chưa xác nhận kết quả. Chỉ đọc lại phiếu, không tự giữ hay giải phóng lần nữa.', saved: 'Đã đọc lại trạng thái mới nhất.', denied: 'Vai trò hiện tại chỉ được xem.' },
};
type Props = { shipmentId: string; canWrite: boolean; onClose: () => void; onChanged: () => void; onSupply: () => void };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

function ReservationEditor({ shipmentId, canWrite, onClose, onChanged, onSupply }: Props) {
    const { language } = useAppContext(), t = language === 'en' ? copy.en : language === 'vi' ? copy.vi : copy.zh;
    const ref = React.useRef<HTMLDivElement>(null), mounted = React.useRef(false), busy = React.useRef(false);
    const [data, setData] = React.useState<ShipmentReservationBundle | null>(null), [loading, setLoading] = React.useState(true);
    const [saving, setSaving] = React.useState(false), [uncertain, setUncertain] = React.useState(false), [saved, setSaved] = React.useState(false);
    const [reason, setReason] = React.useState(''), [error, setError] = React.useState('');
    const { requestClose } = useUnsavedForm({ sourceId: `shipment-reservation:${shipmentId}`, label: t.title, open: true, value: reason,
        enabled: Boolean(data), resetKey: data?.reservation?.auditId ?? 'initial' });
    const close = () => { if (!busy.current) requestClose(onClose); };
    useDialogFocus(true, ref, close);
    React.useEffect(() => {
        mounted.current = true;
        shipmentService.getReservation(shipmentId).then(result => { if (mounted.current) setData(result); })
            .catch(failure => { if (mounted.current) setError(message(failure)); }).finally(() => { if (mounted.current) setLoading(false); });
        return () => { mounted.current = false; };
    }, [shipmentId]);
    const read = async () => {
        if (busy.current) return; busy.current = true; setLoading(true); setError('');
        try { const result = await shipmentService.getReservation(shipmentId); if (mounted.current) { setData(result); setUncertain(false); setReason(''); onChanged(); } }
        catch (failure) { if (mounted.current) { setError(message(failure)); setUncertain(true); } }
        finally { busy.current = false; if (mounted.current) setLoading(false); }
    };
    const change = async (action: 'reserve' | 'release') => {
        if (busy.current || !data || !canWrite || uncertain) return;
        busy.current = true; setSaving(true); setError(''); setSaved(false);
        try {
            await shipmentService.changeReservation(shipmentId, action, data.reservation?.auditId ?? null, reason.trim());
            const result = await shipmentService.getReservation(shipmentId);
            if (mounted.current) { setData(result); setReason(''); setSaved(true); onChanged(); }
        } catch (failure) { if (mounted.current) { setError(message(failure)); setUncertain(true); } }
        finally { busy.current = false; if (mounted.current) setSaving(false); }
    };
    const disabled = loading || saving || !canWrite || uncertain || !data;
    const missing = !data?.shipment.batchNo || !data.shipment.materialId;
    return <div data-testid="shipment-reservation-modal" className="fixed inset-0 z-[170] flex items-center justify-center bg-slate-900/60 p-3 sm:p-6">
        <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="shipment-reservation-title" tabIndex={-1} className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-3xl bg-white p-5 shadow-xl dark:bg-slate-900 sm:p-7">
            <div className="mb-4 flex items-start justify-between gap-3"><div className="min-w-0"><h2 id="shipment-reservation-title" className="text-lg font-black">{t.title}</h2><p className="break-all text-xs text-slate-500">{data?.shipment.shipmentNo || shipmentId}</p></div>
                <button data-testid="shipment-reservation-close" type="button" aria-label={t.close} onClick={close} disabled={saving} className="min-h-11 min-w-11 rounded-full bg-slate-100 p-3 dark:bg-slate-800"><X size={18} /></button></div>
            <p className="mb-4 rounded-xl bg-indigo-50 p-3 text-sm text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200">{t.intro}</p>
            {error && <p role="alert" className="mb-3 break-words rounded-xl bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/50 dark:text-rose-200">{error}</p>}
            {uncertain && <p role="status" className="mb-3 text-sm text-amber-700 dark:text-amber-300">{t.unknown}</p>}
            {saved && <p role="status" data-testid="shipment-reservation-saved" className="mb-3 text-sm text-emerald-700 dark:text-emerald-300">{t.saved}</p>}
            {data && <div className="mb-4 space-y-2 rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-700">
                <p data-testid="shipment-reservation-state" className="font-bold">{t.states[data.state]}</p><p>{t.batch}: {data.shipment.batchNo || '—'}</p>
                <p>{t.quantity}: {data.shipment.quantity} {data.shipment.unit}</p><p>{t.active}: {data.state === 'legacy_unknown' ? '—' : data.activeQuantity} {data.shipment.unit}</p>
                {data.reservation && <p>{t.actor} #{data.reservation.actorId} · #{data.reservation.auditId}</p>}
            </div>}
            {!canWrite && <p className="mb-3 text-sm">{t.denied}</p>}
            {missing && !loading && <p className="mb-3 text-sm text-amber-700 dark:text-amber-300">{t.missing}</p>}
            {data?.state === 'reserved' && <label className="mb-4 block space-y-1 text-sm font-bold">{t.reason}<textarea data-testid="shipment-reservation-reason" value={reason} minLength={3} maxLength={500} disabled={disabled} onChange={e => setReason(e.target.value)} className="app-control min-h-20 w-full" /></label>}
            <div className="flex flex-wrap gap-2">
                <button type="button" data-testid="shipment-reservation-refresh" disabled={loading || saving} onClick={() => uncertain ? void read() : requestClose(() => { void read(); })} className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-bold dark:border-slate-600">{loading ? t.saving : t.refresh}</button>
                {canWrite && missing && <button type="button" disabled={loading || saving} onClick={() => requestClose(onSupply)} className="min-h-11 rounded-xl border border-indigo-200 px-4 text-sm font-bold text-indigo-700 dark:text-indigo-300">{t.supply}</button>}
                {data && data.state !== 'reserved' && <button type="button" data-testid="shipment-reservation-reserve" disabled={disabled || missing || data.shipment.status !== 'pending' || data.state === 'consumed'} onClick={() => { void change('reserve'); }} className="min-h-11 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white disabled:opacity-50">{saving ? t.saving : t.reserve}</button>}
                {data?.state === 'reserved' && <button type="button" data-testid="shipment-reservation-release" disabled={disabled || reason.trim().length < 3 || !['pending', 'exception'].includes(data.shipment.status)} onClick={() => { void change('release'); }} className="min-h-11 rounded-xl bg-amber-600 px-4 text-sm font-bold text-white disabled:opacity-50">{saving ? t.saving : t.release}</button>}
            </div>
        </div>
    </div>;
}
export default function ShipmentReservationDialog(props: Props) {
    const { currentUser } = useAppContext();
    return <ReservationEditor key={`${currentUser.id}:${props.shipmentId}`} {...props} />;
}
