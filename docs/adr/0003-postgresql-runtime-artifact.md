# ADR 0003: PostgreSQL Runtime Artifact

Date: 2026-07-07

## Status

Accepted as an incremental production-readiness track.

## Context

The main local runtime still uses a SQLite Prisma provider because the stable
desktop/private package depends on SQLite backup, restore, and local runtime
flows. For SaaS or multi-user ERP operation, SQLite is not a safe production
database target.

The previous PostgreSQL migration probe only wrote a temporary schema under
`output/` and proved syntax. It did not create a deployable server artifact or
prevent a SQLite-generated Prisma client from being used with a PostgreSQL
`DATABASE_URL`.

## Decision

Keep the local/private SQLite flow intact, but add a PostgreSQL-specific
artifact path:

- generate `.generated/prisma-postgresql` from `backend/prisma`
- rewrite only the copied datasource provider to `postgresql`
- validate the generated artifact with `npm run prisma:validate:postgres`
- build PostgreSQL images with `Dockerfile.postgres`
- run PostgreSQL deployments with `docker-compose.postgres.yml`
- set `AILAODA_PRISMA_PROVIDER=postgresql` in PostgreSQL images
- reject mismatched runtime combinations in `backend/src/config/runtime.ts`

## Runtime Policy

| Database URL | Prisma provider marker | Runtime decision |
|---|---|---|
| SQLite | `sqlite` | allowed for local/private modes |
| PostgreSQL | `sqlite` | blocked |
| PostgreSQL | `postgresql` | allowed |
| SQLite | `postgresql` | blocked |
| SaaS mode without PostgreSQL | any | blocked |

## Remaining Work

This does not complete the PostgreSQL migration. Remaining production work:

- migration scripts and verified migrations
- seed and backup/restore validation against PostgreSQL
- business-chain API audits on a real PostgreSQL runtime
- JSON field normalization decisions
- deployment secret management for the PostgreSQL password and connection URL
