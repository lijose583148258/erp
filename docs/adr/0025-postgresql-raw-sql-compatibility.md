# ADR 0025: PostgreSQL Raw SQL Compatibility Boundary

## Status

Accepted.

## Context

The project is still SQLite-first at runtime, while PostgreSQL migration work now has a rehearsal compose file, a generated Prisma client artifact, and a copied server artifact.

Those artifacts are not enough for cutover. Raw SQL can still hide SQLite-only syntax such as `PRAGMA`, `AUTOINCREMENT`, `last_insert_rowid`, `INSERT OR IGNORE`, and `rowid`. Mature ERP/SaaS projects treat this as a release gate because one incompatible write path can break a production migration even when the schema validates.

## Decision

Add `scripts/postgres-raw-sql-compat-audit-v1.cjs` and expose it as `npm run audit:db:postgres-raw-sql`.

The audit scans backend source files and classifies findings into:

- SQLite runtime maintenance files, including schema repair and backup code that are intentionally tied to the current SQLite package.
- Known PostgreSQL migration blockers that must be rewritten before cutover.
- Unclassified SQLite-only SQL, which fails the audit as P0.
- Portable raw SQL review items, which remain visible as P2.

The first ORM replacements in this boundary are:

- auth login `lastLoginAt` now updates through Prisma instead of raw SQL.
- customer `addressesJson` and `contactsJson` writes now update through Prisma instead of controller-local SQLite raw SQL.
- stock entry idempotent creation now uses Prisma create plus conflict fallback instead of SQLite `INSERT OR IGNORE`.
- inventory cost ledger adjustment creation now uses Prisma create plus the `adjustmentId` unique boundary instead of SQLite `INSERT OR IGNORE`.
- supplier master-data creation now writes Prisma schema fields directly instead of probing SQLite table columns with `PRAGMA`.
- authorization policy seeding now uses Prisma `upsert` for permissions, roles, role permissions, and policy migration markers.
- commercial workflow instances and notifications now use Prisma create-returned IDs instead of SQLite `rowid` / `last_insert_rowid()`.
- dynamic Casbin policy loading now uses Prisma relation reads instead of a raw join.
- barter stock reversal movement replay now uses Prisma relation reads instead of a raw stock-entry/stock-movement join.
- authorization role and permission management now uses Prisma reads/writes instead of raw SQL for list, create, update, grant, revoke, and data-scope access.
- commercial workflow, notification, readiness, and BI summary operations now use Prisma model APIs instead of raw SQL.
- inventory stock movement writes, idempotent stock-entry replay reads, stock-entry list filters, and movement enrichment now use Prisma model/relation APIs instead of raw SQL.
- inventory cost ledger batch snapshots, work-order ledger creation, inventory movement ledger creation, adjustment idempotency, and batch ledger listing now use Prisma create/find/aggregate APIs instead of raw SQL.

## Consequences

The PostgreSQL lane now has an executable compatibility gate without pretending the migration is complete.

The audit currently has zero P1 SQLite-only blocker files outside runtime maintenance and zero P2 raw SQL review files. Remaining raw SQL is limited to the explicit SQLite runtime-maintenance allowlist and separately reviewed portable raw SQL files. The audit summary reports reviewed portable raw SQL files, P2 review files, known blockers, and unclassified SQLite-only files directly.

This does not complete PostgreSQL production cutover. Data migration rehearsal, rollback, backup/restore verification, and route-level smoke tests are still required before switching the runtime database.

The deployment readiness audit now checks that this raw SQL compatibility gate exists alongside the PostgreSQL artifact and server artifact gates.
