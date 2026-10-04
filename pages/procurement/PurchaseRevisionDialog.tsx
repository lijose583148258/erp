import React, { useEffect, useRef, useState } from 'react';
import { useDialogFocus } from '../../app/useDialogFocus';
import { useUnsavedForm } from '../../app/useUnsavedForm';
import { FormField } from '../../components/ui';
import { procurementService, type PurchaseOrder, type PurchaseRevisionHistory } from '../../services/procurement.service';
import type { ApiClientError } from '../../utils/api';

const fieldsFrom = (order: PurchaseOrder) => ({ quantity: String(order.quantity), price: String(order.price),
  taxAmount: String(order.taxAmount ?? 0), eta: order.eta.slice(0, 10), reason: '' });

function historyText(entry: PurchaseRevisionHistory) {
  try {
    const record = JSON.parse(entry.details);
    if (record.schema === 'purchase-revision/v1') return `版本 ${record.before.revision} → ${record.after.revision}；数量 ${record.before.quantity} → ${record.after.quantity}；单价 ${record.before.price} → ${record.after.price}；税额 ${record.before.taxAmount} → ${record.after.taxAmount}；交期 ${String(record.before.eta).slice(0, 10)} → ${String(record.after.eta).slice(0, 10)}；原因：${record.reason}`;
    if (record.schema === 'purchase-status/v1') return `版本 ${record.revision}：${record.from} → ${record.to}`;
  } catch { /* Older audit records contain plain text. */ }
  return entry.details;
}

