# ADR 0001: Versioned API Namespace and OpenAPI Contract Foundation

## Status

Accepted

## Context

The ERP+CRM backend had many production routes mounted directly under `/api/*`.
That kept existing clients simple, but it left no stable namespace for breaking
changes and no machine-readable contract for frontend, QA, SDK, or integration
work.

The codebase already has mature module coverage and backend service separation,
so the next production-readiness step is to make the API boundary explicit
without forcing a risky rewrite of every controller.

## Decision

Keep the existing `/api/*` namespace as the compatibility surface and mount the
same route modules under `/api/v1/*` as the stable production namespace.

Define route ownership in `backend/src/routes/apiRegistry.ts` and generate a
baseline OpenAPI 3.0 document from that registry at:

- `/api/openapi.json`
- `/api/v1/openapi.json`

The initial OpenAPI document records module boundaries, runtime probes, auth
scheme, and common response expectations. Detailed per-operation DTO schemas
will be added incrementally as validators and generated/shared contracts are
introduced.

## Consequences

- Existing clients can continue using `/api/*`.
- New clients and integrations can target `/api/v1/*`.
- Route registration and contract metadata now share a single source of truth.
- Future SDK generation has a stable document endpoint to build from.
- The contract is intentionally broad today; it must not be treated as a full
  per-field DTO guarantee until schemas are generated from validators or shared
  types.

## Follow-ups

- Generate OpenAPI request/response schemas from Zod validators.
- Add compatibility policy for v1 deprecations and breaking changes.
- Generate frontend/API SDK clients from the OpenAPI document.
- Add webhook endpoint contracts after outbound integration ownership is defined.
