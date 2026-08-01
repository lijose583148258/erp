import React from 'react';
import { BellRing, FileWarning, LifeBuoy, ShieldAlert, Sparkles } from 'lucide-react';
import type {
  CollectionDisputeRecord,
  CollectionHoldRecord,
  CollectionLedgerRecord,
  CollectionOverdueRecord,
  CollectionPromiseRecord,
} from '../../src/services/collections.service';
import type { CollectionActionPermissions } from './useCollectionCenter';
import {
  formatDate,
  formatDateTime,
  getCollectionCustomerLabel,
  getElapsedDays,
  getHoldStrategy,
  paymentBadge,
} from './collectionCenter.helpers';

type Props = {
  selectedOrderId: number | null;
  selectedOverdue: CollectionOverdueRecord | null;
  ledger: CollectionLedgerRecord[];
  promises: CollectionPromiseRecord[];
  disputes: CollectionDisputeRecord[];
  holds: CollectionHoldRecord[];
  formatPrice: (value?: number | null) => string;
  permissions: CollectionActionPermissions;
  syncing: boolean;
  batching: boolean;
  onSyncOverdue: () => Promise<void>;
  onBatchReminder: () => Promise<void>;
  onReminder: (orderId: number) => Promise<void>;
  onVerifyPayment: (paymentId: number) => Promise<void>;
  onPromiseStatus: (promiseId: number, status: 'kept' | 'missed' | 'cancelled') => Promise<void>;
  onDisputeStatus: (disputeId: number, status: 'reviewing' | 'resolved' | 'rejected' | 'withdrawn') => Promise<void>;
  onReleaseHold: (item: CollectionHoldRecord) => Promise<void>;
  onOpenPromise: (record: CollectionOverdueRecord) => void;
  onOpenDispute: (record: CollectionOverdueRecord) => void;
};

const QuickMetric = ({ label, value, tone }: { label: string; value: string; tone: 'rose' | 'amber' | 'blue' }) => {
  const toneClass =
    tone === 'rose'
      ? 'border-rose-100 bg-rose-50 text-rose-600'
      : tone === 'amber'
        ? 'border-amber-100 bg-amber-50 text-amber-700'
        : 'border-blue-100 bg-blue-50 text-blue-600';

  return (
    <div className={`rounded-[22px] border px-4 py-4 ${toneClass}`}>
      <div className="text-xs font-black uppercase tracking-[0.18em] opacity-70">{label}</div>
      <div className="mt-2 text-lg font-black">{value}</div>
    </div>
  );
};

