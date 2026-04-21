import React, { useMemo } from 'react';
import { BellRing, CheckCircle2, Sparkles } from 'lucide-react';
import type { Column } from '../../components/DataTable';
import { adaptDataTableColumns, EnterpriseDataGrid } from '../../components/ui';
import CollectionActionModal from '../../components/collections/CollectionActionModal';
import CollectionActionWorkspace from './CollectionActionWorkspace';
import CollectionCurrentOrderDetail from './CollectionCurrentOrderDetail';
import CollectionPrimaryGrid from './CollectionPrimaryGrid';
import {
  CollectionDisputeRecord,
  CollectionHoldRecord,
  CollectionLedgerRecord,
  CollectionMilestoneRecord,
  CollectionOverdueRecord,
  CollectionPromiseRecord,
} from '../../services/collections.service';
import {
  exportRows,
  formatDateTime,
  getCollectionCustomerLabel,
  getPromiseTiming,
} from './collectionCenter.helpers';
import useCollectionCenterState, {
  DisputeFilter,
  HoldFilter,
  HoldScopeFilter,
  PromiseFilter,
  PromiseSort,
} from './useCollectionCenter';

const filterChipClass = 'rounded-full border px-3 py-2 text-xs font-bold tracking-[0.12em] transition-all';
const sortChipClass = 'rounded-full border px-3 py-2 text-xs font-bold tracking-[0.12em] transition-all';

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

const ledgerStatusLabelMap: Record<string, string> = {
  verified: '已核销',
  pending: '待核销',
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

const riskLevelLabelMap: Record<string, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
  critical: '关键风险',
};

const holdStatusLabel = (active: boolean) => (active ? '生效中' : '已释放');

const Metric = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div className="rounded-[24px] border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
    <p className="text-xs font-bold tracking-[0.12em] text-slate-400">{label}</p>
    <p className="mt-3 text-2xl font-black text-slate-900 dark:text-white">{value}</p>
    {hint ? <p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">{hint}</p> : null}
  </div>
);

