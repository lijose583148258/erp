import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, RefreshCcw, RotateCcw, Scale, Send } from 'lucide-react';
import { useAppContext } from '../../app/AppContext';
import { can } from '../../app/permissions';
import { EnterpriseColumn, EnterpriseDataGrid, FormField, ReasonDialog, StatusBadge } from '../../components/ui';
import { WorkspaceTaskNavigator } from '../../components/ui/WorkspaceTaskNavigator';
import { orderService } from '../../src/services/order.service';
import {
  receivableAdjustmentService,
  ReceivableAdjustmentRecord,
  ReceivableAdjustmentType,
} from '../../services/receivableAdjustment.service';
import type { SalesOrder } from '../../types';
import { getCustomerDisplayName } from '../../utils/customerName';

type Props = {
  onChanged?: () => void | Promise<void>;
};

type AdjustmentDeskTab = 'voucher' | 'ledger' | 'principle';

type FormState = {
  orderLookup: string;
  adjustmentType: ReceivableAdjustmentType;
  amount: string;
  currency: string;
  exchangeRate: string;
  reason: string;
  note: string;
};

const emptyForm: FormState = {
  orderLookup: '',
  adjustmentType: 'credit_memo',
  amount: '',
  currency: 'CNY',
  exchangeRate: '1',
  reason: '',
  note: '',
};

const adjustmentTypeLabels: Record<ReceivableAdjustmentType, string> = {
  credit_memo: '贷项通知',
  discount_allowance: '折让减免',
  bad_debt_writeoff: '坏账核销',
  short_payment_writeoff: '短款核销',
  fx_difference: '汇差调整',
};

const statusLabels: Record<string, string> = {
  pending: '待过账',
  posting: '过账中',
  posted: '已过账',
  reversing: '冲回中',
  reversed: '已冲回',
};

const orderCustomerName = (order: SalesOrder, language: string) => getCustomerDisplayName({
  name: order.customerName,
  nameZh: order.customerNameZh,
  nameEn: order.customerNameEn,
  nameVi: order.customerNameVi,
}, language as 'zh' | 'en' | 'vi');

const recordCustomerName = (record: ReceivableAdjustmentRecord, language: string) => getCustomerDisplayName({
  name: record.customerName || '',
  nameZh: record.customerNameZh || undefined,
  nameEn: record.customerNameEn || undefined,
  nameVi: record.customerNameVi || undefined,
}, language as 'zh' | 'en' | 'vi');

const getOrderAmounts = (order: SalesOrder) => {
  const finalAmount = Number(order.finalAmount ?? order.totalAmount ?? 0);
  const paidAmount = Number(order.paidAmount ?? 0);
  const adjustmentAmount = Number(order.receivableAdjustmentAmount ?? 0);
  const effectiveReceivableAmount = Number(order.effectiveReceivableAmount ?? Math.max(0, finalAmount - adjustmentAmount));
  const outstandingAmount = Number(order.outstandingAmount ?? Math.max(0, effectiveReceivableAmount - paidAmount));
  return {
    finalAmount,
    paidAmount,
    adjustmentAmount,
    effectiveReceivableAmount,
    outstandingAmount,
  };
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
};

