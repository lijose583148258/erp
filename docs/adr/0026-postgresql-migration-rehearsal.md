# ADR 0026: PostgreSQL Migration Rehearsal Boundary

## Status

Accepted.

## Context

The project now has a PostgreSQL rehearsal compose file, generated PostgreSQL Prisma client artifact, PostgreSQL server artifact, and a raw SQL compatibility gate with zero P2 review files.

Those gates still do not prove that production data can be migrated, verified, smoked, and rolled back. ERP cutover risk is concentrated in data correctness, stock/cost ledger integrity, route-level write behavior, and operator rollback confidence.

## Decision

Add a PostgreSQL migration rehearsal boundary:

- `docs/runbooks/POSTGRESQL_MIGRATION_REHEARSAL.md`
- `scripts/postgres-migration-rehearsal-audit-v1.cjs`
- `npm run audit:db:postgres-migration-rehearsal`

The audit verifies that pre-cutover prerequisites are present:

- PostgreSQL Prisma artifact report passed.
- PostgreSQL server artifact report passed.
- PostgreSQL raw SQL compatibility report passed with zero blockers and zero P2 review files.
- SQLite backup/restore fingerprint and runtime write-backup-restore audits exist.
- `db:pg` exposes plan, snapshot, manifest, dry-run-import, and rollback commands and writes structured JSON/Markdown evidence reports.
- `db:pg -- import` can load the snapshot into a provisioned PostgreSQL rehearsal database and emit per-table verification evidence.
- `audit:db:postgres-import-rehearsal` validates that the import report matches the manifest and snapshot evidence.
- `run:db:postgres-import-rehearsal` orchestrates schema push, import, and import-audit as one evidence window when PostgreSQL is available.
- The runbook documents preflight, final SQLite backup, snapshot export, PostgreSQL rehearsal, route-level smoke tests, rollback triggers, and non-claims.

The deployment readiness audit now requires this rehearsal boundary in addition to the PostgreSQL artifact and raw SQL gates.

## Consequences

The project has a stricter cutover story: a green build is no longer enough to imply PostgreSQL readiness.

This boundary intentionally does not execute a live PostgreSQL data import. A production cutover still requires a same-window rehearsal that records:

- final SQLite backup filename and manifest checksum
- snapshot export path and checksum
- dry-run import phase order and row-accounting evidence
- PostgreSQL import report with per-table row-count verification
- PostgreSQL target and artifact manifest
- row count and business fingerprint verification
- inventory/cost route smoke tests
- rollback command and read-back evidence
