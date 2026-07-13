# ADR 0004: Unified Cache Boundary

## Status

Accepted

## Context

The backend already depends on Redis clients, but business modules should not choose their own cache client, key format, fallback behavior, or metrics independently. ERP/CRM reads must remain available when Redis is unreachable, while operators still need to see whether the runtime is using Redis or memory fallback.

## Decision

Introduce `CacheService` as the only backend cache boundary.

- Business modules use `backend/src/services/cache.service.ts`; they do not import `redis` or `ioredis` directly.
- Runtime uses Redis when `REDIS_URL` or `CACHE_REDIS_URL` is configured and `CACHE_DRIVER` is empty or `redis`.
- Memory cache is always the fallback so low-risk read models can continue during Redis outages.
- Cache metrics are exported through Prometheus as `ailaoda_cache_operations_total`.
- Health responses expose cache status without making Redis fallback a hard `/health` failure.
- Currency exchange-rate snapshots are the first low-risk read model migrated to this boundary.

## Consequences

Read-model caches now have one ownership point for TTL, fallback, status, and metrics. Redis outages can be detected without turning non-critical cache misses into customer-facing downtime.

Future write-through or invalidation-heavy cache usage must add explicit tests for stale data and permission boundaries before adoption.
