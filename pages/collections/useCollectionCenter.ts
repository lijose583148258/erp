import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useAppContext } from '../../app/AppContext';
import { can } from '../../app/permissions';
import {
  CollectionDisputeRecord,
  CollectionHoldRecord,
  CollectionLedgerRecord,
  CollectionMilestoneRecord,
  CollectionOverdueRecord,
  CollectionPromiseRecord,
  CollectionSummary,
  collectionsService,
} from '../../services/collections.service';
import { CollectionActionMode, CollectionActionTarget } from '../../components/collections/CollectionActionModal';
import { getCollectionCustomerLabel } from './collectionCenter.helpers';
import { requestCollectionLoadBundle, type CollectionLoadOptions } from './collectionLoadBundle';
import { reportClientIssue } from '../../utils/clientIssue';
import { useCollectionCenterDerivedLists } from './useCollectionCenterDerivedLists';

export type WorkTab = 'ledger' | 'overdue' | 'milestones';
export type OverdueBucketFilter = 'all' | '1_15' | '16_30' | '31_plus';
export type RiskFilter = 'all' | 'high_up' | 'critical';
export type PromiseFilter = 'all' | 'open' | 'kept' | 'missed' | 'cancelled';
export type DisputeFilter = 'all' | 'active' | 'resolved' | 'rejected' | 'withdrawn';
export type HoldFilter = 'all' | 'active' | 'released';
export type HoldScopeFilter = 'all' | CollectionHoldRecord['scope'];
export type LedgerSort = 'created_desc' | 'amount_desc' | 'pending_first';
export type MilestoneSort = 'due_asc' | 'remaining_desc' | 'open_first';
export type OverdueSort = 'days_desc' | 'amount_desc' | 'risk_desc' | 'next_action_asc';
export type PromiseSort = 'promised_at_asc' | 'promised_at_desc' | 'amount_desc';
export type DisputeSort = 'active_first' | 'amount_desc' | 'created_desc';
export type HoldSort = 'active_first' | 'updated_desc' | 'scope';

export interface CollectionActionPermissions {
  canSyncOverdue: boolean;
  canCreateReminder: boolean;
  canManagePromise: boolean;
  canManageDispute: boolean;
  canManageHold: boolean;
  canVerifyPayment: boolean;
}

export interface CollectionCenterState {
  formatPrice: (value?: number | null) => string;
  summary: CollectionSummary | null;
  ledger: CollectionLedgerRecord[];
  overdue: CollectionOverdueRecord[];
  milestones: CollectionMilestoneRecord[];
  promises: CollectionPromiseRecord[];
  disputes: CollectionDisputeRecord[];
  holds: CollectionHoldRecord[];
  selectedOrderId: number | null;
  setSelectedOrderId: Dispatch<SetStateAction<number | null>>;
  selectedOverdue: CollectionOverdueRecord | null;
  setSelectedOverdue: Dispatch<SetStateAction<CollectionOverdueRecord | null>>;
  activeTab: WorkTab;
  setActiveTab: Dispatch<SetStateAction<WorkTab>>;
  loading: boolean;
  syncing: boolean;
  batching: boolean;
  actionMode: CollectionActionMode | null;
  actionTarget: CollectionActionTarget | null;
  overdueBucketFilter: OverdueBucketFilter;
  overdueRiskFilter: RiskFilter;
  promiseFilter: PromiseFilter;
  disputeFilter: DisputeFilter;
  holdFilter: HoldFilter;
  holdScopeFilter: HoldScopeFilter;
  ledgerSort: LedgerSort;
  milestoneSort: MilestoneSort;
  overdueSort: OverdueSort;
  promiseSort: PromiseSort;
  disputeSort: DisputeSort;
  holdSort: HoldSort;
  permissions: CollectionActionPermissions;
  filteredOverdue: CollectionOverdueRecord[];
  sortedOverdue: CollectionOverdueRecord[];
  filteredPromises: CollectionPromiseRecord[];
  sortedPromises: CollectionPromiseRecord[];
  filteredDisputes: CollectionDisputeRecord[];
  sortedDisputes: CollectionDisputeRecord[];
  filteredHolds: CollectionHoldRecord[];
  sortedHolds: CollectionHoldRecord[];
  sortedLedger: CollectionLedgerRecord[];
  sortedMilestones: CollectionMilestoneRecord[];
  loadData: (options?: CollectionLoadOptions) => Promise<void>;
  handleSyncOverdue: () => Promise<void>;
  handleVerifyPayment: (paymentId: number) => Promise<void>;
  handleReminder: (orderId: number) => Promise<void>;
  handleBatchReminder: () => Promise<void>;
  focusOrderById: (orderId: number) => void;
  openActionModal: (mode: CollectionActionMode, record: CollectionOverdueRecord) => void;
  handlePromiseStatus: (promiseId: number, status: 'kept' | 'missed' | 'cancelled') => Promise<void>;
  handleDisputeStatus: (disputeId: number, status: 'reviewing' | 'resolved' | 'rejected' | 'withdrawn') => Promise<void>;
  handleReleaseHold: (item: CollectionHoldRecord) => Promise<void>;
  setActionMode: Dispatch<SetStateAction<CollectionActionMode | null>>;
  setActionTarget: Dispatch<SetStateAction<CollectionActionTarget | null>>;
  setOverdueBucketFilter: Dispatch<SetStateAction<OverdueBucketFilter>>;
  setOverdueRiskFilter: Dispatch<SetStateAction<RiskFilter>>;
  setPromiseFilter: Dispatch<SetStateAction<PromiseFilter>>;
  setDisputeFilter: Dispatch<SetStateAction<DisputeFilter>>;
  setHoldFilter: Dispatch<SetStateAction<HoldFilter>>;
  setHoldScopeFilter: Dispatch<SetStateAction<HoldScopeFilter>>;
  setLedgerSort: Dispatch<SetStateAction<LedgerSort>>;
  setMilestoneSort: Dispatch<SetStateAction<MilestoneSort>>;
  setOverdueSort: Dispatch<SetStateAction<OverdueSort>>;
  setPromiseSort: Dispatch<SetStateAction<PromiseSort>>;
  setDisputeSort: Dispatch<SetStateAction<DisputeSort>>;
  setHoldSort: Dispatch<SetStateAction<HoldSort>>;
}

