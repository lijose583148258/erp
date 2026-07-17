# ADR 0016: Backend Read Service Layering

## Status

Accepted

## Context

Several backend controllers still combine HTTP handling, Prisma query construction, pagination, sorting, search filters, permission-scoped where clauses, and payload shaping in one file. That makes unit testing hard and increases the chance that future API changes bypass data-scope rules.

Orders already use `OrderWorkspaceService` for the main read path. CRM customer reads are another high-frequency workflow and are a good first service-layer ratchet for the remaining controller-heavy modules.

## Decision

Add `backend/src/services/customer-query.service.ts`.

- Move customer list query parsing, filter construction, Prisma reads, enrichment, and payload mapping into `CustomerQueryService.listCustomers`.
- Move customer stats read-model construction into `CustomerQueryService.getCustomerStats`.
- Keep `buildCustomerWhere(req, filters)` as the access-control merge point so data-scope behavior stays unchanged.
- Keep HTTP response handling and error mapping in `customer-query.controller.ts`.
- Add helper tests and `scripts/backend-layering-audit-v1.cjs` to prevent the controller from regressing to direct Prisma list/stat reads.

## Consequences

Customer list and stats now have a testable service boundary similar to the order workspace. This is a foundation, not full backend layering completion.

Future work should move customer detail, write workflows, procurement, shipping, warehouse, and finance read models behind module services with transaction boundaries and focused unit tests.
