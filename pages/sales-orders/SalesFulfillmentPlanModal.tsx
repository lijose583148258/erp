import React from 'react';
import { useDialogFocus } from '../../app/useDialogFocus';
import { salesFulfillmentPlanService as service, type SalesFulfillmentPlan, type SalesFulfillmentPlanInput, type SalesFulfillmentPlans } from '../../services/salesFulfillmentPlan.service';

const copy = {
  zh: { title: '采购补货计划', boundary: '仅关联本订单已审批采购单；计划不增加或预留实物库存，不登记收款。结案必须验证采购实收批次和客户正常签收。当前不强制拦截无计划确认，不含替代品、取消退款或生产补单。',
    refresh: '只刷新读取', close: '关闭', line: '订单行 / 待交量', po: '关联采购单 ID', qty: '计划数量', date: '预计交付时间', note: '计划依据', create: '建立计划草稿', reason: '审批 / 结案依据', approve: '独立审批', finish: '验证交付并结案', empty: '暂无采购补货计划',
    draft: '草稿', approved: '已批准', closed: '已结案', cancelled: '已取消', source: '冻结采购版本', self: '创建人不能审批自己的计划', saved: '已保存；请核对下方回读记录。', uncertain: '提交结果或回读未确认。已停用新增提交；请只刷新读取，勿重复建计划。', read: '正在读取最新计划…', accepted: '来源批次已签收',
  },
  en: { title: 'Purchase replenishment plans', boundary: 'Links approved purchases for this order only. No stock is added or reserved; no payment is posted. Closeout requires received source batches and accepted customer deliveries. Order confirmation is not gated; substitution, refunds and production plans are not included.',
    refresh: 'Refresh reading only', close: 'Close', line: 'Order line / outstanding', po: 'Linked purchase ID', qty: 'Planned quantity', date: 'Expected delivery', note: 'Plan basis', create: 'Create plan draft', reason: 'Approval / closeout reason', approve: 'Independent approval', finish: 'Verify delivery and close', empty: 'No replenishment plans',
    draft: 'Draft', approved: 'Approved', closed: 'Closed', cancelled: 'Cancelled', source: 'Frozen purchase revision', self: 'Creators cannot approve their own plans', saved: 'Saved; verify the records below.', uncertain: 'Submission or readback is unconfirmed. New submissions are disabled. Refresh reading only; do not duplicate the plan.', read: 'Loading current plans…', accepted: 'Accepted from source batches',
  },
  vi: { title: 'Kế hoạch mua bù hàng', boundary: 'Chỉ liên kết phiếu mua đã duyệt của đơn này. Không tăng hay giữ tồn kho, không ghi thu tiền. Kết thúc cần lô mua đã nhập và khách nhận đạt. Chưa chặn xác nhận đơn thiếu kế hoạch; chưa gồm hàng thay thế, hoàn tiền hay lệnh sản xuất.',
    refresh: 'Chỉ làm mới dữ liệu', close: 'Đóng', line: 'Dòng đơn / còn phải giao', po: 'ID phiếu mua liên kết', qty: 'Số lượng kế hoạch', date: 'Ngày giao dự kiến', note: 'Căn cứ kế hoạch', create: 'Tạo bản nháp', reason: 'Lý do duyệt / kết thúc', approve: 'Duyệt độc lập', finish: 'Xác minh giao và kết thúc', empty: 'Chưa có kế hoạch mua bù',
    draft: 'Bản nháp', approved: 'Đã duyệt', closed: 'Đã kết thúc', cancelled: 'Đã hủy', source: 'Phiên bản mua đã khóa', self: 'Người tạo không được tự duyệt', saved: 'Đã lưu; kiểm tra dữ liệu bên dưới.', uncertain: 'Chưa xác nhận kết quả gửi hoặc đọc lại. Đã khóa gửi mới. Chỉ làm mới dữ liệu, không tạo trùng.', read: 'Đang đọc kế hoạch mới nhất…', accepted: 'Đã nhận đạt từ lô nguồn',
  },
};
type Props = { orderId: string; actorId: number; canCreate: boolean; canReview: boolean; language?: string; onClose: () => void };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
export default function SalesFulfillmentPlanModal({ orderId, actorId, canCreate, canReview, language, onClose }: Props) {
  const t = language === 'en' ? copy.en : language === 'vi' ? copy.vi : copy.zh;
  const ref = React.useRef<HTMLDivElement>(null);
  const busy = React.useRef(false);
  const key = `sales-fulfillment-pending:${actorId}:${orderId}`;
  const pending = React.useRef<SalesFulfillmentPlanInput | null>(null);
  const [data, setData] = React.useState<SalesFulfillmentPlans | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [locked, setLocked] = React.useState(false);
  const [line, setLine] = React.useState('');
  const [po, setPo] = React.useState('');
  const [qty, setQty] = React.useState('');
  const [date, setDate] = React.useState('');
  const [note, setNote] = React.useState('');
  const [reason, setReason] = React.useState('');
  const close = React.useCallback(() => { if (!busy.current) onClose(); }, [onClose]);
  useDialogFocus(true, ref, close);
  const refresh = React.useCallback(async () => {
    const fresh = await service.list(orderId);
    setData(fresh);
    if (pending.current && fresh.plans.some(p => p.idempotencyKey === pending.current?.idempotencyKey)) {
      sessionStorage.removeItem(key);
      setNotice(t.saved);
    }
    setError('');
  }, [orderId, key, t.saved]);
  React.useEffect(() => {
    try {
      const stored = sessionStorage.getItem(key);
      if (stored) { pending.current = JSON.parse(stored); setLocked(true); setNotice(t.uncertain); }
    } catch { setLocked(true); setNotice(t.uncertain); }
    refresh().catch(e => setError(errorText(e))).finally(() => setLoading(false));
  }, [refresh, key, t.uncertain]);
  const act = async (operation: () => Promise<unknown>, create = false) => {
    if (busy.current) return;
    busy.current = true; setSaving(true); setError('');
    let persisted = false;
    try {
      await operation();
      persisted = true;
      if (create) sessionStorage.removeItem(key);
      setNotice(t.saved);
      await refresh();
    } catch (e) {
      setError(errorText(e));
      const status = (e as { status?: number }).status;
      if (create && !persisted && status && [400, 403, 404, 409, 422].includes(status)) {
        // Definitive validation/transaction rejection: no commit occurred. Keep
        // ambiguous network/5xx outcomes locked until a readback proves success.
        sessionStorage.removeItem(key); pending.current = null; setLocked(false); setNotice('');
      } else setNotice(t.uncertain);
    } finally { busy.current = false; setSaving(false); }
  };
  const create = () => {
    if (busy.current || locked || !valid) return;
    const input: SalesFulfillmentPlanInput = { idempotencyKey: crypto.randomUUID(), orderItemId: Number(line), fulfillmentOption: 'linked_purchase', sourceDocumentId: Number(po), plannedQuantity: Number(qty), expectedFulfillmentAt: new Date(date).toISOString(), note: note.trim() };
    pending.current = input;
    // Persist the exact request before transmission so closing/reopening after an
    // uncertain response cannot mint a new idempotency key and duplicate a plan.
    try { sessionStorage.setItem(key, JSON.stringify(input)); } catch (e) { setError(errorText(e)); return; }
    setLocked(true);
    void act(() => service.create(orderId, input), true);
  };
  const selected = data?.fulfillment.lines.find(row => String(row.orderItemId) === line);
  const valid = canCreate && data && !loading && !saving && !locked && selected && Number.isInteger(Number(po)) && Number(po) > 0
    && Number(qty) > 0 && Number(qty) <= selected.outstandingQuantity && Date.parse(date) > Date.now() && note.trim().length >= 3;
  const button = 'min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-40';
  const field = 'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-950 dark:bg-slate-900 dark:text-white';
  const review = (plan: SalesFulfillmentPlan, action: 'approve' | 'close') => {
    if (reason.trim().length < 3 || saving) return;
    void act(() => action === 'approve' ? service.approve(plan, reason.trim()) : service.close(plan, reason.trim(), `sales-plan-close:${plan.id}`));
  };
  return <div data-testid="sales-plan-modal" className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-950/60 p-3">
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="sales-plan-title" tabIndex={-1} className="max-h-[90dvh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5 text-slate-900 shadow-xl dark:bg-slate-950 dark:text-white">
      <header className="flex flex-wrap items-center justify-between gap-3"><h2 id="sales-plan-title" className="text-xl font-bold">{t.title} · #{orderId}</h2><button className={button} onClick={close} disabled={saving}>{t.close}</button></header>
      <p className="my-4 text-sm leading-6 text-slate-600 dark:text-slate-300">{t.boundary}</p>
      <button className={button} disabled={saving || loading} onClick={() => { void act(refresh); }}>{t.refresh}</button>
      {loading && <p role="status">{t.read}</p>}
      {error && <p role="alert" data-testid="sales-plan-error" className="my-3 text-red-700 dark:text-red-300">{error}</p>}
      {notice && <p role="status" data-testid="sales-plan-notice" className="my-3">{notice}</p>}
      {canCreate && data && <fieldset disabled={saving || locked} className="my-5 grid gap-3 sm:grid-cols-2">
        <label>{t.line}<select data-testid="sales-plan-line" className={field} value={line} onChange={e => setLine(e.target.value)}><option value="">—</option>{data.fulfillment.lines.map(row => <option key={row.orderItemId} value={row.orderItemId}>#{row.orderItemId} {row.productName} / {row.outstandingQuantity} {row.unit}</option>)}</select></label>
        <label>{t.po}<input data-testid="sales-plan-source" className={field} type="number" min="1" step="1" value={po} onChange={e => setPo(e.target.value)} /></label>
        <label>{t.qty}<input data-testid="sales-plan-quantity" className={field} type="number" min="0" step="any" value={qty} onChange={e => setQty(e.target.value)} /></label>
        <label>{t.date}<input data-testid="sales-plan-date" className={field} type="datetime-local" value={date} onChange={e => setDate(e.target.value)} /></label>
        <label className="sm:col-span-2">{t.note}<textarea data-testid="sales-plan-note" className={field} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} /></label>
        <button data-testid="sales-plan-create" className={`${button} bg-blue-700 text-white`} disabled={!valid} onClick={create}>{t.create}</button>
      </fieldset>}
      {canReview && <label className="my-4 block">{t.reason}<textarea data-testid="sales-plan-reason" className={field} maxLength={1000} value={reason} disabled={saving} onChange={e => setReason(e.target.value)} /></label>}
      <div className="mt-4 space-y-3">{data?.plans.length === 0 && <p>{t.empty}</p>}{data?.plans.map(plan => <section data-testid={`sales-plan-${plan.id}`} key={plan.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
        <h3 className="break-all font-semibold">{plan.planNo} · {t[plan.status as 'draft' | 'approved' | 'closed' | 'cancelled'] || plan.status}</h3>
        <p>{plan.plannedQuantity} {plan.unit} · {new Date(plan.expectedFulfillmentAt).toLocaleString()}</p>
        <p>{t.source}: PO-{plan.sourceSnapshot.id} / r{plan.sourceSnapshot.revision} · {plan.sourceSnapshot.quantity} {plan.sourceSnapshot.unit}</p>
        <p className="break-words">{plan.note}</p>
        {plan.closeoutSnapshot && <p>{t.accepted}: {plan.closeoutSnapshot.deliveredFromSource} {plan.unit}</p>}
        {plan.status === 'draft' && plan.createdBy === actorId && <p className="text-sm">{t.self}</p>}
        {canReview && plan.status === 'draft' && plan.createdBy !== actorId && <button data-testid={`sales-plan-approve-${plan.id}`} className={button} disabled={saving || reason.trim().length < 3} onClick={() => review(plan, 'approve')}>{t.approve}</button>}
        {canReview && plan.status === 'approved' && <button data-testid={`sales-plan-close-${plan.id}`} className={button} disabled={saving || reason.trim().length < 3} onClick={() => review(plan, 'close')}>{t.finish}</button>}
      </section>)}</div>
    </div>
  </div>;
}
