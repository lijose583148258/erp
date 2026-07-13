# ADR 0003: PostgreSQL Prisma Artifact Probe

Date: 2026-07-08

## Status

Accepted

## Context

The current stable runtime is a SQLite Prisma artifact. Simply setting `DATABASE_URL=postgresql://...` would be unsafe because the generated Prisma client and several raw SQL paths may still assume SQLite behavior.

The project needs a credible path from SQLite local/private deployments toward PostgreSQL production deployments without breaking the current local package.

## Decision

Keep the default runtime artifact on SQLite for now, and add a separate PostgreSQL Prisma artifact probe.

The probe copies the full Prisma schema folder, rewrites only the copied datasource provider to PostgreSQL, validates the copied schema, and generates an isolated Prisma client under `output/postgres-prisma-artifact/generated-client`.

Commands:

- `npm run audit:migration:offline`
- `npm run audit:db:postgres-artifact`
- `npm run build:backend:postgres-artifact`

The runtime still refuses to boot a PostgreSQL `DATABASE_URL` with the SQLite package. A production PostgreSQL server artifact must be cut deliberately after raw SQL compatibility and migration rehearsals pass.

## Consequences

The PostgreSQL schema/client build path is now continuously checkable.

The existing SQLite desktop/local package remains unchanged.

This does not prove data migration, raw SQL compatibility, or production cutover readiness. Those require a PostgreSQL integration environment, data migration rehearsal, read-back checks, rollback practice, and route-level smoke tests.

## Verification

- `npm run audit:migration:offline`
- `npm run audit:db:postgres-artifact`
- `npm run audit:deployment:readiness`