export const useCollectionCenterState = (): CollectionCenterState => {
  const { formatPrice, notify, currentUser } = useAppContext();
  const [summary, setSummary] = useState<CollectionSummary | null>(null);
  const [ledger, setLedger] = useState<CollectionLedgerRecord[]>([]);
  const [overdue, setOverdue] = useState<CollectionOverdueRecord[]>([]);
  const [milestones, setMilestones] = useState<CollectionMilestoneRecord[]>([]);
  const [promises, setPromises] = useState<CollectionPromiseRecord[]>([]);
  const [disputes, setDisputes] = useState<CollectionDisputeRecord[]>([]);
  const [holds, setHolds] = useState<CollectionHoldRecord[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [selectedOverdue, setSelectedOverdue] = useState<CollectionOverdueRecord | null>(null);
  const [activeTab, setActiveTab] = useState<WorkTab>('overdue');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [batching, setBatching] = useState(false);
  const [actionMode, setActionMode] = useState<CollectionActionMode | null>(null);
  const [actionTarget, setActionTarget] = useState<CollectionActionTarget | null>(null);
  const [overdueBucketFilter, setOverdueBucketFilter] = useState<OverdueBucketFilter>('all');
  const [overdueRiskFilter, setOverdueRiskFilter] = useState<RiskFilter>('all');
  const [promiseFilter, setPromiseFilter] = useState<PromiseFilter>('all');
  const [disputeFilter, setDisputeFilter] = useState<DisputeFilter>('all');
  const [holdFilter, setHoldFilter] = useState<HoldFilter>('active');
  const [holdScopeFilter, setHoldScopeFilter] = useState<HoldScopeFilter>('all');
  const [ledgerSort, setLedgerSort] = useState<LedgerSort>('created_desc');
  const [milestoneSort, setMilestoneSort] = useState<MilestoneSort>('due_asc');
  const [overdueSort, setOverdueSort] = useState<OverdueSort>('days_desc');
  const [promiseSort, setPromiseSort] = useState<PromiseSort>('promised_at_asc');
  const [disputeSort, setDisputeSort] = useState<DisputeSort>('active_first');
  const [holdSort, setHoldSort] = useState<HoldSort>('active_first');
  const permissions = useMemo<CollectionActionPermissions>(() => ({
    canSyncOverdue: can(currentUser, 'collections.sync'),
    canCreateReminder: can(currentUser, 'collections.reminder.write'),
    canManagePromise: can(currentUser, 'collections.promise.write'),
    canManageDispute: can(currentUser, 'collections.dispute.write'),
    canManageHold: can(currentUser, 'collections.hold.manage'),
    canVerifyPayment: can(currentUser, 'orders.payment.verify'),
  }), [currentUser]);

  const loadData = useCallback(async (options: CollectionLoadOptions = {}) => {
    setLoading(true);
    try {
      const bundle = await requestCollectionLoadBundle(Boolean(options.force));
      setSummary(bundle.summary);
      setLedger(bundle.ledger);
      setOverdue(bundle.overdue);
      setMilestones(bundle.milestones);
      setPromises(bundle.promises);
      setDisputes(bundle.disputes);
      setHolds(bundle.holds);
      if (bundle.errors.length > 0) {
        notify('warning', `回款中心部分数据加载失败：${bundle.errors.slice(0, 2).join('；')}`);
      }
    } catch (error) {
      reportClientIssue('collections.load', error);
      notify('error', '回款中心加载失败');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const fallbackOrderId = overdue[0]?.orderId ?? ledger[0]?.orderId ?? null;
    if (!overdue.length && !ledger.length) {
      setSelectedOrderId(null);
      setSelectedOverdue(null);
      return;
    }

    setSelectedOrderId((current) => {
      if (current && (overdue.some((row) => row.orderId === current) || ledger.some((row) => row.orderId === current))) {
        return current;
      }
      return fallbackOrderId;
    });
  }, [overdue, ledger]);

  useEffect(() => {
    if (!selectedOrderId) {
      setSelectedOverdue(null);
      return;
    }

    const matched = overdue.find((row) => row.orderId === selectedOrderId) || null;
    setSelectedOverdue(matched);
  }, [selectedOrderId, overdue]);

  const handleSyncOverdue = async () => {
    if (!permissions.canSyncOverdue) {
      notify('warning', '当前角色没有同步逾期权限');
      return;
    }

    setSyncing(true);
    try {
      const updated = await collectionsService.syncOverdue();
      notify('success', `已同步 ${updated} 个客户的逾期金额`);
      await loadData({ force: true });
    } catch (error) {
      reportClientIssue('collections.sync-overdue', error);
      notify('error', '逾期金额同步失败');
    } finally {
      setSyncing(false);
    }
  };

  const handleVerifyPayment = async (paymentId: number) => {
    if (!permissions.canVerifyPayment) {
      notify('warning', '当前角色没有核销回款权限');
      return;
    }

    try {
      await collectionsService.verifyPayment(paymentId);
      notify('success', '收款已核销');
      await loadData({ force: true });
    } catch (error) {
      reportClientIssue('collections.verify-payment', error);
      notify('error', '核销失败');
    }
  };

  const handleReminder = async (orderId: number) => {
    if (!permissions.canCreateReminder) {
      notify('warning', '当前角色没有创建催收提醒权限');
      return;
    }

    try {
      await collectionsService.createReminder(orderId);
      notify('success', '已生成催收提醒');
      await loadData({ force: true });
    } catch (error) {
      reportClientIssue('collections.create-reminder', error);
      notify('error', '催收提醒创建失败');
    }
  };

  const handleBatchReminder = async () => {
    if (!permissions.canCreateReminder) {
      notify('warning', '当前角色没有批量催收权限');
      return;
    }

    const sortedOverdue = overdue.filter((row) => {
      const bucketMatched =
        overdueBucketFilter === 'all'
        || (overdueBucketFilter === '1_15' && row.daysOverdue <= 15)
        || (overdueBucketFilter === '16_30' && row.daysOverdue >= 16 && row.daysOverdue <= 30)
        || (overdueBucketFilter === '31_plus' && row.daysOverdue >= 31);
      const riskMatched =
        overdueRiskFilter === 'all'
        || (overdueRiskFilter === 'high_up' && ['high', 'critical'].includes(row.riskLevel))
        || (overdueRiskFilter === 'critical' && row.riskLevel === 'critical');
      return bucketMatched && riskMatched;
    });

    if (sortedOverdue.length === 0) {
      notify('info', '当前没有可批量催收的逾期订单');
      return;
    }

    setBatching(true);
    try {
      const result = await collectionsService.createBatchReminders(sortedOverdue.map((row) => row.orderId));
      notify('success', `已批量生成 ${result.createdCount} 条提醒，跳过 ${result.skippedCount} 条`);
      await loadData({ force: true });
    } catch (error) {
      reportClientIssue('collections.batch-reminder', error);
      notify('error', '批量催收失败');
    } finally {
      setBatching(false);
    }
  };

  const openActionModal = (mode: CollectionActionMode, record: CollectionOverdueRecord) => {
    if (mode === 'promise' && !permissions.canManagePromise) {
      notify('warning', '当前角色没有管理承诺付款权限');
      return;
    }

    if (mode === 'dispute' && !permissions.canManageDispute) {
      notify('warning', '当前角色没有管理回款争议权限');
      return;
    }

    setSelectedOrderId(record.orderId);
    setActionMode(mode);
    setActionTarget({
      customerId: record.customerId,
      customerName: getCollectionCustomerLabel(record),
      orderId: record.orderId,
      orderNo: record.orderNo,
      outstanding: record.outstanding,
      contactName: record.contactName,
      contactPhone: record.contactPhone,
    });
  };

  const focusOrderById = (orderId: number) => {
    setSelectedOrderId(orderId);
  };

  const handlePromiseStatus = async (promiseId: number, status: 'kept' | 'missed' | 'cancelled') => {
    if (!permissions.canManagePromise) {
      notify('warning', '当前角色没有管理承诺付款权限');
      return;
    }

    try {
      await collectionsService.updatePromiseStatus(promiseId, status);
      notify('success', '承诺状态已更新');
      await loadData({ force: true });
    } catch (error) {
      reportClientIssue('collections.promise-status', error);
      notify('error', '承诺状态更新失败');
    }
  };

  const handleDisputeStatus = async (disputeId: number, status: 'reviewing' | 'resolved' | 'rejected' | 'withdrawn') => {
    if (!permissions.canManageDispute) {
      notify('warning', '当前角色没有管理回款争议权限');
      return;
    }

    try {
      await collectionsService.updateDisputeStatus(disputeId, status);
      notify('success', '争议状态已更新');
      await loadData({ force: true });
    } catch (error) {
      reportClientIssue('collections.dispute-status', error);
      notify('error', '争议状态更新失败');
    }
  };

  const handleReleaseHold = async (item: CollectionHoldRecord) => {
    if (!permissions.canManageHold) {
      notify('warning', '当前角色没有释放拦截权限');
      return;
    }

    try {
      if (item.scope === 'order-shipment' && item.orderId) await collectionsService.releaseOrderShipmentHold(item.orderId);
      else if (item.scope === 'customer-credit') await collectionsService.releaseCustomerHold(item.customerId, 'credit');
      else if (item.scope === 'customer-shipment') await collectionsService.releaseCustomerHold(item.customerId, 'shipment');
      notify('success', '拦截已释放');
      await loadData({ force: true });
    } catch (error) {
      reportClientIssue('collections.release-hold', error);
      notify('error', '释放拦截失败');
    }
  };

  const {
    filteredOverdue,
    sortedOverdue,
    filteredPromises,
    sortedPromises,
    filteredDisputes,
    sortedDisputes,
    filteredHolds,
    sortedHolds,
    sortedLedger,
    sortedMilestones,
  } = useCollectionCenterDerivedLists({
    ledger,
    overdue,
    milestones,
    promises,
    disputes,
    holds,
    overdueBucketFilter,
    overdueRiskFilter,
    promiseFilter,
    disputeFilter,
    holdFilter,
    holdScopeFilter,
    ledgerSort,
    milestoneSort,
    overdueSort,
    promiseSort,
    disputeSort,
    holdSort,
  });

  return {
    formatPrice,
    summary,
    ledger,
    overdue,
    milestones,
    promises,
    disputes,
    holds,
    selectedOrderId,
    setSelectedOrderId,
    selectedOverdue,
    setSelectedOverdue,
    activeTab,
    setActiveTab,
    loading,
    syncing,
    batching,
    actionMode,
    actionTarget,
    overdueBucketFilter,
    overdueRiskFilter,
    promiseFilter,
    disputeFilter,
    holdFilter,
    holdScopeFilter,
    ledgerSort,
    milestoneSort,
    overdueSort,
    promiseSort,
    disputeSort,
    holdSort,
    permissions,
    filteredOverdue,
    sortedOverdue,
    filteredPromises,
    sortedPromises,
    filteredDisputes,
    sortedDisputes,
    filteredHolds,
    sortedHolds,
    sortedLedger,
    sortedMilestones,
    loadData,
    handleSyncOverdue,
    handleVerifyPayment,
    handleReminder,
    handleBatchReminder,
    focusOrderById,
    openActionModal,
    handlePromiseStatus,
    handleDisputeStatus,
    handleReleaseHold,
    setActionMode,
    setActionTarget,
    setOverdueBucketFilter,
    setOverdueRiskFilter,
    setPromiseFilter,
    setDisputeFilter,
    setHoldFilter,
    setHoldScopeFilter,
    setLedgerSort,
    setMilestoneSort,
    setOverdueSort,
    setPromiseSort,
    setDisputeSort,
    setHoldSort,
  };
};

export default useCollectionCenterState;