const CollectionCenterView: React.FC = () => {
  const state = useCollectionCenterState();
  const metricsLoading = state.loading && !state.summary;

  const ledgerColumns = useMemo<Column<CollectionLedgerRecord>[]>(() => [
    { header: '收款单', key: 'id', accessor: (row) => `#${row.id}` },
    { header: '订单号', key: 'orderNo', accessor: 'orderNo' },
    { header: '客户', key: 'customer', accessor: (row) => getCollectionCustomerLabel(row) },
    { header: '金额', key: 'amount', accessor: (row) => state.formatPrice(row.amount) },
    { header: '方式', key: 'method', accessor: 'method' },
    { header: '状态', key: 'status', accessor: (row) => ledgerStatusLabelMap[row.status] || row.status },
    { header: '录入时间', key: 'createdAt', accessor: (row) => formatDateTime(row.createdAt) },
  ], [state]);

  const overdueColumns = useMemo<Column<CollectionOverdueRecord>[]>(() => [
    { header: '订单号', key: 'orderNo', accessor: 'orderNo' },
    { header: '客户', key: 'customer', accessor: (row) => getCollectionCustomerLabel(row) },
    { header: '逾期天数', key: 'daysOverdue', accessor: (row) => `${row.daysOverdue} 天` },
    { header: '未收金额', key: 'outstanding', accessor: (row) => state.formatPrice(row.outstanding) },
    { header: '风险', key: 'riskLevel', accessor: (row) => riskLevelLabelMap[row.riskLevel] || row.riskLevel },
    { header: '下一动作', key: 'nextAction', accessor: 'nextAction' },
  ], [state]);

  const milestoneColumns = useMemo<Column<CollectionMilestoneRecord>[]>(() => [
    { header: '里程碑', key: 'title', accessor: 'title' },
    { header: '合同号', key: 'contractNo', accessor: 'contractNo' },
    { header: '客户', key: 'customer', accessor: (row) => getCollectionCustomerLabel(row) },
    { header: '目标金额', key: 'targetAmount', accessor: (row) => state.formatPrice(row.targetAmount) },
    { header: '已收金额', key: 'paidAmount', accessor: (row) => state.formatPrice(row.paidAmount) },
    { header: '剩余金额', key: 'remainingAmount', accessor: (row) => state.formatPrice(row.remainingAmount) },
  ], [state]);

  const promiseColumns = useMemo<Column<CollectionPromiseRecord>[]>(() => [
    { header: '承诺单', key: 'promiseNo', accessor: 'promiseNo' },
    { header: '客户', key: 'customer', accessor: (row) => getCollectionCustomerLabel(row) },
    { header: '订单号', key: 'orderNo', accessor: 'orderNo' },
    { header: '承诺金额', key: 'promisedAmount', accessor: (row) => state.formatPrice(row.promisedAmount) },
    { header: '承诺时间', key: 'promisedAt', accessor: (row) => formatDateTime(row.promisedAt) },
    { header: '时效', key: 'timing', accessor: (row) => getPromiseTiming(row.promisedAt) },
    { header: '状态', key: 'status', accessor: (row) => promiseStatusLabelMap[row.status] || row.status },
  ], [state]);

  const disputeColumns = useMemo<Column<CollectionDisputeRecord>[]>(() => [
    { header: '争议单', key: 'disputeNo', accessor: 'disputeNo' },
    { header: '客户', key: 'customer', accessor: (row) => getCollectionCustomerLabel(row) },
    { header: '订单号', key: 'orderNo', accessor: 'orderNo' },
    { header: '争议金额', key: 'disputedAmount', accessor: (row) => row.disputedAmount === null ? '-' : state.formatPrice(row.disputedAmount) },
    { header: '原因', key: 'reason', accessor: 'reason' },
    { header: '状态', key: 'status', accessor: (row) => disputeStatusLabelMap[row.status] || row.status },
  ], [state]);

  const holdColumns = useMemo<Column<CollectionHoldRecord>[]>(() => [
    { header: '范围', key: 'scope', accessor: (row) => holdScopeLabelMap[row.scope] || row.scope },
    { header: '客户', key: 'customer', accessor: (row) => getCollectionCustomerLabel(row) },
    { header: '订单号', key: 'orderNo', accessor: (row) => row.orderNo || '-' },
    { header: '原因', key: 'reason', accessor: (row) => row.reason || '-' },
    { header: '来源', key: 'source', accessor: (row) => row.source ? (holdSourceLabelMap[row.source] || row.source) : '-' },
    { header: '状态', key: 'status', accessor: (row) => holdStatusLabel(row.status) },
  ], []);

  const exportPromises = () => exportRows('回款中心_承诺付款执行表.xlsx', state.sortedPromises.map((row) => ({
    承诺单: row.promiseNo,
    客户: getCollectionCustomerLabel(row),
    订单号: row.orderNo,
    承诺金额: row.promisedAmount,
    承诺时间: formatDateTime(row.promisedAt),
    状态: promiseStatusLabelMap[row.status] || row.status,
  })));

  const exportDisputes = () => exportRows('回款中心_争议处理表.xlsx', state.sortedDisputes.map((row) => ({
    争议单: row.disputeNo,
    客户: getCollectionCustomerLabel(row),
    订单号: row.orderNo,
    争议金额: row.disputedAmount ?? '',
    原因: row.reason,
    状态: disputeStatusLabelMap[row.status] || row.status,
  })));

  const exportHolds = () => exportRows('回款中心_追款拦截表.xlsx', state.sortedHolds.map((row) => ({
    范围: holdScopeLabelMap[row.scope] || row.scope,
    客户: getCollectionCustomerLabel(row),
    订单号: row.orderNo || '',
    原因: row.reason || '',
    来源: row.source ? (holdSourceLabelMap[row.source] || row.source) : '',
    状态: holdStatusLabel(row.status),
  })));

  return (
    <div className="space-y-8">
      <div className="rounded-[36px] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles size={18} className="text-blue-500" />
              <p className="text-xs font-bold tracking-[0.16em] text-slate-400">应收治理中心</p>
            </div>
            <h2 className="mt-3 text-3xl font-black tracking-tighter text-slate-900 dark:text-white">回款工作台</h2>
            <p className="mt-2 text-sm font-bold leading-6 text-slate-500 dark:text-slate-400">
              账龄、核销、承诺、争议、拦截统一在一个工作台处理，但动作区、详情区和全局台账保持分层。
            </p>
          </div>
          {state.permissions.canSyncOverdue || state.permissions.canCreateReminder ? (
            <div className="flex flex-wrap gap-3">
              {state.permissions.canSyncOverdue ? (
                <button type="button" onClick={state.handleSyncOverdue} className="rounded-full bg-slate-900 px-4 py-3 text-xs font-bold tracking-[0.12em] text-white">
                  {state.syncing ? '同步中...' : '同步逾期'}
                </button>
              ) : null}
              {state.permissions.canCreateReminder ? (
                <button type="button" onClick={state.handleBatchReminder} className="rounded-full bg-amber-500 px-4 py-3 text-xs font-bold tracking-[0.12em] text-white">
                  {state.batching ? '批量催收中...' : '批量催收'}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="总应收"
          value={metricsLoading ? '加载中...' : state.formatPrice(state.summary?.totalReceivable ?? 0)}
          hint={metricsLoading ? '正在获取应收数据' : `订单 ${state.summary?.totalOrders ?? 0} 笔`}
        />
        <Metric
          label="逾期金额"
          value={metricsLoading ? '加载中...' : state.formatPrice(state.summary?.overdueAmount ?? 0)}
          hint={metricsLoading ? '正在获取逾期数据' : `${state.summary?.overdueCount ?? 0} 笔逾期`}
        />
        <Metric
          label="承诺付款"
          value={metricsLoading ? '加载中...' : `${state.summary?.openPromiseCount ?? 0} 笔`}
          hint={metricsLoading ? '正在获取承诺数据' : `承诺金额 ${state.formatPrice(state.summary?.openPromiseAmount ?? 0)}`}
        />
        <Metric
          label="信用拦截"
          value={metricsLoading ? '加载中...' : `${state.summary?.creditHoldCustomerCount ?? 0} 客户`}
          hint={metricsLoading ? '正在获取拦截数据' : `发货拦截 ${state.summary?.shipmentHoldOrderCount ?? 0} 笔`}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[360px,minmax(0,1fr)]">
        <CollectionActionWorkspace
          selectedOrderId={state.selectedOrderId}
          selectedOverdue={state.selectedOverdue}
          ledger={state.ledger}
          formatPrice={state.formatPrice}
          permissions={state.permissions}
          syncing={state.syncing}
          batching={state.batching}
          onSyncOverdue={state.handleSyncOverdue}
          onBatchReminder={state.handleBatchReminder}
          onReminder={state.handleReminder}
          onVerifyPayment={state.handleVerifyPayment}
          onPromiseStatus={state.handlePromiseStatus}
          onDisputeStatus={state.handleDisputeStatus}
          onReleaseHold={state.handleReleaseHold}
          promises={state.promises}
          disputes={state.disputes}
          holds={state.holds}
          onOpenPromise={(record) => state.openActionModal('promise', record)}
          onOpenDispute={(record) => state.openActionModal('dispute', record)}
        />
        <CollectionPrimaryGrid
          activeTab={state.activeTab}
          setActiveTab={state.setActiveTab}
          selectedOrderId={state.selectedOrderId}
          overdueColumns={overdueColumns}
          ledgerColumns={ledgerColumns}
          milestoneColumns={milestoneColumns}
          sortedOverdue={state.sortedOverdue}
          sortedLedger={state.sortedLedger}
          sortedMilestones={state.sortedMilestones}
          selectedOverdue={state.selectedOverdue}
          onSelectOverdue={(record) => {
            state.setSelectedOverdue(record);
            state.focusOrderById(record.orderId);
          }}
          onFocusOrder={state.focusOrderById}
          onVerifyPayment={state.handleVerifyPayment}
          onReminder={state.handleReminder}
          onOpenPromise={(record) => state.openActionModal('promise', record)}
          onOpenDispute={(record) => state.openActionModal('dispute', record)}
          permissions={state.permissions}
        />
      </div>

      <CollectionCurrentOrderDetail
        selectedOrderId={state.selectedOrderId}
        ledger={state.ledger}
        promises={state.promises}
        disputes={state.disputes}
        holds={state.holds}
        milestones={state.milestones}
        formatPrice={state.formatPrice}
        onVerifyPayment={state.handleVerifyPayment}
        onPromiseStatus={state.handlePromiseStatus}
        onDisputeStatus={state.handleDisputeStatus}
        onReleaseHold={state.handleReleaseHold}
        permissions={state.permissions}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-[36px] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 xl:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold tracking-[0.16em] text-slate-400">异常处理</p>
              <h3 className="mt-2 text-2xl font-black tracking-tighter text-slate-900 dark:text-white">承诺付款执行表</h3>
            </div>
            <button type="button" onClick={exportPromises} className="rounded-full border border-slate-200 px-4 py-2 text-xs font-bold tracking-[0.12em] text-slate-600">
              导出承诺表
            </button>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            {[
              { id: 'all' as PromiseFilter, label: '全部' },
              { id: 'open' as PromiseFilter, label: '待兑现' },
              { id: 'kept' as PromiseFilter, label: '已兑现' },
              { id: 'missed' as PromiseFilter, label: '已失约' },
              { id: 'cancelled' as PromiseFilter, label: '已取消' },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => state.setPromiseFilter(item.id)}
                className={`${filterChipClass} ${state.promiseFilter === item.id ? 'border-amber-500 bg-amber-500 text-white' : 'border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-300'}`}
              >
                {item.label}
              </button>
            ))}
            {[
              { id: 'promised_at_asc' as PromiseSort, label: '最早承诺' },
              { id: 'promised_at_desc' as PromiseSort, label: '最新承诺' },
              { id: 'amount_desc' as PromiseSort, label: '金额降序' },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => state.setPromiseSort(item.id)}
                className={`${sortChipClass} ${state.promiseSort === item.id ? 'border-blue-500 bg-blue-500 text-white' : 'border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-300'}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="mt-4 text-xs font-bold tracking-[0.12em] text-slate-400">
            当前 {state.filteredPromises.length} 条 · 承诺金额 {state.formatPrice(state.filteredPromises.reduce((sum, row) => sum + row.promisedAmount, 0))}
          </div>
          <div className="mt-5">
            <EnterpriseDataGrid<CollectionPromiseRecord>
              title="承诺付款明细"
              description="承诺付款只是沟通承诺，不替代实际核销。"
              columns={adaptDataTableColumns(promiseColumns, {
                promiseNo: '150px',
                customer: '180px',
                orderNo: '160px',
                promisedAmount: '140px',
                promisedAt: '170px',
                timing: '120px',
                status: '120px',
              })}
              data={state.sortedPromises}
              rowKey={(row) => String(row.id)}
              defaultPageSize={8}
              emptyTitle="暂无承诺付款"
              onRowClick={(row) => state.focusOrderById(row.orderId)}
              rowActions={(row) => (
                row.status === 'open' && state.permissions.canManagePromise ? (
                  <div className="flex flex-wrap justify-end gap-2">
                    <button type="button" onClick={(event) => { event.stopPropagation(); void state.handlePromiseStatus(row.id, 'kept'); }} className="rounded-full bg-emerald-50 px-3 py-2 text-xs font-bold tracking-[0.12em] text-emerald-700">已兑现</button>
                    <button type="button" onClick={(event) => { event.stopPropagation(); void state.handlePromiseStatus(row.id, 'missed'); }} className="rounded-full bg-rose-50 px-3 py-2 text-xs font-bold tracking-[0.12em] text-rose-700">已失约</button>
                    <button type="button" onClick={(event) => { event.stopPropagation(); void state.handlePromiseStatus(row.id, 'cancelled'); }} className="rounded-full bg-slate-100 px-3 py-2 text-xs font-bold tracking-[0.12em] text-slate-700">已取消</button>
                  </div>
                ) : null
              )}
            />
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-[36px] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold tracking-[0.16em] text-slate-400">异常处理</p>
                <h3 className="mt-2 text-2xl font-black tracking-tighter text-slate-900 dark:text-white">争议处理表</h3>
              </div>
              <button type="button" onClick={exportDisputes} className="rounded-full border border-slate-200 px-4 py-2 text-xs font-bold tracking-[0.12em] text-slate-600">
                导出争议表
              </button>
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              {[
                { id: 'all' as DisputeFilter, label: '全部' },
                { id: 'active' as DisputeFilter, label: '处理中' },
                { id: 'resolved' as DisputeFilter, label: '已解决' },
                { id: 'rejected' as DisputeFilter, label: '已驳回' },
                { id: 'withdrawn' as DisputeFilter, label: '已撤回' },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => state.setDisputeFilter(item.id)}
                  className={`${filterChipClass} ${state.disputeFilter === item.id ? 'border-rose-500 bg-rose-500 text-white' : 'border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-300'}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="mt-4 text-xs font-bold tracking-[0.12em] text-slate-400">
              当前 {state.filteredDisputes.length} 条 · 争议金额 {state.formatPrice(state.filteredDisputes.reduce((sum, row) => sum + (row.disputedAmount || 0), 0))}
            </div>
            <div className="mt-5">
              <EnterpriseDataGrid<CollectionDisputeRecord>
                title="争议处理明细"
                description="争议记录用于追踪异常，不直接改写应收账。"
                columns={adaptDataTableColumns(disputeColumns, {
                  disputeNo: '150px',
                  customer: '180px',
                  orderNo: '150px',
                  disputedAmount: '130px',
                  reason: '220px',
                  status: '120px',
                })}
                data={state.sortedDisputes}
                rowKey={(row) => String(row.id)}
                defaultPageSize={8}
                emptyTitle="暂无争议记录"
                onRowClick={(row) => state.focusOrderById(row.orderId)}
              rowActions={(row) => (
                  (row.status === 'open' || row.status === 'reviewing') && state.permissions.canManageDispute ? (
                    <div className="flex flex-wrap justify-end gap-2">
                      {row.status === 'open' ? (
                        <button type="button" onClick={(event) => { event.stopPropagation(); void state.handleDisputeStatus(row.id, 'reviewing'); }} className="rounded-full bg-amber-50 px-3 py-2 text-xs font-bold tracking-[0.12em] text-amber-700">处理中</button>
                      ) : null}
                      <button type="button" onClick={(event) => { event.stopPropagation(); void state.handleDisputeStatus(row.id, 'resolved'); }} className="rounded-full bg-emerald-50 px-3 py-2 text-xs font-bold tracking-[0.12em] text-emerald-700">已解决</button>
                      <button type="button" onClick={(event) => { event.stopPropagation(); void state.handleDisputeStatus(row.id, 'rejected'); }} className="rounded-full bg-slate-100 px-3 py-2 text-xs font-bold tracking-[0.12em] text-slate-700">已驳回</button>
                      <button type="button" onClick={(event) => { event.stopPropagation(); void state.handleDisputeStatus(row.id, 'withdrawn'); }} className="rounded-full bg-slate-100 px-3 py-2 text-xs font-bold tracking-[0.12em] text-slate-700">已撤回</button>
                    </div>
                  ) : null
                )}
              />
            </div>
          </div>

          <div className="rounded-[36px] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold tracking-[0.16em] text-slate-400">系统状态</p>
                <h3 className="mt-2 text-2xl font-black tracking-tighter text-slate-900 dark:text-white">追款拦截表</h3>
              </div>
              <button type="button" onClick={exportHolds} className="rounded-full border border-slate-200 px-4 py-2 text-xs font-bold tracking-[0.12em] text-slate-600">
                导出拦截表
              </button>
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              {[
                { id: 'active' as HoldFilter, label: '仅生效中' },
                { id: 'released' as HoldFilter, label: '已释放' },
                { id: 'all' as HoldFilter, label: '全部状态' },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => state.setHoldFilter(item.id)}
                  className={`${filterChipClass} ${state.holdFilter === item.id ? 'border-rose-500 bg-rose-500 text-white' : 'border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-300'}`}
                >
                  {item.label}
                </button>
              ))}
              {[
                { id: 'all' as HoldScopeFilter, label: '全部范围' },
                { id: 'customer-credit' as HoldScopeFilter, label: '客户授信' },
                { id: 'customer-shipment' as HoldScopeFilter, label: '客户发货' },
                { id: 'order-shipment' as HoldScopeFilter, label: '订单发货' },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => state.setHoldScopeFilter(item.id)}
                  className={`${filterChipClass} ${state.holdScopeFilter === item.id ? 'border-blue-500 bg-blue-500 text-white' : 'border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-300'}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="mt-4 text-xs font-bold tracking-[0.12em] text-slate-400">
              当前 {state.filteredHolds.length} 条 · 生效 {state.filteredHolds.filter((row) => row.status).length} 条
            </div>
            <div className="mt-5">
              <EnterpriseDataGrid<CollectionHoldRecord>
                title="追款拦截明细"
                description="拦截状态只在释放后关闭，保留来源与原因。"
                columns={adaptDataTableColumns(holdColumns, {
                  scope: '130px',
                  customer: '180px',
                  orderNo: '150px',
                  reason: '220px',
                  source: '130px',
                  status: '120px',
                })}
                data={state.sortedHolds}
                rowKey={(row) => `${row.scope}-${row.id}`}
                defaultPageSize={8}
                emptyTitle="暂无追款拦截"
                onRowClick={(row) => {
                  if (row.orderId) state.focusOrderById(row.orderId);
                }}
                rowActions={(row) => (
                  row.status && state.permissions.canManageHold ? (
                    <button type="button" onClick={(event) => { event.stopPropagation(); void state.handleReleaseHold(row); }} className="rounded-full bg-slate-100 px-3 py-2 text-xs font-bold tracking-[0.12em] text-slate-700">
                      释放
                    </button>
                  ) : null
                )}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-[36px] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold tracking-[0.16em] text-slate-400">运行信息</p>
              <h3 className="mt-2 text-xl font-black tracking-tighter text-slate-900 dark:text-white">收款动作</h3>
            </div>
            <CheckCircle2 className="text-emerald-500" size={22} />
          </div>
          <div className="mt-5 space-y-3 text-sm font-bold text-slate-500 dark:text-slate-400">
            <div className="rounded-[22px] border border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40">
              当前共 {state.summary?.paidCount ?? 0} 笔已收、{state.summary?.partialCount ?? 0} 笔部分回款、{state.summary?.unpaidCount ?? 0} 笔未回款。
            </div>
            <div className="rounded-[22px] border border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40">
              最近收款和待核销会在台账页直接处理，避免在多个页面重复录入。
            </div>
          </div>
        </div>
        <div className="rounded-[36px] border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold tracking-[0.16em] text-slate-400">运行信息</p>
              <h3 className="mt-2 text-xl font-black tracking-tighter text-slate-900 dark:text-white">追款原则</h3>
            </div>
            <BellRing className="text-blue-500" size={22} />
          </div>
          <div className="mt-5 space-y-3 text-sm font-bold leading-6 text-slate-500 dark:text-slate-400">
            <div className="rounded-[22px] border border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40">
              承诺付款和争议只记录异常沟通，不替代实际核销和过账。
            </div>
            <div className="rounded-[22px] border border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40">
              逾期金额、承诺时点、提醒次数和拦截状态必须保持可追溯。
            </div>
          </div>
        </div>
      </div>

      <CollectionActionModal
        open={Boolean(state.actionMode && state.actionTarget)}
        mode={state.actionMode}
        target={state.actionTarget}
        onClose={() => {
          state.setActionMode(null);
          state.setActionTarget(null);
        }}
        onSubmitted={async () => {
          await state.loadData({ force: true });
          state.setActionMode(null);
          state.setActionTarget(null);
        }}
      />
    </div>
  );
};

export default CollectionCenterView;
