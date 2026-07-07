# ADR 0002: Cache Strategy And Redis Client

Date: 2026-07-07

## Status

Accepted for incremental rollout.

## Context

The backend package previously declared both `redis` and `ioredis`, but there
was no single cache entry point, key naming policy, TTL policy, or
failure-mode contract. That made future dashboard, permission, reference-data,
and read-model caching hard to review and easy to implement inconsistently.

ERP cache behavior must be conservative because stale order, receivable,
inventory, approval, or permission data can cause business errors.

## Decision

Use `ioredis` as the selected backend Redis client for the application cache
entry point. Introduce `backend/src/services/cache.service.ts` as the only new
cache API that product modules should call.

The initial cache service provides:

- explicit strategy IDs and owners
- stable versioned keys under `ailaoda:v1:*`
- short TTLs by default
- JSON-only values
- no Redis connection unless `CACHE_REDIS_URL` or `REDIS_URL` is configured
- bypass-on-failure behavior instead of failing ERP reads or writes

The duplicate `redis` package has been removed from the backend dependency
manifest and lockfile. `ioredis` is now the single Redis client dependency for
the backend cache path.

## Initial Strategies

| Strategy | Owner | TTL | Invalidates on |
|---|---|---:|---|
| `dashboard-summary` | reporting | 60s | order, collection, stock, production writes |
| `permission-registry` | identity-access | 300s | role, permission, user status changes |
| `reference-data` | master-data | 300s | customer, supplier, warehouse, product updates |
| `read-model` | operations | 120s | module-owned write events |

## Rules

- Business writes must invalidate or bypass affected keys before relying on
  cached read models.
- Permission and role changes must prefer correctness over cache hit rate.
- Cache failures must log warnings and fall back to database reads.
- Modules must not instantiate Redis clients directly.
- Cache keys must include tenant or organization scope before use in
  multi-tenant or SaaS mode.

## Consequences

This creates a safe, reviewable cache path without changing business behavior
yet. Follow-up work should adopt the cache in one read-heavy module and add
focused tests around hit/miss, invalidation, and bypass-on-failure behavior.