export function PurchaseRevisionDialog({ order, canWrite, onSaved, onClose }: {
  order: PurchaseOrder; canWrite: boolean; onSaved: (order: PurchaseOrder) => void; onClose: () => void;
}) {
  const [base, setBase] = useState(order);
  const [fields, setFields] = useState(() => fieldsFrom(order));
  const [latest, setLatest] = useState<PurchaseOrder | null>(null);
  const [history, setHistory] = useState<PurchaseRevisionHistory[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { requestClose } = useUnsavedForm({ sourceId: 'purchase-revision', label: '采购变更', open: true,
    value: fields, resetKey: saved ? base.updatedAt : order.id });
  const close = () => { if (!busy) requestClose(onClose); };
  useDialogFocus(true, ref, close);
  const editable = canWrite && ['pending', 'approved'].includes(base.status);

  useEffect(() => {
    let active = true;
    procurementService.getOrderRevisions(order.id).then(result => {
      if (!active) return;
      setHistory(result.history);
      if (result.purchaseOrder.updatedAt !== order.updatedAt) setLatest(result.purchaseOrder);
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '读取变更记录失败'); });
    return () => { active = false; };
  }, [order.id]);

  const save = async () => {
    if (busy || latest || !editable) return;
    if (!fields.quantity.trim() || !fields.price.trim() || !fields.taxAmount.trim()
      || !Number.isFinite(Number(fields.quantity)) || Number(fields.quantity) <= 0
      || !Number.isFinite(Number(fields.price)) || Number(fields.price) < 0
      || !Number.isFinite(Number(fields.taxAmount)) || Number(fields.taxAmount) < 0
      || !fields.eta || fields.reason.trim().length < 3) {
      setError('请填写有效数量、单价、税额、交期和至少 3 个字的变更原因'); return;
    }
    setBusy(true); setError(''); setSaved(false);
    try {
      const updated = await procurementService.reviseOrder(base.id, { expectedRevision: base.revision ?? 0,
        expectedUpdatedAt: base.updatedAt || '', quantity: Number(fields.quantity), price: Number(fields.price),
        taxAmount: Number(fields.taxAmount), eta: fields.eta, reason: fields.reason.trim() });
      setBase(updated); setFields(fieldsFrom(updated)); setSaved(true); onSaved(updated);
      const result = await procurementService.getOrderRevisions(updated.id);
      setHistory(result.history);
    } catch (reason) {
      const failure = reason as ApiClientError;
      setError(failure.message || '保存失败');
      if (failure.status === 409) {
        try { const result = await procurementService.getOrderRevisions(base.id); setLatest(result.purchaseOrder); setHistory(result.history); }
        catch { setError(`${failure.message}；最新版本读取失败，请关闭后刷新重试`); }
      }
    } finally { setBusy(false); }
  };

  return <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" data-testid="purchase-revision-dialog">
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="purchase-revision-title" tabIndex={-1}
      className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-6 text-slate-900 shadow-2xl dark:bg-slate-900 dark:text-white">
      <div className="flex items-start justify-between gap-4">
        <div><h2 id="purchase-revision-title" className="text-xl font-black">采购版本与变更</h2>
          <p className="mt-2 text-sm">{base.item} · #{base.id} · <span data-testid="purchase-revision-number">版本 {base.revision ?? 0}</span> · {base.status}</p></div>
        <button type="button" data-testid="purchase-revision-close" disabled={busy} onClick={close} className="rounded-xl border px-3 py-2">关闭</button>
      </div>
      <p className="my-4 rounded-2xl bg-blue-50 p-3 text-sm text-blue-900 dark:bg-blue-950 dark:text-blue-100">
        变更数量、单价、税额或交期后，旧审批失效，必须重新审批。供应商、物料、单位、币种、汇率及附加费用不在此处改写；已有收货需走调整流程。税额须明确复核，不自动沿用税率推算。
      </p>
      {latest && <section data-testid="purchase-revision-conflict" className="my-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="alert">
        <h3 className="font-bold">版本冲突：未覆盖你的输入</h3>
        <p>最新版本 {latest.revision ?? 0} · {latest.status}；请先核对差异，不会自动重试。</p>
        <table className="my-3 w-full text-left"><thead><tr><th>字段</th><th>最新记录</th><th>我的输入</th></tr></thead><tbody>
          {(['quantity', 'price', 'taxAmount', 'eta'] as const).map(key => <tr key={key}><td>{{ quantity: '数量', price: '单价', taxAmount: '税额', eta: '交期' }[key]}</td><td>{String(latest[key] ?? '').slice(0, key === 'eta' ? 10 : 80)}</td><td>{fields[key]}</td></tr>)}
        </tbody></table>
        <button type="button" data-testid="purchase-revision-rebase" disabled={busy} className="rounded-xl border border-amber-600 px-3 py-2 font-bold"
          onClick={() => { setBase(latest); setLatest(null); setError(''); setSaved(false); }}>我已核对，以最新版本为基准保留我的输入</button>
      </section>}
      <fieldset disabled={busy || !editable} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label={`采购数量（${base.unit}）`} type="number" dataTestId="purchase-revision-quantity" value={fields.quantity} onChange={value => setFields(prev => ({ ...prev, quantity: value }))} />
        <FormField label={`采购单价（${base.currency}）`} type="number" dataTestId="purchase-revision-price" value={fields.price} onChange={value => setFields(prev => ({ ...prev, price: value }))} />
        <FormField label="税额（CNY，明确复核）" type="number" dataTestId="purchase-revision-tax" value={fields.taxAmount} onChange={value => setFields(prev => ({ ...prev, taxAmount: value }))} />
        <FormField label="预计到货日期" type="date" dataTestId="purchase-revision-eta" value={fields.eta} onChange={value => setFields(prev => ({ ...prev, eta: value }))} />
        <label className="sm:col-span-2">变更原因<textarea className="mt-2 w-full rounded-xl border bg-transparent p-3" data-testid="purchase-revision-reason" maxLength={1000} value={fields.reason} onChange={event => setFields(prev => ({ ...prev, reason: event.target.value }))} /></label>
      </fieldset>
      {error && <p role="alert" data-testid="purchase-revision-error" className="mt-3 text-sm text-rose-600">{error}</p>}
      {saved && <p role="status" data-testid="purchase-revision-saved" className="mt-3 text-sm text-emerald-700">新版本已保存，当前待审批；请关闭后在采购单行重新审批。</p>}
      {canWrite && <button type="button" data-testid="purchase-revision-save" disabled={busy || !!latest || !editable} onClick={() => void save()}
        className="my-4 rounded-xl bg-blue-600 px-4 py-3 font-bold text-white disabled:opacity-40">{busy ? '保存中…' : '保存新版本（待审批）'}</button>}
      <h3 className="mt-4 font-bold">最近 100 条变更与审批记录</h3>
      <ul data-testid="purchase-revision-history" className="mt-3 space-y-3 text-sm">
        {history.map(entry => <li key={entry.id} className="rounded-xl border p-3"><p className="font-semibold">{entry.createdAt} · 操作人 #{entry.userId} · {entry.action}</p><p className="mt-2 break-words">{historyText(entry)}</p></li>)}
        {!history.length && <li>暂无变更记录</li>}
      </ul>
    </div>
  </div>;
}
