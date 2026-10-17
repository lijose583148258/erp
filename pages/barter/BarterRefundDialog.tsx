import { useRef, useState } from 'react';
import { useDialogFocus } from '../../app/useDialogFocus';
import barterService, { type BarterSettlement } from '../../services/barter.service';

export function BarterRefundDialog({ settlement, onClose, onRecorded }: {
  settlement: BarterSettlement; onClose: () => void; onRecorded: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [requestKey] = useState(() => crypto.randomUUID());
  const cash = settlement.cashObligation!;
  useDialogFocus(true, dialog, () => { if (!busyRef.current) onClose(); });
  const submit = async () => {
    if (busyRef.current || saved || !confirmed || reference.trim().length < 3 || note.trim().length < 3 || !date) return;
    busyRef.current = true; setBusy(true); setAttempted(true); setError('');
    try {
      const result = await barterService.recordRefund(settlement.id, { amount: cash.amount, currency: cash.currency, requestKey,
        paymentReference: reference.trim(), paymentDate: date, note: note.trim() });
      if (result.status !== 'settled') throw new Error('服务端未确认登记完成，请按原凭证重试核对。');
      setSaved(true); onRecorded();
    } catch (e) { setError(e instanceof Error ? e.message : '登记失败，请核对后按原凭证重试'); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const field = 'w-full rounded-xl border border-slate-300 bg-white p-3 text-slate-900 disabled:bg-slate-100';
  return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 p-4">
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="barter-refund-title" tabIndex={-1} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-xl">
      <h2 id="barter-refund-title" className="text-xl font-bold">登记已完成退款</h2>
      <p className="my-3 text-sm text-slate-700">{settlement.settlementNo} · {settlement.counterpartyName}</p>
      <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">本入口不打款。仅登记已在外部完成的全额退款及真实凭证，不改变销售回款或库存。已登记后不能直接冲销原批次。</p>
      <p className="my-4 font-bold">本次退款：{cash.currency} {cash.amount.toFixed(2)}</p>
      <div className="space-y-3">
        <label className="block">退款凭证编号<input className={field} aria-label="退款凭证编号" maxLength={160} value={reference} disabled={attempted} onChange={e => setReference(e.target.value)} /></label>
        <label className="block">实际退款日期<input className={field} aria-label="实际退款日期" type="date" max={new Date().toISOString().slice(0, 10)} value={date} disabled={attempted} onChange={e => setDate(e.target.value)} /></label>
        <label className="block">退款核对说明<textarea className={field} aria-label="退款核对说明" maxLength={1000} value={note} disabled={attempted} onChange={e => setNote(e.target.value)} /></label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={attempted} onChange={e => setConfirmed(e.target.checked)} />我已核对实际付款凭证、收款方、金额和币种</label>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}。本窗口保留原请求键与凭证；结果不明时不要换新凭证重复登记。</p>}
      {saved && <p role="status" className="mt-3 rounded-xl bg-emerald-50 p-3 font-bold text-emerald-800">退款凭证已登记：{reference}。请在台账核对。</p>}
      <div className="mt-5 flex justify-end gap-3">
        <button onClick={onClose} disabled={busy} className="rounded-xl border px-4 py-2">关闭</button>
        <button onClick={() => void submit()} disabled={busy || saved || !confirmed || reference.trim().length < 3 || note.trim().length < 3 || !date} className="rounded-xl bg-blue-700 px-4 py-2 text-white disabled:opacity-50">
          {busy ? '登记中…' : attempted && !saved ? '按原凭证重试' : '确认登记退款'}
        </button>
      </div>
    </div>
  </div>;
}