const ReceivableAdjustmentPanel: React.FC<Props> = ({ onChanged }) => {
  const { currentUser, formatPrice, language, notify } = useAppContext();
  const [records, setRecords] = useState<ReceivableAdjustmentRecord[]>([]);
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const canCreate = can(currentUser, 'adjustments.write');
  const canPost = can(currentUser, 'adjustments.apply');
  const canReverse = can(currentUser, 'adjustments.reverse');
  const [activeAdjustmentDesk, setActiveAdjustmentDesk] = useState<AdjustmentDeskTab>('voucher');
  const [reverseRecord, setReverseRecord] = useState<ReceivableAdjustmentRecord | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [adjustmentResult, orderResult] = await Promise.all([
        receivableAdjustmentService.getAll({ page: 1, pageSize: 30 }),
        orderService.getAll(),
      ]);
      setRecords(adjustmentResult.data);
      setOrders(orderResult);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '应收调整工作台加载失败');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openOrders = useMemo(() => orders.filter((order) => {
    const { outstandingAmount } = getOrderAmounts(order);
    return outstandingAmount > 0.009 && order.status !== 'cancelled';
  }), [orders]);

  const resolveOrder = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const idFromLabel = trimmed.match(/ID:(\d+)/i)?.[1];
    const numericId = Number(idFromLabel || trimmed);
    if (Number.isInteger(numericId)) {
      const byId = orders.find((order) => Number(order.id) === numericId);
      if (byId) return byId;
    }
    const normalized = trimmed.toLowerCase();
    const exact = orders.find((order) => String(order.orderNo || '').toLowerCase() === normalized);
    if (exact) return exact;
    const candidates = orders.filter((order) => {
      const customerName = orderCustomerName(order, language).toLowerCase();
      return String(order.orderNo || '').toLowerCase().includes(normalized)
        || customerName.includes(normalized);
    });
    return candidates.length === 1 ? candidates[0] : null;
  }, [language, orders]);

  const selectedOrder = useMemo(() => resolveOrder(form.orderLookup), [form.orderLookup, resolveOrder]);
  const selectedAmounts = selectedOrder ? getOrderAmounts(selectedOrder) : null;
  const amountNumber = Number(form.amount || 0);

  const updateForm = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleCreate = async () => {
    if (!canCreate) return notify('warning', '当前角色没有创建应收调整单权限');
    if (!selectedOrder) return notify('warning', '请先选择一个明确的订单');
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) return notify('warning', '调整金额必须大于 0');
    if (selectedAmounts && amountNumber > selectedAmounts.outstandingAmount + 0.009) {
      return notify('warning', '调整金额不能超过订单剩余未收金额');
    }
    if (!form.reason.trim()) return notify('warning', '请填写调整原因');

    setSubmitting(true);
    try {
      await receivableAdjustmentService.create({
        orderId: Number(selectedOrder.id),
        adjustmentType: form.adjustmentType,
        amount: amountNumber,
        currency: form.currency || 'CNY',
        exchangeRate: Number(form.exchangeRate || 1),
        reason: form.reason.trim(),
        note: form.note.trim() || null,
      });
      notify('success', '应收调整单已创建，需过账后才影响有效应收');
      setForm(emptyForm);
      await loadData();
      await onChanged?.();
      setActiveAdjustmentDesk('ledger');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '应收调整单创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePost = async (record: ReceivableAdjustmentRecord) => {
    if (!canPost) return notify('warning', '当前角色没有过账权限');
    setSubmitting(true);
    try {
      await receivableAdjustmentService.post(record.id);
      notify('success', `${record.adjustmentNo} 已过账，有效应收已更新`);
      await loadData();
      await onChanged?.();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '应收调整单过账失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReverse = async (record: ReceivableAdjustmentRecord) => {
    if (!canReverse) return notify('warning', '当前角色没有冲回权限');
    setReverseRecord(record);
  };

  const confirmReverse = async (note: string) => {
    if (!reverseRecord) return;
    setSubmitting(true);
    try {
      await receivableAdjustmentService.reverse(reverseRecord.id, note);
      notify('success', `${reverseRecord.adjustmentNo} 已冲回，有效应收已恢复`);
      setReverseRecord(null);
      await loadData();
      await onChanged?.();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '应收调整单冲回失败');
    } finally {
      setSubmitting(false);
    }
  };

  const columns = useMemo<EnterpriseColumn<ReceivableAdjustmentRecord>[]>(() => [
    {
      key: 'adjustmentNo',
      header: '调整单',
      accessor: 'adjustmentNo',
      sortable: true,
      width: '150px',
      searchText: (record) => `${record.adjustmentNo} ${record.orderNo || ''} ${record.reason}`,
    },
    {
      key: 'type',
      header: '类型',
      width: '130px',
      render: (record) => adjustmentTypeLabels[record.adjustmentType] || record.adjustmentType,
      searchText: (record) => adjustmentTypeLabels[record.adjustmentType] || record.adjustmentType,
    },
    {
      key: 'target',
      header: '订单 / 客户',
      width: '240px',
      render: (record) => (
        <div>
          <div className="font-black text-slate-900 dark:text-white">{record.orderNo || `订单 ${record.orderId}`}</div>
          <div className="mt-1 text-xs font-bold text-slate-400">{recordCustomerName(record, language)}</div>
        </div>
      ),
      searchText: (record) => `${record.orderNo || ''} ${recordCustomerName(record, language)}`,
    },
    {
      key: 'amount',
      header: '调整金额',
      isNumeric: true,
      width: '140px',
      render: (record) => <span className="font-black text-rose-600">{formatPrice(record.amount as number)}</span>,
      searchText: (record) => String(record.amount),
    },
    {
      key: 'effective',
      header: '有效应收 / 未收',
      width: '180px',
      render: (record) => record.orderSnapshot ? (
        <div className="text-xs font-bold leading-5 text-slate-500">
          <div>有效 {formatPrice(record.orderSnapshot.effectiveReceivableAmount)}</div>
          <div>未收 {formatPrice(record.orderSnapshot.outstandingAmount)}</div>
        </div>
      ) : '-',
      searchText: (record) => `${record.orderSnapshot?.effectiveReceivableAmount || ''} ${record.orderSnapshot?.outstandingAmount || ''}`,
    },
    {
      key: 'status',
      header: '状态',
      width: '120px',
      render: (record) => <StatusBadge status={record.status} label={statusLabels[record.status] || record.status} />,
      searchText: (record) => statusLabels[record.status] || record.status,
    },
    {
      key: 'reason',
      header: '原因',
      accessor: 'reason',
      width: '220px',
      searchText: (record) => `${record.reason} ${record.note || ''}`,
    },
    {
      key: 'createdAt',
      header: '创建时间',
      width: '170px',
      render: (record) => formatDateTime(record.createdAt),
      searchText: (record) => record.createdAt,
    },
  ], [formatPrice, language]);
  const adjustmentDeskItems = [
    {
      id: 'voucher' as AdjustmentDeskTab,
      title: '调整凭证',
      subtitle: '选择订单、填写类型、金额和原因',
      purpose: '只创建应收调整单，不代表客户已经付款。',
      icon: Send,
      count: openOrders.length,
    },
    {
      id: 'ledger' as AdjustmentDeskTab,
      title: '台账回读',
      subtitle: '查看调整单、过账和冲回',
      purpose: '只有过账后的调整才会影响有效应收。',
      icon: Scale,
      count: records.length,
    },
    {
      id: 'principle' as AdjustmentDeskTab,
      title: '规则说明',
      subtitle: '明确调整和回款的边界',
      purpose: '防止把折让、坏账、短款误当成真实收款。',
      icon: CheckCircle2,
      count: 3,
    },
  ];

  return (
    <section data-testid="receivable-adjustment-panel" className="rounded-[44px] border border-white/60 bg-white/70 p-6 shadow-[0_20px_50px_rgba(15,23,42,0.04)] backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/70">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Scale size={18} className="text-blue-600" />
            <p className="text-xs font-black tracking-[0.18em] text-blue-600">RECEIVABLE ADJUSTMENT</p>
          </div>
          <h2 className="mt-3 text-2xl font-black tracking-tighter text-slate-900 dark:text-white">应收调整工作台</h2>
          <p className="mt-2 max-w-3xl text-sm font-bold leading-6 text-slate-500 dark:text-slate-400">
            贷项、折让、坏账和短款只冲减有效应收，不伪装成回款；创建后必须过账，冲回会恢复订单应收口径。
          </p>
        </div>
        <button
          type="button"
          data-testid="receivable-adjustment-refresh"
          onClick={() => void loadData()}
          className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-3 text-xs font-black tracking-[0.14em] text-slate-600 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          <RefreshCcw size={15} className="mr-2" />
          刷新
        </button>
      </div>

      <div className="mt-6">
        <WorkspaceTaskNavigator
          eyebrow="应收调整职责导航"
          title="先建调整凭证，再过账回读"
          description="应收调整不是回款。它只处理贷项、折让、坏账、短款和汇差，必须过账后才改变有效应收，冲回会恢复订单口径。"
          items={adjustmentDeskItems}
          activeId={activeAdjustmentDesk}
          onChange={(id) => {
            if (id === 'voucher' || id === 'ledger' || id === 'principle') {
              setActiveAdjustmentDesk(id);
            }
          }}
          variant="blue"
        />
      </div>

      <div className={`${activeAdjustmentDesk === 'principle' ? 'hidden' : 'grid'} mt-6 gap-5 ${activeAdjustmentDesk === 'voucher' ? 'xl:grid-cols-[420px,minmax(0,1fr)]' : ''}`}>
        <div className={`${activeAdjustmentDesk === 'voucher' ? '' : 'hidden'} rounded-[32px] border border-slate-100 bg-slate-50/70 p-5 dark:border-slate-800 dark:bg-slate-950/30`}>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-black tracking-[0.16em] text-slate-400">新建调整单</p>
              <h3 className="mt-1 text-xl font-black text-slate-900 dark:text-white">手填 + 联想订单</h3>
            </div>
            <CheckCircle2 size={20} className="text-emerald-500" />
          </div>
          <div className="space-y-4">
            <FormField
              label="订单搜索或手填 ID"
              value={form.orderLookup}
              onChange={(value) => updateForm('orderLookup', value)}
              placeholder="输入订单号、客户名，或从联想项选择"
              dataTestId="receivable-adjustment-order"
              list="receivable-adjustment-order-options"
              hint={selectedOrder ? `已选 ${selectedOrder.orderNo || selectedOrder.id} · 剩余未收 ${formatPrice(selectedAmounts?.outstandingAmount || 0)}` : '建议选择剩余未收大于 0 的订单'}
              inputClassName="font-bold"
            />
            <datalist id="receivable-adjustment-order-options">
              {openOrders.slice(0, 80).map((order) => {
                const amounts = getOrderAmounts(order);
                const label = `${order.orderNo || order.id} | ${orderCustomerName(order, language)} | 未收 ${formatPrice(amounts.outstandingAmount)} | ID:${order.id}`;
                return <option key={order.id} value={label} />;
              })}
            </datalist>

            <div className="grid gap-3 md:grid-cols-2">
              <FormField
                label="调整类型"
                as="select"
                value={form.adjustmentType}
                onChange={(value) => updateForm('adjustmentType', value as ReceivableAdjustmentType)}
                options={Object.entries(adjustmentTypeLabels).map(([value, label]) => ({ value, label }))}
                dataTestId="receivable-adjustment-type"
              />
              <FormField
                label="调整金额"
                type="number"
                value={form.amount}
                onChange={(value) => updateForm('amount', value)}
                placeholder="0.00"
                dataTestId="receivable-adjustment-amount"
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <FormField
                label="币种"
                as="select"
                value={form.currency}
                onChange={(value) => updateForm('currency', value)}
                options={['CNY', 'USD', 'VND'].map((value) => ({ value, label: value }))}
                dataTestId="receivable-adjustment-currency"
              />
              <FormField
                label="折算汇率"
                type="number"
                value={form.exchangeRate}
                onChange={(value) => updateForm('exchangeRate', value)}
                placeholder="1"
                dataTestId="receivable-adjustment-exchange-rate"
              />
            </div>
            <FormField
              label="调整原因"
              value={form.reason}
              onChange={(value) => updateForm('reason', value)}
              placeholder="例如：客户短款确认 / 质量折让 / 坏账审批"
              dataTestId="receivable-adjustment-reason"
              required
            />
            <FormField
              label="备注"
              as="textarea"
              value={form.note}
              onChange={(value) => updateForm('note', value)}
              placeholder="可填写审批依据、对方确认信息或附件编号"
              dataTestId="receivable-adjustment-note"
            />
            {selectedOrder && selectedAmounts ? (
              <div className="rounded-[24px] border border-blue-100 bg-blue-50/70 p-4 text-xs font-bold leading-6 text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-100">
                <div>原应收：{formatPrice(selectedAmounts.finalAmount)}</div>
                <div>已收款：{formatPrice(selectedAmounts.paidAmount)}</div>
                <div>已调整：{formatPrice(selectedAmounts.adjustmentAmount)}</div>
                <div>有效应收：{formatPrice(selectedAmounts.effectiveReceivableAmount)}</div>
                <div>剩余未收：{formatPrice(selectedAmounts.outstandingAmount)}</div>
              </div>
            ) : null}
            <button
              type="button"
              data-testid="receivable-adjustment-create"
              onClick={() => void handleCreate()}
              disabled={submitting || !canCreate}
              className="inline-flex w-full items-center justify-center rounded-[22px] bg-slate-900 px-5 py-3 text-xs font-black tracking-[0.16em] text-white shadow-lg shadow-slate-900/10 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send size={15} className="mr-2" />
              {submitting ? '处理中...' : '创建调整单'}
            </button>
          </div>
        </div>

        <div className={activeAdjustmentDesk === 'voucher' || activeAdjustmentDesk === 'ledger' ? '' : 'hidden'}>
        <EnterpriseDataGrid<ReceivableAdjustmentRecord>
          title="应收调整台账"
          description="只展示应收调整凭证，不混入库存/生产差异调整。"
          columns={columns}
          data={records}
          rowKey="id"
          loading={loading}
          defaultPageSize={8}
          emptyTitle="暂无应收调整单"
          searchPlaceholder="搜索单号、订单、客户、原因"
          searchInputTestId="receivable-adjustment-search"
          exportFileName="receivable-adjustments"
          rowActions={(record) => (
            <div className="flex flex-wrap justify-end gap-2">
              {record.status === 'pending' ? (
                <button
                  type="button"
                  data-testid={`receivable-adjustment-post-${record.id}`}
                  onClick={(event) => { event.stopPropagation(); void handlePost(record); }}
                  disabled={submitting || !canPost}
                  className="rounded-full bg-emerald-50 px-3 py-2 text-xs font-black tracking-[0.12em] text-emerald-700 disabled:opacity-50"
                >
                  过账
                </button>
              ) : null}
              {record.status === 'posted' ? (
                <button
                  type="button"
                  data-testid={`receivable-adjustment-reverse-${record.id}`}
                  onClick={(event) => { event.stopPropagation(); void handleReverse(record); }}
                  disabled={submitting || !canReverse}
                  className="inline-flex items-center rounded-full bg-rose-50 px-3 py-2 text-xs font-black tracking-[0.12em] text-rose-700 disabled:opacity-50"
                >
                  <RotateCcw size={12} className="mr-1" />
                  冲回
                </button>
              ) : null}
            </div>
          )}
        />
        </div>
      </div>

      <div className={`${activeAdjustmentDesk === 'principle' ? 'grid' : 'hidden'} mt-6 gap-4 md:grid-cols-3`}>
        <div className="rounded-[28px] border border-blue-100 bg-blue-50/70 p-5 text-sm font-bold leading-6 text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-100">
          <div className="mb-2 text-xs font-black tracking-[0.16em] text-blue-600 dark:text-blue-200">不是回款</div>
          应收调整不会产生现金流，只改变订单有效应收口径；真实到账仍必须走回款核销。
        </div>
        <div className="rounded-[28px] border border-amber-100 bg-amber-50/70 p-5 text-sm font-bold leading-6 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-100">
          <div className="mb-2 text-xs font-black tracking-[0.16em] text-amber-600 dark:text-amber-200">必须过账</div>
          新建调整单只是草稿凭证，过账后才会影响有效应收；未过账不能用于管理报表判断。
        </div>
        <div className="rounded-[28px] border border-rose-100 bg-rose-50/70 p-5 text-sm font-bold leading-6 text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-100">
          <div className="mb-2 text-xs font-black tracking-[0.16em] text-rose-600 dark:text-rose-200">冲回留痕</div>
          冲回不是删除，必须保留原调整单、冲回原因和操作时间，保证后续对账可追溯。
        </div>
      </div>

      <ReasonDialog
        testId="receivable-adjustment-reverse-dialog"
        open={Boolean(reverseRecord)}
        title={reverseRecord ? `冲回应收调整单 ${reverseRecord.adjustmentNo}` : '冲回应收调整单'}
        description="冲回会恢复订单有效应收口径，请填写业务复核原因，避免后续财务对账无法追溯。"
        defaultReason="业务复核后冲回"
        confirmLabel="确认冲回"
        tone="danger"
        loading={submitting}
        onCancel={() => setReverseRecord(null)}
        onConfirm={confirmReverse}
      />
    </section>
  );
};

export default ReceivableAdjustmentPanel;
