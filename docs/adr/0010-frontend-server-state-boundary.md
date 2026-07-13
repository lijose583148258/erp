# ADR 0010: Frontend Server State Boundary

## Status

Accepted

## Context

The frontend historically mixed remote server data with component-local `useState` and direct service calls. That pattern makes duplicate requests, stale reads, and write-after-read invalidation hard to reason about as ERP list views grow.

Adding a full external state stack should be a dependency PR with rollout planning. The first production-readiness step is to create a small internal server-state boundary and migrate one high-frequency workspace through it.

## Decision

Add `app/serverState.ts` as the frontend server-state client.

- Query keys are serialized deterministically.
- Concurrent identical queries share one in-flight promise.
- Fresh query data is reused for a bounded TTL.
- Mutations can invalidate query families by key prefix.
- The sales order workspace uses this boundary for order page, customer lookup, and active contract data.
- The collection center uses this boundary for the receivables workbench and overdue search pages.
- Order status, commission, completion, payment, and save flows invalidate or force-refresh the workspace query state.
- Collection payment verification, reminders, promises, disputes, holds, and overdue sync force-refresh collection query state.

## Consequences

The sales order workspace and collection center now have explicit server-state contracts instead of ad hoc `Promise.allSettled` or direct search reads. This reduces duplicate first-page/workbench/search requests and gives write paths a consistent cache invalidation mechanism.

Future work should either broaden this internal client route by route or replace it with a dependency-owned TanStack Query/Zustand rollout once package and migration ownership are agreed.
