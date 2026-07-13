# ADR 0011: Realtime Notification WebSocket Boundary

## Status

Accepted

## Context

Approval, order, and payment workflows previously depended on manual refresh or polling-like page reloads. ERP operators need a realtime signal when an order or receivable state changes.

Adding a full collaboration platform is larger than the current production-readiness slice. The first boundary should support authenticated push notifications without changing transactional source-of-truth rules.

## Decision

Add a WebSocket notification channel at `/ws/notifications`.

- The backend handles HTTP `upgrade` for `/ws/notifications`.
- Clients authenticate with the existing JWT token.
- The backend broadcasts JSON notification events to matching roles or users.
- Health output exposes connected realtime client count.
- The frontend app shell connects after login and disconnects on logout or forced password change.
- Vite proxies `/ws` to the backend during development.
- Initial event producers are sales order create/update/status/complete and payment submit/verify paths.
- SaaS instances fan events through Redis Pub/Sub and ignore envelopes originating from the same instance.

## Consequences

Operators can receive realtime workflow notifications without adding polling to high-traffic pages. The event stream is advisory only; business truth still comes from API read-back and audit logs.

Future work should add persisted notification delivery receipts, tenant-aware channel isolation, heartbeat telemetry, and managed WebSocket connection draining.
