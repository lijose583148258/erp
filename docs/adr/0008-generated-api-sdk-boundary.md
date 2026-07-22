# ADR 0008: Generated API SDK Boundary

## Status

Accepted

## Context

The backend now exposes a baseline OpenAPI document from the API route registry, but frontend services and external integrations still need a stable client boundary. The current OpenAPI contract is module-level, not yet a full request/response DTO schema for every endpoint.

Generating a full DTO SDK from incomplete schemas would create false confidence. A smaller generated module client gives integrators a stable namespace, bearer-token behavior, error shape, and route-module coverage while endpoint schemas mature.

## Decision

Generate `sdk/ailaoda-api-client.ts` from `backend/src/routes/apiRegistry.ts`.

- The SDK defaults to `/api/v1`.
- The SDK supports `Authorization: Bearer` injection.
- The SDK exposes generic `request/get/post/put/patch/delete` helpers.
- Each registered API module gets a small typed module wrapper.
- High-frequency customer, order, and collection overdue list reads get endpoint-specific DTO helpers (`listCustomers`, `listOrders`, `listCollectionOverdueOrders`) while the broader API surface remains module-generic.
- Bulk order import gets a typed `importOrders` helper whose signature requires the caller-generated idempotency key and emits the `Idempotency-Key` header.
- SDK generation is owned by `scripts/generate-api-sdk-v1.cjs`.
- SDK coverage is audited by `scripts/api-sdk-audit-v1.cjs`.

## Consequences

External callers and frontend migration work now have a concrete client boundary. The SDK is no longer all-or-nothing: mature endpoint schemas can graduate into typed helpers one workflow at a time.

Future work should continue expanding endpoint-specific DTOs from Zod/OpenAPI schemas for payments, inventory, finance, procurement, and webhook event contracts once ownership is defined.
