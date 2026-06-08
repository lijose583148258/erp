
import React, { useCallback, useState, useEffect } from 'react';
import {
  RotateCcw,
  ShieldCheck,
  TrendingDown,
  ClipboardList
} from 'lucide-react';
import DataTable, { Column } from '../components/DataTable';
import { StatusBadge } from '../components/ui/StatusBadge';
import { customerService } from '../services/customer.service';
import { rmaService } from '../services/rma.service';
import { RmaRecord, RmaStatus } from '../types';
import { useAppContext } from '../app/AppContext';
import { isCanceledApiError } from '../utils/api';
import { getCustomerDisplayName } from '../utils/customerName';

const inputClass = 'rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none dark:bg-slate-950 dark:text-white';
const isPendingRma = (status: RmaRecord['status']) => status === RmaStatus.PENDING || status === RmaStatus.IN_REVIEW;
const rmaTypeLabels: Record<string, string> = {
  return: '退货',
  refund: '退款',
  exchange: '换货',
};

const RMA: React.FC = () => {
  const { t, notify, language } = useAppContext();
  const [data, setData] = useState<RmaRecord[]>([]);
  const [customers, setCustomers] = useState<Array<{ id: string; label: string }>>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showOnlyPending, setShowOnlyPending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    customerId: '',
    productName: '',
    quantity: '1',
    unit: 'kg',
    type: 'return',
    reason: '',
  });

  const loadData = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await rmaService.getAll({ signal });
      setData(result || []);
    } catch (error) {
      if (isCanceledApiError(error)) return;
      setData([]); // Shield against undefined/null
      notify('error', error instanceof Error ? error.message : (t.loadDataFail || 'RMA 数据加载失败'));
    }
  }, [notify, t.loadDataFail]);

  useEffect(() => {
    const controller = new AbortController();
    void loadData(controller.signal);
    return () => controller.abort();
  }, [loadData]);

  useEffect(() => {
    const controller = new AbortController();
    customerService
      .getAll({ signal: controller.signal })
      .then(list => {
        setCustomers(list.map(customer => ({
          id: String(customer.id),
          label: getCustomerDisplayName(customer, language),
        })));
      })
      .catch((error) => {
        if (isCanceledApiError(error)) return;
        notify('error', t.loadDataFail || '客户数据加载失败');
      });
    return () => controller.abort();
  }, [language, notify, t.loadDataFail]);

  const handleCreate = async () => {
    if (!draft.customerId) {
      notify('warning', t.selectCustomerRequired || '请选择客户');
      return;
    }
    if (!draft.productName.trim()) {
      notify('warning', t.productNameRequired || '请填写产品名称');
      return;
    }
    if (!draft.reason.trim()) {
      notify('warning', t.rmaReasonRequired || '请填写售后原因');
      return;
    }

    setSubmitting(true);
    try {
      const customer = customers.find(item => item.id === draft.customerId);
      const created = await rmaService.create({
        customerId: draft.customerId,
        customerName: customer?.label || '',
        customerDisplayName: customer?.label || '',
        productName: draft.productName.trim(),
        quantity: draft.quantity,
        unit: draft.unit.trim() || 'kg',
        type: draft.type,
        reason: draft.reason.trim(),
      });
      setData(prev => [created, ...prev]);
      setDraft({
        customerId: '',
        productName: '',
        quantity: '1',
        unit: 'kg',
        type: 'return',
        reason: '',
      });
      setShowCreateForm(false);
      notify('success', t.rmaCreated || '售后申请已创建');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : (t.rmaCreateFail || '售后申请创建失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleResolve = async (row: RmaRecord, status: RmaStatus.APPROVED | RmaStatus.REJECTED) => {
    const actionLabel = status === RmaStatus.APPROVED ? (t.verified || '已通过') : (t.commRejected || '已拒绝');
    setResolvingId(row.id);
    try {
      const updated = await rmaService.updateStatus(
        row.id,
        status,
        `${actionLabel}: ${row.reason || row.id}`,
        row,
      );
      setData(prev => prev.map(item => item.id === row.id ? { ...item, ...updated } : item));
      notify('success', `${actionLabel}: #${row.id}`);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : (t.rmaResolveFail || '售后处理失败'));
    } finally {
      setResolvingId(null);
    }
  };

  const pendingRows = data.filter(row => isPendingRma(row.status));
  const displayedData = showOnlyPending ? pendingRows : data;
  const pendingRate = data.length ? Math.round((pendingRows.length / data.length) * 100) : 0;

  const columns: Column<RmaRecord>[] = [
    { header: t.rmaTitle || '编号', key: 'id', accessor: (row) => <span className="font-mono font-bold">#{row.id}</span> },
    { header: t.orderRef || '关联订单', key: 'order', accessor: 'orderNo' },
    { header: t.customerName || '申请商', key: 'customer', accessor: (row: RmaRecord) => row.customerDisplayName || row.customerName },
    { header: t.productName || '产品', key: 'productName', accessor: (row: RmaRecord) => row.productName || '-' },
    {
      header: t.rmaReason || '详细原因', key: 'reason', accessor: (row: RmaRecord) => (
        <span className="text-xs font-medium truncate max-w-[180px] block" title={row.reason}>{row.reason || '-'}</span>
      )
    },
    {
      header: t.rmaType || '业务类型', key: 'type', accessor: (row: RmaRecord) => (
        <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-widest ${row.type === 'refund' ? 'bg-rose-50 text-rose-600 border border-rose-100' :
          row.type === 'exchange' ? 'bg-blue-50 text-blue-600 border border-blue-100' :
            'bg-slate-50 text-slate-600 border border-slate-100'
          }`}>
          {rmaTypeLabels[row.type || ''] || row.type || 'N/A'}
        </span>
      )
    },
    {
      header: t.status || '审核状态', key: 'status', accessor: (row: RmaRecord) => (
        <StatusBadge
          status={row.status}
          label={row.status === RmaStatus.APPROVED ? (t.verified || '已通过') : row.status === RmaStatus.REJECTED ? (t.commRejected || '已拒绝') : (t.pending || '待审核')}
          className="rounded-xl"
        />
      )
    },
    {
      header: t.actions || '操作', key: 'actions', accessor: (row: RmaRecord) => (
        isPendingRma(row.status) ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              data-testid={`rma-approve-${row.id}`}
              onClick={() => void handleResolve(row, RmaStatus.APPROVED)}
              disabled={resolvingId === row.id}
              className="min-w-[48px] whitespace-nowrap rounded-xl bg-emerald-50 px-3 py-1.5 text-[10px] font-black tracking-widest text-emerald-700 border border-emerald-100 hover:bg-emerald-100 disabled:opacity-50 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900/40"
            >
              {t.approve || '通过'}
            </button>
            <button
              data-testid={`rma-reject-${row.id}`}
              onClick={() => void handleResolve(row, RmaStatus.REJECTED)}
              disabled={resolvingId === row.id}
              className="min-w-[48px] whitespace-nowrap rounded-xl bg-rose-50 px-3 py-1.5 text-[10px] font-black tracking-widest text-rose-700 border border-rose-100 hover:bg-rose-100 disabled:opacity-50 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-900/40"
            >
              {t.reject || '拒绝'}
            </button>
          </div>
        ) : (
          <span className="text-xs font-black text-slate-300">-</span>
        )
      )
    },
  ];

  return (
    <div className="space-y-10 pb-16 animate-in fade-in slide-in-from-bottom-4 duration-1000">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
        <div>
          <h1 className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter italic uppercase bg-gradient-to-br from-slate-900 to-slate-500 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">{t.rma || '售后系统'}</h1>
          <p className="text-rose-600 dark:text-rose-400 font-black text-[10px] uppercase tracking-[0.3em] mt-3 opacity-70 px-1">{t.rmaSub || 'RMA & RETURNS MANAGEMENT'}</p>
        </div>
        <button
          data-testid="rma-open-create"
          onClick={() => setShowCreateForm(current => !current)}
          className="flex items-center px-8 py-4 bg-slate-900 dark:bg-slate-100 dark:text-slate-900 text-white rounded-[26px] font-black text-xs uppercase tracking-widest shadow-2xl hover:scale-105 transition-all"
        >
          <RotateCcw size={18} className="mr-3" />
          {t.rmaClaim || '提交申请'}
        </button>
      </div>

      <section data-testid="rma-boundary-notice" className="grid gap-4 md:grid-cols-3">
        <div className="rounded-[28px] border border-orange-100 bg-orange-50/80 p-5 text-sm font-bold leading-6 text-orange-900 dark:border-orange-900/40 dark:bg-orange-950/20 dark:text-orange-100">
          <div className="mb-2 flex items-center gap-2 text-xs font-black tracking-[0.16em] text-orange-600 dark:text-orange-200">
            <ShieldCheck size={14} />
            售后主入口
          </div>
          本页只记录客户退货、换货、退款和补偿审核。它不直接改库存、不直接核销回款，也不替代收发货差异工作台。
        </div>
        <div className="rounded-[28px] border border-blue-100 bg-blue-50/80 p-5 text-sm font-bold leading-6 text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-100">
          <div className="mb-2 text-xs font-black tracking-[0.16em] text-blue-600 dark:text-blue-200">正确闭环</div>
          先登记售后原因，再由经理审核；涉及退库、补发、扣款或赔付时，再进入仓储、发货、回款或财务调整。
        </div>
        <div className="rounded-[28px] border border-slate-100 bg-white/80 p-5 text-sm font-bold leading-6 text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300">
          <div className="mb-2 text-xs font-black tracking-[0.16em] text-slate-400">避免误用</div>
          如果问题来自短签、破损、错货，优先在“收发差异”形成事实，再转售后处置，避免同一异常被重复登记。
        </div>
      </section>

      {showCreateForm && (
        <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-8 rounded-[36px] border border-white/50 dark:border-slate-800 shadow-[0_15px_50px_rgba(0,0,0,0.03)] space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-black tracking-tighter text-slate-900 dark:text-white">{t.rmaClaim || '提交申请'}</h2>
              <p className="text-xs font-bold text-slate-400 mt-1">{t.rmaCreateHint || '记录客户退货、退款、换货等售后事项'}</p>
            </div>
            <button onClick={() => setShowCreateForm(false)} className="rounded-[18px] border border-slate-200 px-4 py-2 text-xs font-black text-slate-500">{t.cancel || '取消'}</button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm font-black text-slate-700 dark:text-slate-200">
              <span>{t.customer || '客户'}</span>
              <select
                data-testid="rma-create-customer"
                value={draft.customerId}
                onChange={(event) => setDraft(prev => ({ ...prev, customerId: event.target.value }))}
                className={inputClass}
              >
                <option value="">{t.phSelectCustomer || '请选择客户'}</option>
                {customers.map(customer => <option key={customer.id} value={customer.id}>{customer.label}</option>)}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-black text-slate-700 dark:text-slate-200">
              <span>{t.productName || '产品'}</span>
              <input
                data-testid="rma-create-product"
                value={draft.productName}
                onChange={(event) => setDraft(prev => ({ ...prev, productName: event.target.value }))}
                className={inputClass}
                placeholder="e.g. Resin A-01"
              />
            </label>
            <label className="grid gap-2 text-sm font-black text-slate-700 dark:text-slate-200">
              <span>{t.quantity || '数量'}</span>
              <input
                data-testid="rma-create-quantity"
                type="number"
                min="0.001"
                value={draft.quantity}
                onChange={(event) => setDraft(prev => ({ ...prev, quantity: event.target.value }))}
                className={inputClass}
              />
            </label>
            <label className="grid gap-2 text-sm font-black text-slate-700 dark:text-slate-200">
              <span>{t.unit || '单位'}</span>
              <input
                data-testid="rma-create-unit"
                value={draft.unit}
                onChange={(event) => setDraft(prev => ({ ...prev, unit: event.target.value }))}
                className={inputClass}
                placeholder="kg"
              />
            </label>
            <label className="grid gap-2 text-sm font-black text-slate-700 dark:text-slate-200">
              <span>{t.rmaType || '业务类型'}</span>
              <select
                data-testid="rma-create-type"
                value={draft.type}
                onChange={(event) => setDraft(prev => ({ ...prev, type: event.target.value }))}
                className={inputClass}
              >
                <option value="return">{t.rmaReturn || '退货'}</option>
                <option value="refund">{t.rmaRefund || '退款'}</option>
                <option value="exchange">{t.rmaExchange || '换货'}</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm font-black text-slate-700 dark:text-slate-200 md:col-span-2">
              <span>{t.rmaReason || '详细原因'}</span>
              <textarea
                data-testid="rma-create-reason"
                value={draft.reason}
                onChange={(event) => setDraft(prev => ({ ...prev, reason: event.target.value }))}
                className={`${inputClass} min-h-[110px] resize-none`}
                placeholder={t.phNote || '请输入原因'}
              />
            </label>
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={() => setShowCreateForm(false)} className="rounded-[18px] border border-slate-200 px-5 py-3 text-sm font-black text-slate-500">{t.cancel || '取消'}</button>
            <button
              data-testid="rma-create-submit"
              onClick={() => void handleCreate()}
              disabled={submitting}
              className="rounded-[18px] bg-slate-900 px-5 py-3 text-sm font-black text-white shadow-xl shadow-slate-900/20 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900"
            >
              {submitting ? (t.submitting || '提交中...') : (t.ctrlConfirm || '确认')}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-10 rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_15px_50px_rgba(0,0,0,0.03)] relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50 dark:bg-indigo-900/10 rounded-full -mr-16 -mt-16 group-hover:scale-[1.8] transition-transform duration-1000"></div>
          <div className="relative z-10 flex items-center space-x-6 mb-8">
            <div className="p-4 bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-[22px] shadow-xl group-hover:rotate-6 transition-transform"><TrendingDown size={28} /></div>
            <div>
              <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tighter italic">待处理占比</h3>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1.5 flex items-center">
                真实售后队列: <span className="text-indigo-600 dark:text-indigo-400 ml-1.5 italic">{pendingRows.length}/{data.length || 0}，{pendingRate}%</span>
              </p>
            </div>
          </div>
          <div className="relative h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500 transition-all duration-1000" style={{ width: `${pendingRate}%` }} />
          </div>
        </div>

        <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-10 rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_15px_50px_rgba(0,0,0,0.03)] flex flex-col md:flex-row items-center justify-between group gap-6">
          <div className="flex items-center space-x-6 w-full md:w-auto">
            <div className="p-4 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 rounded-[22px] group-hover:scale-110 transition-transform"><ClipboardList size={28} /></div>
            <div>
              <h3 className="text-xl font-black text-slate-800 dark:text-white tracking-tight uppercase italic">{t.pendingActions || '待审批'}</h3>
              <p className="text-sm text-slate-400 font-bold uppercase tracking-widest mt-1">
                {pendingRows.length} {t.rmaPendingSub || 'URGENT REVIEW'}
              </p>
            </div>
          </div>
          <button
            data-testid="rma-filter-pending"
            onClick={() => setShowOnlyPending(current => !current)}
            className="w-full md:w-auto px-8 py-4 text-emerald-700 dark:text-emerald-400 font-black bg-emerald-50 dark:bg-emerald-950/30 rounded-[22px] hover:bg-emerald-100 transition-all text-[10px] uppercase tracking-widest active-shrink"
          >
            {showOnlyPending ? (t.viewAll || '查看全部') : (t.auditNow || '立即审批')}
          </button>
        </div>
      </div>

      <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl rounded-[44px] border border-white/50 dark:border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.03)] overflow-hidden">
        <DataTable tableId="rma_final_v2" title={showOnlyPending ? (t.pendingActions || '待审批') : (t.rmaTitle || '售后处理流水')} columns={columns} data={displayedData} />
      </div>
    </div>
  );
};

export default RMA;


