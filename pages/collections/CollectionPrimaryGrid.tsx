import React from 'react';
import type { Column } from '../../components/DataTable';
import { adaptDataTableColumns, EnterpriseDataGrid } from '../../components/ui';
import type { CollectionLedgerRecord, CollectionMilestoneRecord, CollectionOverdueRecord } from '../../services/collections.service';
import type { CollectionActionPermissions, WorkTab } from './useCollectionCenter';
import { getCollectionCustomerLabel } from './collectionCenter.helpers';

type Props = {
  activeTab: WorkTab;
  setActiveTab: (tab: WorkTab) => void;
  selectedOrderId: number | null;
  overdueColumns: Column<CollectionOverdueRecord>[];
  ledgerColumns: Column<CollectionLedgerRecord>[];
  milestoneColumns: Column<CollectionMilestoneRecord>[];
  sortedOverdue: CollectionOverdueRecord[];
  sortedLedger: CollectionLedgerRecord[];
  sortedMilestones: CollectionMilestoneRecord[];
  selectedOverdue: CollectionOverdueRecord | null;
  onSelectOverdue: (row: CollectionOverdueRecord) => void;
  onFocusOrder: (orderId: number) => void;
  onVerifyPayment: (paymentId: number) => Promise<void>;
  onReminder: (orderId: number) => Promise<void>;
  onOpenPromise: (row: CollectionOverdueRecord) => void;
  onOpenDispute: (row: CollectionOverdueRecord) => void;
  permissions: CollectionActionPermissions;
};

const tabs: Array<{ id: WorkTab; label: string; hint: string }> = [
  { id: 'overdue', label: '逾期清单', hint: '动作前先选对象' },
  { id: 'ledger', label: '收款台账', hint: '核销与到账视图' },
  { id: 'milestones', label: '合同节点', hint: '合同回款轴' },
];

