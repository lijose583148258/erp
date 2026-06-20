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

let collectionLoadInflight: { key: string; promise: Promise<CollectionLoadBundle> } | null = null;

const getCollectionLoadKey = () => {
  try {
    return window.localStorage.getItem('token') || 'anonymous';
  } catch {
    return 'anonymous';
  }
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

export const requestCollectionLoadBundle = (force = false) => {
  const key = getCollectionLoadKey();
  if (!force && collectionLoadInflight?.key === key) {
    return collectionLoadInflight.promise;
  }

  const promise = (async (): Promise<CollectionLoadBundle> => {
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
  })();

  collectionLoadInflight = { key, promise };
  promise
    .finally(() => {
      window.setTimeout(() => {
        if (collectionLoadInflight?.key === key && collectionLoadInflight.promise === promise) {
          collectionLoadInflight = null;
        }
      }, 500);
    })
    .catch(() => {
      // The original caller handles the load failure; this only prevents
      // the cleanup branch from becoming an unhandled browser pageerror.
    });

  return promise;
};
