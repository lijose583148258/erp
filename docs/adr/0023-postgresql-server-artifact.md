# ADR 0023: PostgreSQL Server Artifact

## Status

Accepted.

## Context

The default packaged runtime is still SQLite-first. Mature SaaS projects such as Supabase, Cal.com, and PostHog treat PostgreSQL as a build and deployment boundary, not as a runtime-only environment variable swap.

The existing PostgreSQL schema/client probe proves that Prisma can generate a PostgreSQL client from an isolated schema copy. It does not prove that the server bundle uses that client.

## Decision

Add a dedicated PostgreSQL server artifact build:

- `npm run build:backend:postgres-server-artifact`
- output root: `output/postgres-server-artifact/`
- server dist: `output/postgres-server-artifact/backend/dist`
- Prisma schema/client: `output/postgres-server-artifact/backend/prisma`
- required runtime marker: `AILAODA_PRISMA_PROVIDER=postgresql`

The build patches the copied artifact only. Source runtime code remains guarded so the default SQLite package still refuses a PostgreSQL `DATABASE_URL`.

`npm run audit:db:postgres-server-artifact` verifies that the artifact:

- requires `../../prisma/generated-client`
- does not require `@prisma/client`
- carries a PostgreSQL schema
- keeps migration and route smoke tests outside the artifact build claim

## Consequences

This creates a production-style PostgreSQL build boundary without claiming full cutover readiness.

Still required before a real PostgreSQL SaaS launch:

- data migration rehearsal
- rollback rehearsal
- raw SQL compatibility checks
- route-level read/write smoke tests
- backup/restore verification against PostgreSQL
