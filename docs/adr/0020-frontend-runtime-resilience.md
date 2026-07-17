# ADR 0020: Frontend Runtime Resilience Boundary

## Status

Accepted

## Context

The frontend already lazy-loads active pages, but production ERP usage needs a verified runtime fallback when a page module or the root shell throws. A single component failure should not become an unexplained white screen for operators working through orders, collections, stock, or approvals.

The existing root and page error boundaries also used garbled text, which made the fallback hard to trust during an incident.

## Decision

Keep the current route-level lazy-loading boundary in `app/appContent.tsx` and make runtime resilience explicit.

- Keep the root `ErrorBoundary` mounted in `index.tsx`.
- Keep each lazy active page wrapped in `PageErrorBoundary`.
- Export pure `RootErrorFallback` and `PageErrorFallback` components so fallback markup can be unit-tested without browser orchestration.
- Record caught root and page errors through `reportClientIssue`.
- Add `scripts/frontend-runtime-resilience-audit-v1.cjs` and `npm run audit:frontend:runtime-resilience`.

## Consequences

Operators now get an actionable reload/copy/detail fallback instead of a blank or garbled failure state. Page-level failures remain isolated from the rest of the shell, while root failures still have a final recovery screen.

This does not replace full browser chaos testing. Future work should add browser-level fault injection for lazy import failures and connect client issue reports to the production observability pipeline.
