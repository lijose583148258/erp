# ADR 0012: Outbound Webhook Boundary

## Status

Accepted

## Context

The project now has versioned API routes, OpenAPI, and a generated SDK, but external systems still need outbound event delivery. ERP integrations should receive order and payment lifecycle events without coupling core transactions to third-party uptime.

Webhook delivery is an integration side effect. It must be signed, timeboxed, and non-blocking so a failed partner endpoint cannot roll back or delay a committed ERP transaction.

## Decision

Add `backend/src/services/webhook.service.ts`.

- Configure endpoints through `AILAODA_WEBHOOK_ENDPOINTS`.
- Support JSON endpoint objects with optional `events` filters and per-endpoint `secret`.
- Support `AILAODA_WEBHOOK_SECRET` as the default signing secret.
- Sign payloads with `x-ailaoda-signature: sha256=<hmac>`.
- Include `x-ailaoda-event` and `x-ailaoda-timestamp` headers.
- Timebox delivery with `AILAODA_WEBHOOK_TIMEOUT_MS`.
- Publish order create/update/status/complete and payment submit/verify events.
- Delivery failures are logged and do not fail the source transaction.

## Consequences

External integrations can subscribe to ERP workflow events with a stable signed contract. The initial implementation is best-effort delivery, not a durable queue.

Future work should add persisted delivery attempts, retry/backoff policy, dead-letter review, tenant-level endpoint ownership, and webhook management APIs.
