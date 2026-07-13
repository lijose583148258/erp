import {
  CollectionDisputeRecord,
  CollectionHoldRecord,
  CollectionLedgerRecord,
  CollectionMilestoneRecord,
  CollectionOverdueRecord,
  CollectionPromiseRecord,
  CollectionSummary,
  collectionsService,
} from '../../src/services/collections.service';
import { serverStateClient } from '../../app/serverState';
import { reportClientIssue } from '../../utils/clientIssue';

export type CollectionLoadOptions = {
  force?: boolean;
};

type CollectionLoadBundle = {
  summary: CollectionSummary | null;
  ledger: CollectionLedgerRecord[];
  overdue: CollectionOverdueRecord[];
  milestones: CollectionMilestoneRecord[];
  promises: CollectionPromiseRecord[];
  disputes: CollectionDisputeRecord[];
  holds: CollectionHoldRecord[];
  errors: string[];
};

export const COLLECTION_CENTER_TTL_MS = 20_000;
export const COLLECTION_WORKBENCH_QUERY_KEY = ['collections', 'workbench'] as const;

export const invalidateCollectionCenterState = () => {
  serverStateClient.invalidateQueries(['collections']);
};

const summarizeLoadError = (label: string, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return `${label}: ${message}`;
};

const unwrapSettled = <T,>(label: string, result: PromiseSettledResult<T>, fallback: T, errors: string[]) => {
  if (result.status === 'fulfilled') return result.value;
  errors.push(summarizeLoadError(label, result.reason));
  return fallback;
};

export const requestCollectionLoadBundle = (force = false) => (
  serverStateClient.fetchQuery({
    key: COLLECTION_WORKBENCH_QUERY_KEY,
    ttlMs: COLLECTION_CENTER_TTL_MS,
    force,
    queryFn: async (): Promise<CollectionLoadBundle> => {
    try {
      return await collectionsService.getWorkbench();
    } catch (error) {
      reportClientIssue('collections.workbench-fallback', error, 'warning');
    }

    const [
      summaryResult,
      ledgerResult,
      overdueResult,
      milestoneResult,
      promiseResult,
      disputeResult,
      holdResult,
    ] = await Promise.allSettled([
      collectionsService.getSummary(),
      collectionsService.getLedger(),
      collectionsService.getOverdueOrders(),
      collectionsService.getMilestones(),
      collectionsService.getPromises(),
      collectionsService.getDisputes(),
      collectionsService.getHolds(),
    ]);
    const errors: string[] = [];

    return {
      summary: unwrapSettled('summary', summaryResult, null, errors),
      ledger: unwrapSettled('ledger', ledgerResult, [], errors),
      overdue: unwrapSettled('overdue', overdueResult, [], errors),
      milestones: unwrapSettled('milestones', milestoneResult, [], errors),
      promises: unwrapSettled('promises', promiseResult, [], errors),
      disputes: unwrapSettled('disputes', disputeResult, [], errors),
      holds: unwrapSettled('holds', holdResult, [], errors),
      errors,
    };
  },
  })
);
