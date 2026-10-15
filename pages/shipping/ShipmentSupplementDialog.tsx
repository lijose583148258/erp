import React from 'react';
import { X } from 'lucide-react';
import { shipmentService, type ShipmentSupplementView, type ShipmentSupplementPatch } from '../../services/shipping.service';
import { shipmentOccurrenceChoices } from '../../services/shipmentOccurrence';
import { useDialogFocus } from '../../app/useDialogFocus';
import { useUnsavedForm } from '../../app/useUnsavedForm';
import { useAppContext } from '../../app/AppContext';

const copy = {
    zh: { title: '补录发货资料', intro: '知道多少填多少，不确定的先留空。补录不重建单据、不改库存或成本账；只有更正已有资料才需要说明原因。',
        batch: '真实批号（预留或出库前补齐）', batchFrozen: '已确认批次不可在这里覆盖。', carrier: '承运商（选填）', trackingNo: '运单号（选填）',
        occurredAt: '实际发运当地时间（不知道可留空）', zone: '业务发生地时区', offset: '这一天当地时间重复，请选择 UTC 偏移',
        timeHelp: '先选发生地时区再填当地时间。允许跨日后补；不会回写出库记账时间。', reason: '更正说明（仅修改已有值时必填）',
        created: '系统建单时间（UTC）', history: '补录记录', entered: '录入时间（UTC）', actor: '操作人', empty: '暂无补录记录',
        refresh: '重新读取', save: '保存补录', saving: '处理中…', saved: '补录已保存，原单与历史记录保留。', close: '关闭',
        uncertain: '保存结果尚未确认。请重新读取原单；不会另建或重复出库。', invalidTime: '当地时间或时区无效；夏令时跳过的时间不能使用。', pending: '未补齐',
        dispatchOccurrence: '实际发运时间', denied: '当前角色只读，不能补录。' },
    en: { title: 'Supply shipment details', intro: 'Fill only what is known. Supplementing never re-creates the shipment or alters stock/cost. Explain corrections to known values only.',
        batch: 'Real batch (required before reservation/dispatch)', batchFrozen: 'The confirmed batch cannot be overwritten here.', carrier: 'Carrier (optional)', trackingNo: 'Tracking number (optional)',
        occurredAt: 'Actual dispatch local time (leave unknown blank)', zone: 'Event time zone', offset: 'This wall time occurs twice. Choose its UTC offset.',
        timeHelp: 'Choose the event zone and enter its local time. Late entry does not backdate stock posting.', reason: 'Correction reason (for changing known values only)',
        created: 'System creation time (UTC)', history: 'Supplement history', entered: 'Entry time (UTC)', actor: 'Actor', empty: 'No supplements yet',
        refresh: 'Read original again', save: 'Save details', saving: 'Working…', saved: 'Details saved. Original shipment and history preserved.', close: 'Close',
        uncertain: 'Save result is unknown. Read the original shipment again; do not re-create or dispatch again.', invalidTime: 'Invalid local time or zone, including a DST gap.', pending: 'Unknown',
        dispatchOccurrence: 'Actual dispatch time', denied: 'Your role is read-only.' },
    vi: { title: 'Bổ sung thông tin giao hàng', intro: 'Chỉ điền thông tin đã biết. Bổ sung không tạo lại phiếu, không đổi tồn kho hay giá vốn. Chỉ cần lý do khi sửa giá trị đã có.',
        batch: 'Lô thực tế (bổ sung trước khi giữ/xuất hàng)', batchFrozen: 'Không ghi đè lô đã xác nhận tại đây.', carrier: 'Đơn vị vận chuyển (tùy chọn)', trackingNo: 'Mã vận đơn (tùy chọn)',
        occurredAt: 'Giờ gửi hàng thực tế tại địa phương (có thể để trống)', zone: 'Múi giờ nơi xảy ra', offset: 'Giờ địa phương này lặp lại. Chọn độ lệch UTC.',
        timeHelp: 'Chọn múi giờ và nhập giờ địa phương. Bổ sung muộn không sửa ngày hạch toán xuất kho.', reason: 'Lý do sửa (chỉ khi thay giá trị đã có)',
        created: 'Giờ tạo phiếu hệ thống (UTC)', history: 'Lịch sử bổ sung', entered: 'Giờ nhập (UTC)', actor: 'Người nhập', empty: 'Chưa có bổ sung',
        refresh: 'Đọc lại phiếu gốc', save: 'Lưu bổ sung', saving: 'Đang xử lý…', saved: 'Đã lưu, giữ nguyên phiếu và lịch sử.', close: 'Đóng',
        uncertain: 'Chưa xác nhận kết quả lưu. Hãy đọc lại phiếu gốc, không tạo hay xuất kho lần nữa.', invalidTime: 'Giờ địa phương hoặc múi giờ không hợp lệ.', pending: 'Chưa bổ sung',
        dispatchOccurrence: 'Giờ gửi hàng thực tế', denied: 'Vai trò hiện tại chỉ được xem.' },
};
type Props = { shipmentId: string; canWrite: boolean; onClose: () => void; onSaved: () => void };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

