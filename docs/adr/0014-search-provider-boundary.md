# ADR 0014: Search Provider Boundary

## Status

Accepted

## Context

Customer, order, procurement, warehouse, and collection screens all need fast text lookup as data grows. The current runtime still uses SQLite by default, and several query paths rely on Prisma `contains` or SQL `LIKE`. That is acceptable for small local pilots, but it is not a production search strategy for large ERP datasets.

Introducing Elasticsearch or Meilisearch directly into controllers would couple business permissions, pagination, and deployment topology to a specific engine. The first production-readiness step should centralize search ownership while keeping the current database fallback explicit.

## Decision

Add `backend/src/services/search.service.ts`.

- Normalize and cap incoming search terms before building query filters.
- Own customer and order Prisma fallback search clauses in one service.
- Add `MeilisearchProvider` for customer/order candidate ID recall when `SEARCH_DRIVER=meilisearch` and `SEARCH_ENDPOINT` or `MEILISEARCH_URL` is configured.
- Keep Meilisearch limited to ID retrieval through `attributesToRetrieve: ['id']`; Prisma still applies business filters, pagination, and data-scope permissions.
- Keep data-scope enforcement outside the search service; callers still merge search filters with existing access-control where clauses.
- Expose `getSearchStatus()` so health endpoints report whether the active search path is Prisma fallback or an externally configured driver.
- Support `SEARCH_DRIVER`, `SEARCH_ENDPOINT`, `MEILISEARCH_URL`, `MEILISEARCH_API_KEY`, `ELASTICSEARCH_URL`, `SEARCH_INDEX_PREFIX`, and `SEARCH_MAX_QUERY_LENGTH` as operator-facing configuration.
- Emit Prometheus `ailaoda_search_operations_total` counters.
- Add `scripts/search-boundary-audit-v1.cjs` and Jest coverage for deterministic search behavior.

## Consequences

Customer list and order list queries can use Meilisearch candidate IDs without rewriting business controllers or weakening access control. Customer export stays on the Prisma fallback path until export-specific indexing and audit requirements are defined.

This does not mean production search is complete. The external indexer, permission-aware document model, backfill/reindex jobs, freshness monitoring, and query ranking still need a focused follow-up PR.
