import type { Dispatch, SetStateAction } from 'react';
import type { AppContextType } from '../../types';
import {
  CollectionHoldRecord,
  CollectionOverdueRecord,
  collectionsService,
} from '../../src/services/collections.service';
import { CollectionActionMode, CollectionActionTarget } from '../../components/collections/CollectionActionModal';
import { reportClientIssue } from '../../utils/clientIssue';
import { getCollectionCustomerLabel } from './collectionCenter.helpers';
import type {
  CollectionActionPermissions,
  OverdueBucketFilter,
  RiskFilter,
} from './useCollectionCenter';
import type { CollectionLoadOptions } from './collectionLoadBundle';

type Notify = AppContextType['notify'];

interface CollectionCenterActionsInput {
  permissions: CollectionActionPermissions;
  notify: Notify;
  overdue: CollectionOverdueRecord[];
  overdueBucketFilter: OverdueBucketFilter;
  overdueRiskFilter: RiskFilter;
  loadData: (options?: CollectionLoadOptions) => Promise<void>;
  syncing: boolean;
  batching: boolean;
  setSyncing: Dispatch<SetStateAction<boolean>>;
  setBatching: Dispatch<SetStateAction<boolean>>;
  setSelectedOrderId: Dispatch<SetStateAction<number | null>>;
  setActionMode: Dispatch<SetStateAction<CollectionActionMode | null>>;
  setActionTarget: Dispatch<SetStateAction<CollectionActionTarget | null>>;
}

export const useCollectionCenterActions = ({
  permissions,
  notify,
  overdue,
  overdueBucketFilter,
  overdueRiskFilter,
  loadData,
  syncing,
  batching,
  setSyncing,
  setBatching,
  setSelectedOrderId,
  setActionMode,
  setActionTarget,
}: CollectionCenterActionsInput) => {
  const handleSyncOverdue = async () => {
    if (syncing) {
      notify('info', '逾期同步正在进行，请稍后');
      return;
    }
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
    if (batching) {
      notify('info', '批量催收正在进行，请稍后');
      return;
    }
    if (!permissions.canCreateReminder) {
      notify('warning', '当前角色没有批量催收权限');
      return;
    }

    const batchTargets = overdue.filter((row) => {
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

    if (batchTargets.length === 0) {
      notify('info', '当前没有可批量催收的逾期订单');
      return;
    }

    setBatching(true);
    try {
      const result = await collectionsService.createBatchReminders(batchTargets.map((row) => row.orderId));
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

  return {
    handleSyncOverdue,
    handleVerifyPayment,
    handleReminder,
    handleBatchReminder,
    focusOrderById,
    openActionModal,
    handlePromiseStatus,
    handleDisputeStatus,
    handleReleaseHold,
  };
};