function ShipmentSupplementEditor({ shipmentId, canWrite, onClose, onSaved }: Props) {
    const { language, currentUser } = useAppContext();
    const t = language === 'en' ? copy.en : language === 'vi' ? copy.vi : copy.zh;
    const ref = React.useRef<HTMLDivElement>(null), busy = React.useRef(false), mounted = React.useRef(false);
    const [view, setView] = React.useState<ShipmentSupplementView | null>(null);
    const [loading, setLoading] = React.useState(true), [saving, setSaving] = React.useState(false), [uncertain, setUncertain] = React.useState(false);
    const [error, setError] = React.useState(''), [saved, setSaved] = React.useState(false);
    const [form, setForm] = React.useState({ batchNo: '', carrier: '', trackingNo: '', localTime: '', timeZone: 'Asia/Ho_Chi_Minh', offset: '', reason: '' });
    const { requestClose } = useUnsavedForm({ sourceId: `shipment-supplement:${shipmentId}`, label: t.title, open: true, value: form,
        enabled: Boolean(view), resetKey: view ? `${view.versionId}:${view.shipment.updatedAt}` : null });
    const close = () => { if (!busy.current) requestClose(onClose); };
    useDialogFocus(true, ref, close);
    const accept = (data: ShipmentSupplementView) => {
        setView(data); setUncertain(false);
        setForm({ batchNo: data.shipment.batchNo || '', carrier: data.shipment.carrier || '', trackingNo: data.shipment.trackingNo || '',
            localTime: data.dispatchOccurrence?.occurredAt.slice(0, 19) || '', timeZone: data.dispatchOccurrence?.timeZone || 'Asia/Ho_Chi_Minh',
            offset: data.dispatchOccurrence?.occurredAt || '', reason: '' });
    };
    React.useEffect(() => {
        mounted.current = true;
        shipmentService.getSupplement(shipmentId).then(data => { if (mounted.current) accept(data); })
            .catch(reason => { if (mounted.current) setError(errorText(reason)); }).finally(() => { if (mounted.current) setLoading(false); });
        return () => { mounted.current = false; };
    }, [shipmentId, currentUser.id]);
    const zones = [...new Set(['Asia/Ho_Chi_Minh', 'Asia/Shanghai', 'UTC', form.timeZone,
        ...(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [])])];
    let occurrenceError = '';
    let choices: ReturnType<typeof shipmentOccurrenceChoices> = [];
    try { choices = shipmentOccurrenceChoices(form.localTime, form.timeZone); if (form.localTime && !choices.length) occurrenceError = t.invalidTime; }
    catch { occurrenceError = t.invalidTime; }
    const originalTimeUnchanged = view?.dispatchOccurrence && form.localTime === view.dispatchOccurrence.occurredAt.slice(0, 19)
        && form.timeZone === view.dispatchOccurrence.timeZone && (choices.length < 2 || form.offset === view.dispatchOccurrence.occurredAt);
    const occurrence = originalTimeUnchanged ? view.dispatchOccurrence : !form.localTime ? null : choices.length === 1 ? choices[0] : choices.find(choice => choice.occurredAt === form.offset);
    const patch: ShipmentSupplementPatch = {};
    if (view) {
        if (!view.shipment.batchNo && form.batchNo.trim()) patch.batchNo = form.batchNo.trim();
        for (const field of ['carrier', 'trackingNo'] as const) if ((form[field].trim() || null) !== (view.shipment[field] || null)) patch[field] = form[field].trim() || null;
        if (occurrence !== undefined && JSON.stringify(occurrence) !== JSON.stringify(view.dispatchOccurrence)) patch.dispatchOccurrence = occurrence;
    }
    const needsReason = Boolean(view && (['carrier', 'trackingNo', 'dispatchOccurrence'] as const).some(field =>
        field in patch && (field === 'dispatchOccurrence' ? view.dispatchOccurrence : view.shipment[field]) != null));
    const submit = async (event: React.FormEvent) => {
        event.preventDefault(); if (busy.current || !view || !canWrite || uncertain || occurrenceError || occurrence === undefined || !Object.keys(patch).length
            || (needsReason && form.reason.trim().length < 3)) return;
        busy.current = true; setSaving(true); setError(''); setSaved(false);
        try {
            const data = await shipmentService.supplement(shipmentId, { expectedAuditId: view.versionId, expectedUpdatedAt: view.shipment.updatedAt,
                patch, ...(form.reason.trim() ? { reason: form.reason.trim() } : {}) });
            if (mounted.current) { accept(data); setSaved(true); onSaved(); }
        } catch (reason) { if (mounted.current) { setError(errorText(reason)); setUncertain(true); } }
        finally { busy.current = false; if (mounted.current) setSaving(false); }
    };
    const refresh = async () => {
        if (busy.current) return; busy.current = true; setLoading(true); setError(''); setSaved(false);
        try { const data = await shipmentService.getSupplement(shipmentId); if (mounted.current) accept(data); }
        catch (reason) { if (mounted.current) setError(errorText(reason)); }
        finally { busy.current = false; if (mounted.current) setLoading(false); }
    };
    const disabled = loading || saving || !canWrite || uncertain;
    const display = (value: string | { occurredAt: string; timeZone: string } | null | undefined) =>
        value == null ? t.pending : typeof value === 'string' ? value : `${value.occurredAt} (${value.timeZone})`;
    return <div data-testid="shipment-supplement-modal" className="fixed inset-0 z-[170] flex items-center justify-center bg-slate-900/60 p-3 sm:p-6">
        <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="shipment-supplement-title" tabIndex={-1} className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-5 shadow-xl dark:bg-slate-900 sm:p-7">
            <div className="mb-4 flex items-start justify-between gap-3"><div className="min-w-0"><h2 id="shipment-supplement-title" className="text-lg font-black">{t.title}</h2><p className="break-all text-xs text-slate-500">{view?.shipment.shipmentNo || shipmentId}</p></div>
                <button type="button" data-testid="shipment-supplement-close" aria-label={t.close} onClick={close} disabled={saving} className="min-h-11 min-w-11 rounded-full bg-slate-100 p-3 dark:bg-slate-800"><X size={18} /></button></div>
            <p className="mb-4 rounded-xl bg-indigo-50 p-3 text-sm text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200">{t.intro}</p>
            {view && <p className="mb-3 break-all text-xs text-slate-500">{t.created}: {view.shipment.createdAt}</p>}
            {!canWrite && <p role="status">{t.denied}</p>}
            {error && <p role="alert" className="mb-3 break-words rounded-xl bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/50 dark:text-rose-200">{error}</p>}
            {uncertain && <p role="status" className="mb-3 text-sm text-amber-700 dark:text-amber-300">{t.uncertain}</p>}
            {saved && <p data-testid="shipment-supplement-saved" role="status" className="mb-3 text-sm text-emerald-700 dark:text-emerald-300">{t.saved}</p>}
            <form onSubmit={submit} className="space-y-4">
                <label className="block space-y-1 text-sm font-bold">{t.batch}<input data-autofocus data-testid="shipment-supplement-batch" value={form.batchNo}
                    disabled={disabled || !view || Boolean(view.shipment.batchNo) || view.shipment.status !== 'pending' || view.shipment.reservationAuditId !== null}
                    onChange={e => setForm(f => ({ ...f, batchNo: e.target.value }))} className="app-control min-h-11 w-full" />
                    {view?.shipment.batchNo && <span className="block text-xs font-normal text-slate-500">{t.batchFrozen}</span>}</label>
                <div className="grid gap-4 sm:grid-cols-2">{(['carrier', 'trackingNo'] as const).map(field => <label key={field} className="block space-y-1 text-sm font-bold">{t[field]}
                    <input data-testid={`shipment-supplement-${field}`} value={form[field]} maxLength={120} disabled={disabled} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))} className="app-control min-h-11 w-full" /></label>)}</div>
                {view?.shipment.shippedAt && view.shipment.status !== 'pending' && <fieldset className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700"><legend className="px-1 text-sm font-bold">{t.dispatchOccurrence}</legend>
                    <label className="block space-y-1 text-sm">{t.zone}<select data-testid="shipment-supplement-zone" value={form.timeZone} disabled={disabled} onChange={e => setForm(f => ({ ...f, timeZone: e.target.value, offset: '' }))} className="app-control min-h-11 w-full">
                        {zones.map(zone => <option key={zone} value={zone}>{zone === 'Asia/Ho_Chi_Minh' ? 'Vietnam · UTC+07:00' : zone === 'Asia/Shanghai' ? '中国 · UTC+08:00' : zone}</option>)}</select></label>
                    <label className="block space-y-1 text-sm">{t.occurredAt}<input data-testid="shipment-supplement-local-time" type="datetime-local" step="1" value={form.localTime} disabled={disabled}
                        onChange={e => setForm(f => ({ ...f, localTime: e.target.value, offset: '' }))} className="app-control min-h-11 w-full" /></label>
                    {choices.length > 1 && <label className="block text-sm">{t.offset}<select data-testid="shipment-supplement-offset" value={form.offset} disabled={disabled} onChange={e => setForm(f => ({ ...f, offset: e.target.value }))} className="app-control min-h-11 w-full"><option value="">—</option>{choices.map(choice => <option key={choice.occurredAt} value={choice.occurredAt}>{choice.occurredAt.slice(19)}</option>)}</select></label>}
                    <p className="text-xs text-slate-500">{t.timeHelp}</p>{occurrenceError && <p role="alert" className="text-sm text-rose-600">{occurrenceError}</p>}
                </fieldset>}
                {needsReason && <label className="block space-y-1 text-sm font-bold">{t.reason}<textarea data-testid="shipment-supplement-reason" value={form.reason} minLength={3} maxLength={500} required disabled={disabled} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} className="app-control min-h-20 w-full" /></label>}
                <div className="flex flex-wrap gap-2"><button type="button" data-testid="shipment-supplement-refresh" disabled={loading || saving} onClick={() => uncertain ? void refresh() : requestClose(() => { void refresh(); })} className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-bold dark:border-slate-600">{t.refresh}</button>
                    <button type="submit" data-testid="shipment-supplement-save" disabled={disabled || !Object.keys(patch).length || Boolean(occurrenceError) || occurrence === undefined || (needsReason && form.reason.trim().length < 3)} className="min-h-11 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white disabled:opacity-50">{loading || saving ? t.saving : t.save}</button></div>
            </form>
            <details data-testid="shipment-supplement-history" className="mt-5 border-t border-slate-200 pt-3 dark:border-slate-700" open><summary className="cursor-pointer text-sm font-bold">{t.history} ({view?.history.length || 0})</summary>
                {!view?.history.length && <p className="mt-2 text-xs text-slate-500">{t.empty}</p>}
                {view?.history.slice().reverse().map(event => <div key={event.auditId} className="mt-3 break-words rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800">
                    <p>{t.actor} #{event.actorId} · {t.entered}: {event.enteredAt}</p>
                    {event.changedFields.map(field => <p key={field}>{field === 'batchNo' ? t.batch : t[field as 'carrier' | 'trackingNo' | 'dispatchOccurrence']}:
                        {' '}{display(event.before[field as keyof typeof event.before])} → {display(event.after[field as keyof typeof event.after])}</p>)}
                    {event.reason && <p>{event.reason}</p>}
                </div>)}
            </details>
        </div>
    </div>;
}

export default function ShipmentSupplementDialog(props: Props) {
    const { currentUser } = useAppContext();
    // A new actor gets a new editor, including request/busy refs. An old response
    // cannot populate a different user's form after a role/session switch.
    return <ShipmentSupplementEditor key={`${currentUser.id}:${props.shipmentId}`} {...props} />;
}
