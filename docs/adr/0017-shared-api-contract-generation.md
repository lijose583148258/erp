# ADR 0017: Shared API Contract Generation

## Status

Accepted

## Context

The frontend has a large hand-written `types.ts`, while the backend owns API route registration and response envelopes. The generated SDK already gives external callers a stable client surface, but it previously duplicated the base API response and module-list types inside the SDK file.

Keeping response and module contracts in multiple hand-written places invites drift. A full endpoint DTO generator still requires richer OpenAPI schemas, but the base API contract can be generated now from the route registry.

## Decision

Extend `scripts/generate-api-sdk-v1.cjs` to generate `shared/api-contract.ts`.

- Generate `AilaoDaApiNamespace`, `AilaoDaPaginationMeta`, `AilaoDaApiResponse`, `AILAO_DA_API_MODULES`, and `AilaoDaApiModulePath` from `backend/src/routes/apiRegistry.ts`.
- Generate the first endpoint-specific shared DTOs for customer, order, and collection overdue list queries/responses so the busiest CRM, sales, and receivables reads are no longer SDK-only generics.
- Make `sdk/ailaoda-api-client.ts` import and re-export those shared contract types instead of redefining them.
- Cover both `shared/api-contract.ts` and the generated SDK in `tsconfig.strict.json`.
- Add `scripts/shared-api-contract-audit-v1.cjs` so the shared contract cannot silently disappear or drift back into SDK-only definitions.

## Consequences

The frontend and SDK now share the same generated base API contract and the first high-frequency endpoint DTOs. This reduces drift for response envelopes, pagination metadata, API namespace, route-module coverage, and customer/order/collection overdue list query semantics.

This does not replace the legacy domain `types.ts` yet. Future work should add endpoint request/response schemas to OpenAPI and generate DTOs for payments, inventory, finance, procurement, and warehouse workflows.
