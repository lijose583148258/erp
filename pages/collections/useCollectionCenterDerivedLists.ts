import { useMemo } from 'react';
import {
  CollectionDisputeRecord,
  CollectionHoldRecord,
  CollectionLedgerRecord,
  CollectionMilestoneRecord,
  CollectionOverdueRecord,
  CollectionPromiseRecord,
} from '../../src/services/collections.service';
import { riskRank } from './collectionCenter.helpers';
import type {
  DisputeFilter,
  DisputeSort,
  HoldFilter,
  HoldScopeFilter,
  HoldSort,
  LedgerSort,
  MilestoneSort,
  OverdueBucketFilter,
  OverdueSort,
  PromiseFilter,
  PromiseSort,
  RiskFilter,
} from './useCollectionCenter';

interface CollectionCenterDerivedInput {
  ledger: CollectionLedgerRecord[];
  overdue: CollectionOverdueRecord[];
  milestones: CollectionMilestoneRecord[];
  promises: CollectionPromiseRecord[];
  disputes: CollectionDisputeRecord[];
  holds: CollectionHoldRecord[];
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
}

export const useCollectionCenterDerivedLists = ({
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
}: CollectionCenterDerivedInput) => {
  const filteredOverdue = useMemo(() => overdue.filter((row) => {
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
  }), [overdue, overdueBucketFilter, overdueRiskFilter]);

  const sortedOverdue = useMemo(() => [...filteredOverdue].sort((a, b) => {
    if (overdueSort === 'amount_desc') return b.outstanding - a.outstanding;
    if (overdueSort === 'risk_desc') {
      const riskDiff = riskRank(b.riskLevel) - riskRank(a.riskLevel);
      return riskDiff !== 0 ? riskDiff : b.daysOverdue - a.daysOverdue;
    }
    if (overdueSort === 'next_action_asc') {
      const aTime = a.nextActionAt ? new Date(a.nextActionAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.nextActionAt ? new Date(b.nextActionAt).getTime() : Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    }
    return b.daysOverdue - a.daysOverdue;
  }), [filteredOverdue, overdueSort]);

  const filteredPromises = useMemo(
    () => promises.filter((row) => (promiseFilter === 'all' ? true : row.status === promiseFilter)),
    [promises, promiseFilter],
  );

  const sortedPromises = useMemo(() => [...filteredPromises].sort((a, b) => {
    if (promiseSort === 'amount_desc') return b.promisedAmount - a.promisedAmount;
    const aTime = new Date(a.promisedAt).getTime();
    const bTime = new Date(b.promisedAt).getTime();
    return promiseSort === 'promised_at_desc' ? bTime - aTime : aTime - bTime;
  }), [filteredPromises, promiseSort]);

  const filteredDisputes = useMemo(() => disputes.filter((row) => {
    if (disputeFilter === 'all') return true;
    if (disputeFilter === 'active') return row.status === 'open' || row.status === 'reviewing';
    if (disputeFilter === 'withdrawn') return row.status === 'withdrawn';
    return row.status === disputeFilter;
  }), [disputes, disputeFilter]);

  const sortedDisputes = useMemo(() => [...filteredDisputes].sort((a, b) => {
    if (disputeSort === 'amount_desc') return (b.disputedAmount || 0) - (a.disputedAmount || 0);
    if (disputeSort === 'created_desc') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    const aActive = a.status === 'open' || a.status === 'reviewing' ? 1 : 0;
    const bActive = b.status === 'open' || b.status === 'reviewing' ? 1 : 0;
    if (bActive !== aActive) return bActive - aActive;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  }), [filteredDisputes, disputeSort]);

  const filteredHolds = useMemo(() => holds.filter((row) => {
    const statusMatched =
      holdFilter === 'all'
      || (holdFilter === 'active' && row.status)
      || (holdFilter === 'released' && !row.status);

    const scopeMatched = holdScopeFilter === 'all' || row.scope === holdScopeFilter;
    return statusMatched && scopeMatched;
  }), [holds, holdFilter, holdScopeFilter]);

  const sortedHolds = useMemo(() => [...filteredHolds].sort((a, b) => {
    if (holdSort === 'updated_desc') {
      const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bTime - aTime;
    }
    if (holdSort === 'scope') return a.scope.localeCompare(b.scope);
    if (a.status !== b.status) return Number(b.status) - Number(a.status);
    const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return bTime - aTime;
  }), [filteredHolds, holdSort]);

  const sortedLedger = useMemo(() => [...ledger].sort((a, b) => {
    if (ledgerSort === 'amount_desc') return b.amount - a.amount;
    if (ledgerSort === 'pending_first') {
      const aPending = a.status === 'verified' ? 0 : 1;
      const bPending = b.status === 'verified' ? 0 : 1;
      if (bPending !== aPending) return bPending - aPending;
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  }), [ledger, ledgerSort]);

  const sortedMilestones = useMemo(() => [...milestones].sort((a, b) => {
    if (milestoneSort === 'remaining_desc') return b.remainingAmount - a.remainingAmount;
    if (milestoneSort === 'open_first') {
      const aOpen = a.status === 'paid' ? 0 : 1;
      const bOpen = b.status === 'paid' ? 0 : 1;
      if (bOpen !== aOpen) return bOpen - aOpen;
    }
    const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
    const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
    return aDue - bDue;
  }), [milestones, milestoneSort]);

  return {
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
  };
};
