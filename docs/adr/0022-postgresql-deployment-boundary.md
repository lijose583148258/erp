# ADR 0022: PostgreSQL Deployment Boundary

## Status

Accepted

## Context

The default server package still uses a SQLite Prisma provider. The project already has a PostgreSQL Prisma artifact probe, but a probe alone does not give operators a safe integration environment for migration rehearsal.

Pointing the current application container at a PostgreSQL `DATABASE_URL` is unsafe because the runtime package is intentionally guarded against that mismatch.

## Decision

Add `docker-compose.postgres.yml` as the PostgreSQL integration and migration rehearsal topology.

- The compose file starts only PostgreSQL and does not start the current application container.
- `POSTGRES_PASSWORD` is required through environment interpolation and has no weak fallback.
- The service includes a `pg_isready` healthcheck and a named volume for durable rehearsal data.
- The current app compose stays on the SQLite runtime default until a PostgreSQL-specific server artifact exists.
- Add `scripts/postgres-deployment-boundary-audit-v1.cjs` and `npm run audit:db:postgres-boundary`.

## Consequences

The project now has a concrete PostgreSQL environment boundary for schema validation, client artifact generation, and migration rehearsal without pretending the production app has already cut over.

Future work must build a PostgreSQL-specific server artifact, run raw SQL compatibility checks, rehearse data migration and rollback, and execute route-level read/write smoke tests before changing the production app `DATABASE_URL`.