const CollectionPrimaryGrid: React.FC<Props> = ({
  activeTab,
  setActiveTab,
  selectedOrderId,
  overdueColumns,
  ledgerColumns,
  milestoneColumns,
  sortedOverdue,
  sortedLedger,
  sortedMilestones,
  selectedOverdue,
  onSelectOverdue,
  onFocusOrder,
  onVerifyPayment,
  onReminder,
  onOpenPromise,
  onOpenDispute,
  permissions,
}) => {
  const overdueEnterpriseColumns = adaptDataTableColumns(overdueColumns);
  const ledgerEnterpriseColumns = adaptDataTableColumns(ledgerColumns);
  const milestoneEnterpriseColumns = adaptDataTableColumns(milestoneColumns);

  const renderMain = () => {
    if (activeTab === 'ledger') {
      return (
        <EnterpriseDataGrid<CollectionLedgerRecord>
          title="收款台账"
          description="点击流水可同步到左侧订单工作区"
          columns={ledgerEnterpriseColumns}
          data={sortedLedger}
          rowKey={(row) => String(row.id)}
          getRowTestId={(row) => `collection-ledger-row-${row.id}`}
          onRowClick={(row) => onFocusOrder(row.orderId)}
          emptyTitle="暂无收款流水"
          emptyDescription="当订单产生回款记录后，会在这里进行核销和对账。"
          rowActions={(row) =>
            row.status !== 'verified' && permissions.canVerifyPayment ? (
              <button
                type="button"
                data-testid={`collection-ledger-verify-${row.id}`}
                onClick={(event) => {
                  event.stopPropagation();
                  void onVerifyPayment(row.id);
                }}
                className="rounded-full bg-emerald-50 px-3 py-2 text-xs font-bold tracking-[0.12em] text-emerald-700"
              >
                核销
              </button>
            ) : null
          }
          defaultPageSize={10}
        />
      );
    }

    if (activeTab === 'milestones') {
      return (
        <EnterpriseDataGrid<CollectionMilestoneRecord>
          title="合同回款节点"
          description="按合同节点查看目标金额、已收金额和剩余金额"
          columns={milestoneEnterpriseColumns}
          data={sortedMilestones}
          rowKey={(row) => String(row.id)}
          getRowTestId={(row) => `collection-milestone-row-${row.id}`}
          emptyTitle="暂无合同回款节点"
          emptyDescription="有关联合同后会自动形成回款节点视图。"
          defaultPageSize={10}
        />
      );
    }

    return (
      <EnterpriseDataGrid<CollectionOverdueRecord>
        title="逾期清单"
        description="先选中逾期订单，再执行催收、承诺付款或争议动作"
        columns={overdueEnterpriseColumns}
        data={sortedOverdue}
        rowKey={(row) => String(row.orderId)}
        getRowTestId={(row) => `collection-overdue-row-${row.orderId}`}
        onRowClick={onSelectOverdue}
        rowClassName={(row) => selectedOverdue?.orderId === row.orderId ? 'bg-blue-50/80 dark:bg-blue-950/20' : ''}
        emptyTitle="暂无逾期订单"
        emptyDescription="当前没有需要催收的逾期记录。"
        rowActions={(row) => {
          if (!permissions.canCreateReminder && !permissions.canManagePromise && !permissions.canManageDispute) return null;
          return (
            <div className="flex flex-wrap gap-2">
              {permissions.canCreateReminder ? (
                <button
                  type="button"
                  data-testid={`collection-overdue-reminder-${row.orderId}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectOverdue(row);
                    void onReminder(row.orderId);
                  }}
                  className="rounded-full bg-blue-50 px-3 py-2 text-xs font-bold tracking-[0.12em] text-blue-700"
                >
                  催收提醒
                </button>
              ) : null}
              {permissions.canManagePromise ? (
                <button
                  type="button"
                  data-testid={`collection-overdue-promise-${row.orderId}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectOverdue(row);
                    onOpenPromise(row);
                  }}
                  className="rounded-full bg-amber-50 px-3 py-2 text-xs font-bold tracking-[0.12em] text-amber-700"
                >
                  承诺付款
                </button>
              ) : null}
              {permissions.canManageDispute ? (
                <button
                  type="button"
                  data-testid={`collection-overdue-dispute-${row.orderId}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectOverdue(row);
                    onOpenDispute(row);
                  }}
                  className="rounded-full bg-rose-50 px-3 py-2 text-xs font-bold tracking-[0.12em] text-rose-700"
                >
                  发起争议
                </button>
              ) : null}
            </div>
          );
        }}
        defaultPageSize={10}
      />
    );
  };

  return (
    <div className="app-card p-6">
      <div className="flex flex-wrap gap-3">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            data-testid={`collection-tab-${item.id}`}
            onClick={() => setActiveTab(item.id)}
            className={`rounded-[24px] border px-5 py-4 text-left transition ${
              activeTab === item.id
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-100 bg-white text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
            }`}
          >
            <div className="text-sm font-black tracking-[0.12em]">{item.label}</div>
            <div className={`mt-1 text-[11px] font-bold ${activeTab === item.id ? 'text-white/70' : 'text-slate-400'}`}>{item.hint}</div>
          </button>
        ))}
      </div>

      {activeTab === 'overdue' && selectedOverdue ? (
        <div className="mt-4 rounded-[24px] border border-blue-100 bg-blue-50/70 px-4 py-3 text-sm font-bold text-blue-700 dark:border-blue-900/30 dark:bg-blue-950/20 dark:text-blue-200">
          当前动作对象：{getCollectionCustomerLabel(selectedOverdue)} / {selectedOverdue.orderNo}
        </div>
      ) : null}

      {activeTab === 'ledger' && selectedOrderId ? (
        <div className="mt-4 rounded-[24px] border border-emerald-100 bg-emerald-50/70 px-4 py-3 text-sm font-bold text-emerald-700 dark:border-emerald-900/30 dark:bg-emerald-950/20 dark:text-emerald-200">
          当前对账对象：订单 #{selectedOrderId}，点击任意收款记录会同步到左侧订单工作区。
        </div>
      ) : null}

      <div className="mt-4">{renderMain()}</div>
    </div>
  );
};

export default CollectionPrimaryGrid;
