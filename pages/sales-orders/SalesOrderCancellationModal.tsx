import React from 'react';
import { useDialogFocus } from '../../app/useDialogFocus';
import { orderService } from '../../src/services/order.service';
import { receivableAdjustmentService } from '../../services/receivableAdjustment.service';
import type { SalesOrder } from '../../types';
import { invalidateSalesOrderWorkspaceState } from './useSalesOrderWorkspaceData';

type Intent = Parameters<typeof receivableAdjustmentService.requestQuantityCancellation>[1];
const copy = {
  zh: { title: '取消待交数量', boundary: '仅取消尚未安排发货的数量，金额按原订单及折扣分摊。另一名财务过账后，待交量与应收同时减少；原订单、实收款和库存不变。需要退款的申请暂不受理。',
    line: '订单行 / 可取消数量', qty: '取消数量', reason: '客户取消依据', submit: '提交财务审核', refresh: '刷新回读', retry: '重试原申请', close: '关闭',
    unknown: '结果未确认。已保留原请求；请刷新回读或重试原申请，不要另建。', saved: '申请已回读，请由另一名财务审核。', pending: '待财务过账', posted: '已过账', reversed: '已冲回', empty: '暂无数量取消凭证', original: '原订', accepted: '已签收', cancelled: '已取消', owed: '待交', credit: '冲减应收' },
  en: { title: 'Cancel remaining quantity', boundary: 'Only unallocated quantities may be cancelled. Credit follows the original order and discount. Independent finance posting reduces demand and receivables together, without changing original lines, cash or stock. Refund cases are not supported here.',
    line: 'Order line / cancellable quantity', qty: 'Quantity to cancel', reason: 'Customer cancellation evidence', submit: 'Submit for finance review', refresh: 'Refresh readback', retry: 'Retry original request', close: 'Close',
    unknown: 'Outcome unconfirmed. Original request retained; refresh or retry it instead of creating another.', saved: 'Request read back. A different finance user must review.', pending: 'Pending finance posting', posted: 'Posted', reversed: 'Reversed', empty: 'No quantity cancellation vouchers', original: 'Ordered', accepted: 'Accepted', cancelled: 'Cancelled', owed: 'Still owed', credit: 'Receivable credit' },
  vi: { title: 'Hủy số lượng chưa giao', boundary: 'Chỉ hủy số lượng chưa bố trí giao; giá trị theo đơn gốc và chiết khấu. Nhân viên tài chính khác ghi sổ để giảm đồng thời số phải giao và công nợ. Không đổi đơn gốc, tiền thu hoặc tồn kho. Chưa hỗ trợ trường hợp cần hoàn tiền.',
    line: 'Dòng đơn / số có thể hủy', qty: 'Số lượng hủy', reason: 'Căn cứ khách yêu cầu hủy', submit: 'Gửi tài chính duyệt', refresh: 'Đọc lại dữ liệu', retry: 'Thử lại yêu cầu gốc', close: 'Đóng',
    unknown: 'Chưa xác nhận kết quả. Đã lưu yêu cầu gốc; đọc lại hoặc thử lại, không tạo yêu cầu khác.', saved: 'Đã đọc lại yêu cầu. Nhân viên tài chính khác cần duyệt.', pending: 'Chờ tài chính ghi sổ', posted: 'Đã ghi sổ', reversed: 'Đã đảo', empty: 'Chưa có chứng từ hủy số lượng', original: 'Đặt ban đầu', accepted: 'Đã nhận', cancelled: 'Đã hủy', owed: 'Còn phải giao', credit: 'Giảm công nợ' },
};

