import React from 'react';
import type { CollectionLedgerRecord } from '../../src/services/collections.service';
import type { CollectionActionPermissions } from './useCollectionCenter';

export default function CollectionPaymentReversalButton({ payment, permissions, onOpen, location }: {
  payment: CollectionLedgerRecord; permissions: CollectionActionPermissions; onOpen: (payment: CollectionLedgerRecord) => void; location: 'ledger' | 'workspace' | 'detail';
}) {
  if (payment.status !== 'verified' && payment.status !== 'reversed') return null;
  return <button type="button" data-testid={`collection-${location}-reversal-${payment.id}`} onClick={event => { event.stopPropagation(); onOpen(payment); }}
    className="rounded-full border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300">
    {permissions.canRequestPaymentReversal || permissions.canReviewPaymentReversal ? '原凭证 / 冲销' : '冲销记录'}
  </button>;
}
