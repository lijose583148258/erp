import React, { useMemo, useState } from 'react';
import {
  CollectionDisputeRecord,
  CollectionHoldRecord,
  CollectionLedgerRecord,
  CollectionMilestoneRecord,
  CollectionOverdueRecord,
  CollectionPromiseRecord,
} from '../../src/services/collections.service';
import {
  formatDate,
  formatDateTime,
  getCollectionCustomerLabel,
  paymentBadge,
  statusBadge,
} from './collectionCenter.helpers';
import type { CollectionActionPermissions } from './useCollectionCenter';

type DetailTab = 'ledger' | 'promises' | 'disputes' | 'holds' | 'milestones';

type Props = {
  selectedOrderId: number | null;
  selectedOverdue: CollectionOverdueRecord | null;
  ledger: CollectionLedgerRecord[];
  promises: CollectionPromiseRecord[];
  disputes: CollectionDisputeRecord[];
  holds: CollectionHoldRecord[];
  milestones: CollectionMilestoneRecord[];
  formatPrice: (value?: number | null) => string;
  onVerifyPayment: (paymentId: number) => Promise<void>;
  onPromiseStatus: (promiseId: number, status: 'kept' | 'missed' | 'cancelled') => Promise<void>;
  onDisputeStatus: (disputeId: number, status: 'reviewing' | 'resolved' | 'rejected' | 'withdrawn') => Promise<void>;
  onReleaseHold: (item: CollectionHoldRecord) => Promise<void>;
  permissions: CollectionActionPermissions;
};

const tabs: Array<{ id: DetailTab; label: string }> = [
  { id: 'ledger', label: '回款流水' },
  { id: 'promises', label: '承诺记录' },
  { id: 'disputes', label: '争议记录' },
  { id: 'holds', label: '拦截状态' },
  { id: 'milestones', label: '合同节点' },
];

const paymentStatusLabelMap: Record<string, string> = {
  pending: '待核销',
  verified: '已核销',
  unpaid: '未回款',
  partial: '部分回款',
  paid: '已收齐',
  overdue: '逾期',
};

const promiseStatusLabelMap: Record<string, string> = {
  open: '待兑现',
  kept: '已兑现',
  missed: '已失约',
  cancelled: '已取消',
};

const disputeStatusLabelMap: Record<string, string> = {
  open: '待处理',
  reviewing: '处理中',
  resolved: '已解决',
  rejected: '已驳回',
  withdrawn: '已撤回',
};

const holdScopeLabelMap: Record<string, string> = {
  'customer-credit': '客户授信',
  'customer-shipment': '客户发货',
  'order-shipment': '订单发货',
};

const holdSourceLabelMap: Record<string, string> = {
  manual: '人工设置',
  system: '系统生成',
  dispute: '争议联动',
};

const milestoneStatusLabelMap: Record<string, string> = {
  open: '未完成',
  partial: '部分完成',
  paid: '已完成',
  overdue: '已逾期',
};

