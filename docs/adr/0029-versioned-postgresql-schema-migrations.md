# ADR 0029: Versioned PostgreSQL Schema Migrations

## Status

Accepted

## Context

`prisma db push` is useful for disposable empty-target rehearsals, but it is not an auditable upgrade mechanism for a populated enterprise PostgreSQL database. It does not provide a repository-owned migration version, immutable checksum ledger, or fail-closed drift detection.

## Decision

- Store additive PostgreSQL migrations under `backend/prisma/postgres-migrations/<version>_<name>/migration.sql`.
- Apply them with `scripts/postgres-schema-migrate-v1.cjs` before application startup or data import.
- Serialize migration execution with a PostgreSQL advisory lock.
- Execute each migration and ledger insert in one transaction.
- Record SHA-256 checksums in `ailaoda_schema_migrations`.
- Reject modified applied migrations, database versions unknown to the current artifact, and migration history gaps that would otherwise run an older migration out of order.
- Package the migrator and migration SQL inside the PostgreSQL server artifact and run `apply` plus `verify` before application startup.
- Keep `prisma db push` only for empty disposable target creation; follow it with migration `apply` and `verify` so the ledger is initialized and checked.

## Consequences

Existing PostgreSQL installations now have an in-place schema upgrade path. Rollback of an additive migration remains an operator-controlled restore or forward-fix operation; destructive automatic down migrations are intentionally excluded.