export default function SalesOrderCancellationModal({ orderId, actorId, language, onClose, onReadback }: {
  orderId: string; actorId: number; language: 'zh' | 'en' | 'vi'; onClose: () => void; onReadback: (order: SalesOrder) => void;
}) {
  const t = copy[language] || copy.zh, key = `order-quantity-cancellation:${actorId}:${orderId}`;
  const ref = React.useRef<HTMLDivElement>(null), busy = React.useRef(false);
  const [order, setOrder] = React.useState<SalesOrder | null>(null);
  const [intent, setIntent] = React.useState<Intent | null>(null);
  const [loading, setLoading] = React.useState(true), [saving, setSaving] = React.useState(false);
  const [storageUnsafe, setStorageUnsafe] = React.useState(false);
  const [error, setError] = React.useState(''), [notice, setNotice] = React.useState('');
  const [lineId, setLineId] = React.useState(''), [quantity, setQuantity] = React.useState(''), [reason, setReason] = React.useState('');
  const close = React.useCallback(() => { if (!busy.current) onClose(); }, [onClose]);
  useDialogFocus(true, ref, close);
  const readback = React.useCallback(async (pending: Intent | null) => {
    const fresh = await orderService.getById(orderId); setOrder(fresh); onReadback(fresh);
    if (pending && fresh.receivableAdjustments?.some(row => row.requestKey === pending.idempotencyKey
      && row.orderItemId === pending.orderItemId && row.cancelledQuantity === pending.quantity && row.reason === pending.reason)) {
      sessionStorage.removeItem(key); setIntent(null); setNotice(t.saved);
    }
    setError('');
  }, [key, orderId, t.saved, onReadback]);
  React.useEffect(() => {
    let stored: Intent | null = null;
    try { const raw = sessionStorage.getItem(key); if (raw) {
      stored = JSON.parse(raw);
      if (!stored || !Number.isSafeInteger(stored.orderItemId) || stored.orderItemId <= 0 || !Number.isFinite(stored.quantity)
        || stored.quantity <= 0 || typeof stored.idempotencyKey !== 'string' || !/^[a-zA-Z0-9:_-]{8,120}$/.test(stored.idempotencyKey)
        || typeof stored.expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(stored.expectedUpdatedAt))
        || typeof stored.reason !== 'string' || stored.reason.trim().length < 3) throw new Error(t.unknown);
      setIntent(stored); setNotice(t.unknown);
    } }
    catch (e) { setStorageUnsafe(true); setError(String(e)); setLoading(false); return; }
    void readback(stored).catch(e => setError(String(e.message || e))).finally(() => setLoading(false));
  }, [key, readback, t.unknown]);
  const records = order?.receivableAdjustments?.filter(row => row.adjustmentType === 'order_quantity_cancellation') || [];
  const selected = order?.fulfillment?.lines.find(line => line.orderItemId === Number(lineId));
  const valid = !storageUnsafe && order && order.updatedAt && ['confirmed', 'shipped', 'delivered'].includes(order.status)
    && !order.fulfillment?.needsReview && selected && Number.isFinite(Number(quantity)) && Number(quantity) > 0
    && Number(quantity) <= selected.unallocatedQuantity && reason.trim().length >= 3 && reason.trim().length <= 1000
    && !records.some(row => row.status === 'pending' && row.orderItemId === selected.orderItemId);
  const submit = async (original?: Intent) => {
    if (busy.current || (!original && (!valid || intent))) return;
    const payload = original || { orderItemId: Number(lineId), quantity: Number(quantity), expectedUpdatedAt: order!.updatedAt!,
      idempotencyKey: crypto.randomUUID(), reason: reason.trim() };
    try { sessionStorage.setItem(key, JSON.stringify(payload)); } catch (e) { setError(String(e)); return; }
    setIntent(payload); busy.current = true; setSaving(true); setError('');
    let persisted = false;
    try {
      await receivableAdjustmentService.requestQuantityCancellation(orderId, payload);
      persisted = true; invalidateSalesOrderWorkspaceState();
      await readback(payload);
    } catch (e) {
      const message = String((e as Error).message || e);
      setError(message); setNotice(t.unknown);
      // Unknown outcomes retain the exact request across dialog/page closure.
      const { status, errorCode } = e as { status?: number; errorCode?: string };
      if (!persisted && status && [400, 403, 404, 409, 422].includes(status)
        && !(original && [403, 404].includes(status)) && errorCode !== 'ORDER_CANCELLATION_IDEMPOTENCY_CONFLICT') {
        sessionStorage.removeItem(key); setIntent(null); setNotice('');
        await readback(null).catch(() => undefined); setError(message);
      }
    } finally { busy.current = false; setSaving(false); }
  };
  const field = 'w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4">
    <div ref={ref} role="dialog" aria-modal="true" aria-label={t.title} data-testid="sales-cancellation-dialog" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 text-slate-900 shadow-xl dark:bg-slate-900 dark:text-slate-100">
      <div className="flex items-center justify-between gap-4"><h2 className="text-lg font-semibold">{t.title} · {order?.orderNo || orderId}</h2><button className="min-h-11 px-3" onClick={close} disabled={saving}>{t.close}</button></div>
      <p className="my-3 text-sm text-slate-600 dark:text-slate-300">{t.boundary}</p>
      {error && <p role="alert" className="my-2 text-rose-600">{error}</p>}{notice && <p role="status" className="my-2 text-sm">{notice}</p>}
      <div className="space-y-3">
        <label className="block">{t.line}<select className={field} data-testid="sales-cancellation-line" value={lineId} disabled={saving || !!intent} onChange={e => setLineId(e.target.value)}><option value="">—</option>{order?.fulfillment?.lines.map(line => <option key={line.orderItemId} value={line.orderItemId}>#{line.orderItemId} {line.productName} / {line.unallocatedQuantity} {line.unit}</option>)}</select></label>
        {selected && <p className="text-sm">{t.original} {selected.orderedQuantity} · {t.accepted} {selected.acceptedQuantity} · {t.cancelled} {selected.cancelledQuantity || 0} · {t.owed} {selected.outstandingQuantity} {selected.unit}</p>}
        <label className="block">{t.qty}<input className={field} data-testid="sales-cancellation-quantity" type="number" step="any" min="0" value={quantity} disabled={saving || !!intent} onChange={e => setQuantity(e.target.value)} /></label>
        <label className="block">{t.reason}<textarea className={field} data-testid="sales-cancellation-reason" maxLength={1000} value={reason} disabled={saving || !!intent} onChange={e => setReason(e.target.value)} /></label>
        <div className="flex flex-wrap gap-3"><button data-testid="sales-cancellation-submit" className="min-h-11 rounded-lg bg-blue-700 px-4 text-white disabled:opacity-50" disabled={loading || saving || !!intent || !valid} onClick={() => void submit()}>{t.submit}</button>
          <button className="min-h-11 rounded-lg border px-3" disabled={saving} onClick={() => void readback(intent).catch(e => setError(String(e.message || e)))}>{t.refresh}</button>
          {intent && <button className="min-h-11 rounded-lg border px-3" disabled={saving} onClick={() => void submit(intent)}>{t.retry}</button>}</div>
      </div>
      <div className="mt-5 space-y-3" data-testid="sales-cancellation-history">{!records.length && <p className="text-sm">{t.empty}</p>}{records.map(row => <article key={row.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"><b>{row.adjustmentNo}</b> · {row.status === 'pending' ? t.pending : row.status === 'posted' ? t.posted : row.status === 'reversed' ? t.reversed : row.status}
        <p>#{row.orderItemId} · {t.qty} {row.cancelledQuantity} {order?.fulfillment?.lines.find(line => line.orderItemId === row.orderItemId)?.unit} · {t.credit} {row.amount} {order?.currency}</p><p className="break-words text-sm">{row.reason}</p></article>)}</div>
    </div>
  </div>;
}