const CollectionCurrentOrderDetail: React.FC<Props> = ({
  selectedOrderId,
  selectedOverdue,
  ledger,
  promises,
  disputes,
  holds,
  milestones,
  formatPrice,
  onVerifyPayment,
  onPromiseStatus,
  onDisputeStatus,
  onReleaseHold,
  permissions,
}) => {
  const [activeTab, setActiveTab] = useState<DetailTab>('ledger');

  const detail = useMemo(() => {
    const relatedLedger = selectedOrderId ? ledger.filter((row) => row.orderId === selectedOrderId) : [];
    const relatedPromises = selectedOrderId ? promises.filter((row) => row.orderId === selectedOrderId) : [];
    const relatedDisputes = selectedOrderId ? disputes.filter((row) => row.orderId === selectedOrderId) : [];
    const orderNo = relatedLedger[0]?.orderNo || relatedPromises[0]?.orderNo || relatedDisputes[0]?.orderNo || '-';
    const customerLabel = relatedLedger[0]
      ? getCollectionCustomerLabel(relatedLedger[0])
      : relatedPromises[0]
        ? getCollectionCustomerLabel(relatedPromises[0])
        : relatedDisputes[0]
          ? getCollectionCustomerLabel(relatedDisputes[0])
          : '-';
    const customerId = relatedLedger[0]?.customerId || relatedPromises[0]?.customerId || relatedDisputes[0]?.customerId || null;
    const relatedHolds = holds.filter((row) => {
      if (selectedOrderId && row.scope === 'order-shipment' && row.orderId === selectedOrderId) return true;
      if (customerId && row.customerId === customerId) return true;
      return false;
    });
    const relatedMilestones = milestones.filter((row) => row.contractNo && relatedLedger.some((item) => item.contractNo && item.contractNo === row.contractNo));
    const financialSource = selectedOverdue || relatedLedger[0] || null;
    const finalAmount = Number(financialSource?.finalAmount || 0);
    const paidAmount = Number(financialSource?.paidAmount || 0);
    const receivableAdjustmentAmount = Number(financialSource?.receivableAdjustmentAmount || 0);
    const effectiveReceivableAmount = Math.max(0, finalAmount - receivableAdjustmentAmount);
    const outstandingAmount = selectedOverdue
      ? Number(selectedOverdue.outstanding || 0)
      : Math.max(0, effectiveReceivableAmount - paidAmount);

    return {
      orderNo,
      customerLabel,
      financialSource,
      finalAmount,
      paidAmount,
      receivableAdjustmentAmount,
      effectiveReceivableAmount,
      outstandingAmount,
      relatedLedger,
      relatedPromises,
      relatedDisputes,
      relatedHolds,
      relatedMilestones,
    };
  }, [selectedOrderId, selectedOverdue, ledger, promises, disputes, holds, milestones]);

  const renderEmpty = (text: string) => (
    <div className="rounded-[20px] border border-dashed border-slate-200 px-4 py-6 text-sm font-bold text-slate-400 dark:border-slate-700">
      {text}
    </div>
  );

  const renderContent = () => {
    if (activeTab === 'ledger') {
      if (!detail.relatedLedger.length) return renderEmpty('当前订单还没有回款流水。');
      return (
        <div className="space-y-3">
          {detail.relatedLedger.map((row) => (
            <div key={row.id} className="rounded-[20px] border border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/30">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-black text-slate-900 dark:text-white">{formatPrice(row.amount)}</div>
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black tracking-[0.14em] ${paymentBadge(row.status)}`}>
                      {paymentStatusLabelMap[row.status] || row.status}
                    </span>
                  </div>
                  <div className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
                    {row.method} · {formatDateTime(row.createdAt)} · {row.payerName || '未填写付款方'}
                  </div>
                  {row.note ? <div className="mt-1 text-xs font-bold text-slate-400 dark:text-slate-500">{row.note}</div> : null}
                </div>
                {row.status !== 'verified' && permissions.canVerifyPayment ? (
                  <button
                    type="button"
                    onClick={() => void onVerifyPayment(row.id)}
                    className="rounded-full bg-emerald-50 px-3 py-2 text-xs font-black tracking-[0.12em] text-emerald-700"
                  >
                    核销该笔
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (activeTab === 'promises') {
      if (!detail.relatedPromises.length) return renderEmpty('当前订单还没有承诺记录。');
      return (
        <div className="space-y-3">
          {detail.relatedPromises.map((row) => (
            <div key={row.id} className="rounded-[20px] border border-amber-100 bg-amber-50/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-black text-slate-900">{row.promiseNo}</div>
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black tracking-[0.14em] ${statusBadge(row.status)}`}>
                      {promiseStatusLabelMap[row.status] || row.status}
                    </span>
                  </div>
                  <div className="mt-1 text-xs font-bold text-slate-500">
                    {formatPrice(row.promisedAmount)} · 承诺时间 {formatDateTime(row.promisedAt)}
                  </div>
                  {row.note ? <div className="mt-1 text-xs font-bold text-slate-400">{row.note}</div> : null}
                </div>
                {row.status === 'open' && permissions.canManagePromise ? (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => void onPromiseStatus(row.id, 'kept')} className="rounded-full bg-emerald-50 px-3 py-2 text-xs font-black tracking-[0.12em] text-emerald-700">已兑现</button>
                    <button type="button" onClick={() => void onPromiseStatus(row.id, 'missed')} className="rounded-full bg-rose-50 px-3 py-2 text-xs font-black tracking-[0.12em] text-rose-700">已失约</button>
                    <button type="button" onClick={() => void onPromiseStatus(row.id, 'cancelled')} className="rounded-full bg-slate-100 px-3 py-2 text-xs font-black tracking-[0.12em] text-slate-700">取消</button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (activeTab === 'disputes') {
      if (!detail.relatedDisputes.length) return renderEmpty('当前订单还没有争议记录。');
      return (
        <div className="space-y-3">
          {detail.relatedDisputes.map((row) => (
            <div key={row.id} className="rounded-[20px] border border-rose-100 bg-rose-50/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-black text-slate-900">{row.disputeNo}</div>
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black tracking-[0.14em] ${statusBadge(row.status)}`}>
                      {disputeStatusLabelMap[row.status] || row.status}
                    </span>
                  </div>
                  <div className="mt-1 text-xs font-bold text-slate-500">
                    {row.disputedAmount === null ? '未填争议金额' : formatPrice(row.disputedAmount)} · {formatDateTime(row.createdAt)}
                  </div>
                  <div className="mt-1 text-xs font-bold text-slate-400">{row.reason}</div>
                </div>
                {(row.status === 'open' || row.status === 'reviewing') && permissions.canManageDispute ? (
                  <div className="flex flex-wrap gap-2">
                    {row.status === 'open' ? (
                      <button type="button" onClick={() => void onDisputeStatus(row.id, 'reviewing')} className="rounded-full bg-amber-50 px-3 py-2 text-xs font-black tracking-[0.12em] text-amber-700">处理中</button>
                    ) : null}
                    <button type="button" onClick={() => void onDisputeStatus(row.id, 'resolved')} className="rounded-full bg-emerald-50 px-3 py-2 text-xs font-black tracking-[0.12em] text-emerald-700">已解决</button>
                    <button type="button" onClick={() => void onDisputeStatus(row.id, 'rejected')} className="rounded-full bg-slate-100 px-3 py-2 text-xs font-black tracking-[0.12em] text-slate-700">驳回</button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (activeTab === 'holds') {
      if (!detail.relatedHolds.length) return renderEmpty('当前订单和客户没有拦截记录。');
      return (
        <div className="space-y-3">
          {detail.relatedHolds.map((row) => (
            <div key={`${row.scope}-${row.id}`} className="rounded-[20px] border border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/30">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-black text-slate-900 dark:text-white">{holdScopeLabelMap[row.scope] || row.scope}</div>
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black tracking-[0.14em] ${row.status ? 'bg-rose-50 text-rose-700 border-rose-100' : 'bg-slate-50 text-slate-500 border-slate-100'}`}>
                      {row.status ? '生效中' : '已释放'}
                    </span>
                  </div>
                  <div className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
                    {row.orderNo || detail.orderNo} · {row.source ? (holdSourceLabelMap[row.source] || row.source) : '人工设置'} · {row.updatedAt ? formatDateTime(row.updatedAt) : '-'}
                  </div>
                  {row.reason ? <div className="mt-1 text-xs font-bold text-slate-400 dark:text-slate-500">{row.reason}</div> : null}
                </div>
                {row.status && permissions.canManageHold ? (
                  <button type="button" onClick={() => void onReleaseHold(row)} className="rounded-full bg-slate-100 px-3 py-2 text-xs font-black tracking-[0.12em] text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    释放
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (!detail.relatedMilestones.length) return renderEmpty('当前订单还没有可见合同节点。');
    return (
      <div className="space-y-3">
        {detail.relatedMilestones.map((row) => (
          <div key={row.id} className="rounded-[20px] border border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/30">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <div className="text-sm font-black text-slate-900 dark:text-white">{row.title}</div>
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black tracking-[0.14em] ${statusBadge(row.status)}`}>
                    {milestoneStatusLabelMap[row.status] || row.status}
                  </span>
                </div>
                <div className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
                  {row.contractNo} · 到期 {formatDate(row.dueDate)}
                </div>
              </div>
              <div className="text-right text-xs font-bold text-slate-500 dark:text-slate-400">
                <div>目标 {formatPrice(row.targetAmount)}</div>
                <div>已收 {formatPrice(row.paidAmount)}</div>
                <div>剩余 {formatPrice(row.remainingAmount)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="rounded-[36px] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-bold tracking-[0.16em] text-slate-400">当前订单详情</p>
          <h3 className="mt-2 text-2xl font-black tracking-tighter text-slate-900 dark:text-white">
            {selectedOrderId ? `${detail.customerLabel} / ${detail.orderNo}` : '请选择一个订单'}
          </h3>
        </div>
        {selectedOrderId ? (
          <div className="text-xs font-bold text-slate-500 dark:text-slate-400">
            回款 {detail.relatedLedger.length} · 承诺 {detail.relatedPromises.length} · 争议 {detail.relatedDisputes.length} · 拦截 {detail.relatedHolds.length}
          </div>
        ) : null}
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-full border px-4 py-2 text-xs font-bold tracking-[0.12em] transition ${
              activeTab === tab.id
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {selectedOrderId && detail.financialSource ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {[
            { label: '原应收', value: formatPrice(detail.finalAmount) },
            { label: '已收款', value: formatPrice(detail.paidAmount) },
            { label: '应收调整', value: formatPrice(detail.receivableAdjustmentAmount) },
            { label: '有效应收', value: formatPrice(detail.effectiveReceivableAmount) },
            { label: '剩余未收', value: formatPrice(detail.outstandingAmount), accent: true },
          ].map((item) => (
            <div key={item.label} className={`rounded-[20px] border px-4 py-3 ${item.accent ? 'border-rose-100 bg-rose-50/70 text-rose-700' : 'border-slate-100 bg-slate-50/70 text-slate-600'} dark:border-slate-800 dark:bg-slate-800/30`}>
              <div className="text-[10px] font-black uppercase tracking-[0.14em] opacity-70">{item.label}</div>
              <div className="mt-1 text-sm font-black">{item.value}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-5">
        {selectedOrderId ? renderContent() : renderEmpty('请先从逾期清单或收款台账中选择一个订单。')}
      </div>
    </div>
  );
};

export default CollectionCurrentOrderDetail;