const CollectionActionWorkspace: React.FC<Props> = ({
  selectedOrderId,
  selectedOverdue,
  ledger,
  promises: _promises,
  disputes: _disputes,
  holds: _holds,
  formatPrice,
  permissions,
  syncing,
  batching,
  onSyncOverdue,
  onBatchReminder,
  onReminder,
  onVerifyPayment,
  onPromiseStatus: _onPromiseStatus,
  onDisputeStatus: _onDisputeStatus,
  onReleaseHold: _onReleaseHold,
  onOpenPromise,
  onOpenDispute,
}) => {
  const orderLedger = selectedOrderId
    ? ledger
        .filter((row) => row.orderId === selectedOrderId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    : [];
  const orderSnapshot = orderLedger[0] || null;
  const verifiedAmount = orderLedger.filter((row) => row.status === 'verified').reduce((sum, row) => sum + row.amount, 0);
  const pendingAmount = orderLedger.filter((row) => row.status !== 'verified').reduce((sum, row) => sum + row.amount, 0);
  const finalAmount = selectedOverdue?.finalAmount ?? orderSnapshot?.finalAmount ?? 0;
  const paidAmount = selectedOverdue?.paidAmount ?? orderSnapshot?.paidAmount ?? verifiedAmount;
  const outstandingAmount = selectedOverdue?.outstanding ?? Math.max(0, finalAmount - paidAmount);
  const progress = finalAmount > 0 ? Math.min(100, Math.round((paidAmount / finalAmount) * 100)) : 0;
  const currentCustomerLabel = selectedOverdue
    ? getCollectionCustomerLabel(selectedOverdue)
    : orderSnapshot
      ? getCollectionCustomerLabel(orderSnapshot)
      : '-';
  const currentOrderNo = selectedOverdue?.orderNo || orderSnapshot?.orderNo || '-';
  const currentPaymentStatus = selectedOverdue?.paymentStatus || orderSnapshot?.paymentStatus || 'unpaid';

  return (
    <div className="rounded-[36px] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-blue-500" />
            <p className="text-xs font-bold tracking-[0.16em] text-slate-400">动作工作台</p>
          </div>
          <h3 className="mt-3 text-2xl font-black tracking-tighter text-slate-900 dark:text-white">订单主单 / 回款流水</h3>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-500 dark:text-slate-400">
            订单是主单，收款记录是执行流水。左侧统一查看累计、剩余、待核销和每一笔实际到账。
          </p>
        </div>
      </div>

      {permissions.canSyncOverdue || permissions.canCreateReminder ? (
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {permissions.canSyncOverdue ? (
            <button
              type="button"
              data-testid="collection-workspace-sync-overdue"
              onClick={onSyncOverdue}
              disabled={syncing}
              className="rounded-[22px] bg-slate-900 px-4 py-4 text-left text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <div className="text-xs font-black uppercase tracking-[0.18em] opacity-70">系统动作</div>
              <div className="mt-2 text-sm font-black">{syncing ? '同步中...' : '同步逾期'}</div>
            </button>
          ) : null}
          {permissions.canCreateReminder ? (
            <button
              type="button"
              data-testid="collection-workspace-batch-reminder"
              onClick={onBatchReminder}
              disabled={batching}
              className="rounded-[22px] bg-amber-500 px-4 py-4 text-left text-white transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <div className="text-xs font-black uppercase tracking-[0.18em] opacity-70">系统动作</div>
              <div className="mt-2 text-sm font-black">{batching ? '批量催收中...' : '批量催收'}</div>
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-6 rounded-[28px] border border-slate-100 bg-slate-50/80 p-5 dark:border-slate-800 dark:bg-slate-800/30">
        <div className="flex items-center gap-2">
          <LifeBuoy size={16} className="text-blue-500" />
          <p className="text-xs font-bold tracking-[0.16em] text-slate-400">当前订单对象</p>
        </div>

        {selectedOrderId ? (
          <div className="mt-4 space-y-4">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-lg font-black text-slate-900 dark:text-white">{currentCustomerLabel}</div>
                <span className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-black tracking-[0.14em] ${paymentBadge(currentPaymentStatus)}`}>
                  {currentPaymentStatus}
                </span>
              </div>
              <div className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                订单 {currentOrderNo}
                {selectedOverdue ? ` · 到期 ${formatDate(selectedOverdue.dueDate)} · 最近提醒 ${getElapsedDays(selectedOverdue.lastReminderAt)}` : ' · 当前来自收款台账焦点'}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <QuickMetric label="订单总额" value={formatPrice(finalAmount)} tone="blue" />
              <QuickMetric label="累计已收" value={formatPrice(paidAmount)} tone="amber" />
              <QuickMetric label="剩余未收" value={formatPrice(outstandingAmount)} tone="rose" />
            </div>

            <div className="rounded-[22px] border border-slate-100 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-900/60">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-black tracking-[0.16em] text-slate-400">
                  <ShieldAlert size={14} className="text-rose-500" />
                  订单进度
                </div>
                <div className="text-xs font-black text-slate-500 dark:text-slate-400">{progress}%</div>
              </div>
              <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
 <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-150 motion-reduce:transition-none" style={{ width: `${progress}%` }} />
              </div>
              <div className="mt-3 grid gap-2 text-sm font-bold text-slate-700 dark:text-slate-200 md:grid-cols-2">
                <div>已核销到帐：{formatPrice(verifiedAmount)}</div>
                <div>待核销流水：{formatPrice(pendingAmount)}</div>
              </div>
            </div>

            {selectedOverdue ? (
              <>
                <div className="rounded-[22px] border border-slate-100 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-900/60">
                  <div className="flex items-center gap-2 text-xs font-black tracking-[0.16em] text-slate-400">
                    <ShieldAlert size={14} className="text-rose-500" />
                    拦截建议
                  </div>
                  <div className="mt-3 text-sm font-bold text-slate-700 dark:text-slate-200">
                    {selectedOverdue.holdRecommended ? getHoldStrategy('order-shipment') : '当前无需升级为拦截，优先保留提醒与承诺动作。'}
                  </div>
                </div>

                {permissions.canCreateReminder || permissions.canManagePromise || permissions.canManageDispute ? (
                  <div className="grid gap-3 md:grid-cols-3">
                    {permissions.canCreateReminder ? (
                      <button
                        type="button"
                        data-testid={`collection-workspace-reminder-${selectedOverdue.orderId}`}
                        onClick={() => onReminder(selectedOverdue.orderId)}
                        className="rounded-[20px] bg-blue-600 px-4 py-4 text-sm font-black text-white shadow-sm transition hover:bg-blue-700"
                      >
                        <BellRing size={16} className="mb-2" />
                        催收提醒
                      </button>
                    ) : null}
                    {permissions.canManagePromise ? (
                      <button
                        type="button"
                        data-testid={`collection-workspace-promise-${selectedOverdue.orderId}`}
                        onClick={() => onOpenPromise(selectedOverdue)}
                        className="rounded-[20px] bg-amber-500 px-4 py-4 text-sm font-black text-white shadow-sm transition hover:bg-amber-400"
                      >
                        <Sparkles size={16} className="mb-2" />
                        承诺付款
                      </button>
                    ) : null}
                    {permissions.canManageDispute ? (
                      <button
                        type="button"
                        data-testid={`collection-workspace-dispute-${selectedOverdue.orderId}`}
                        onClick={() => onOpenDispute(selectedOverdue)}
                        className="rounded-[20px] bg-rose-500 px-4 py-4 text-sm font-black text-white shadow-sm transition hover:bg-rose-400"
                      >
                        <FileWarning size={16} className="mb-2" />
                        发起争议
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-[20px] border border-dashed border-slate-200 px-4 py-4 text-sm font-bold text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    当前角色只能查看回款信息，没有催收、承诺或争议动作权限。
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-[20px] border border-dashed border-slate-200 px-4 py-4 text-sm font-bold text-slate-500 dark:border-slate-700 dark:text-slate-400">
                当前焦点来自收款台账。若要发起催收、承诺或争议，请切换到一条逾期订单。
              </div>
            )}

            <div className="rounded-[24px] border border-slate-100 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-900/60">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-black tracking-[0.16em] text-slate-400">回款执行流水</div>
                <div className="text-xs font-bold text-slate-500 dark:text-slate-400">{orderLedger.length} 条记录</div>
              </div>
              <div className="mt-4 space-y-3">
                {orderLedger.length ? orderLedger.map((record) => (
                  <div key={record.id} className="rounded-[18px] border border-slate-100 bg-slate-50/80 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/30">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-black text-slate-900 dark:text-white">{formatPrice(record.amount)}</div>
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-black tracking-[0.14em] ${paymentBadge(record.status)}`}>
                            {record.status}
                          </span>
                        </div>
                        <div className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
                          {record.method} · {formatDateTime(record.createdAt)} · {record.payerName || '未填写付款方'}
                        </div>
                        {record.note ? <div className="mt-1 text-xs font-bold text-slate-400 dark:text-slate-500">{record.note}</div> : null}
                      </div>
                      {record.status !== 'verified' && permissions.canVerifyPayment ? (
                        <button
                          type="button"
                          data-testid={`collection-workspace-verify-${record.id}`}
                          onClick={() => void onVerifyPayment(record.id)}
                          className="rounded-full bg-emerald-50 px-3 py-2 text-xs font-black tracking-[0.12em] text-emerald-700"
                        >
                          核销该笔
                        </button>
                      ) : null}
                    </div>
                  </div>
                )) : (
                  <div className="rounded-[18px] border border-dashed border-slate-200 px-4 py-5 text-sm font-bold text-slate-400 dark:border-slate-700">
                    当前订单还没有回款流水。
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-[24px] border border-dashed border-slate-200 px-4 py-6 text-sm font-bold text-slate-400 dark:border-slate-700">
            当前还没有可操作的订单对象。
          </div>
        )}
      </div>
    </div>
  );
};

export default CollectionActionWorkspace;
