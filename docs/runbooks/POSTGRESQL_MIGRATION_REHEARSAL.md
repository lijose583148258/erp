# PostgreSQL Migration Rehearsal Runbook

## Purpose

Move the project from SQLite-first packaging toward a PostgreSQL production cutover without treating artifact generation as a real migration.

This runbook is a pre-cutover rehearsal boundary. Do not claim production cutover until a PostgreSQL server artifact has run route-level smoke tests against migrated data and rollback has been rehearsed.

## Preflight

Run these checks before touching runtime data:

```powershell
npm run audit:db:postgres-artifact
npm run build:backend:postgres-server-artifact
npm run audit:db:postgres-server-artifact
npm run audit:db:postgres-raw-sql
npm run audit:db:postgres-migration-rehearsal
npm run audit:db:postgres-portable-rehearsal
```

Required result:

- PostgreSQL Prisma artifact report: passed
- PostgreSQL server artifact report: passed
- PostgreSQL raw SQL compatibility: passed with zero blockers and zero P2 review files
- PostgreSQL migration rehearsal audit: passed
- `output/audit/postgres-migration-plan-v1.json` is generated when `npm run db:pg -- plan` runs
- `output/audit/postgres-migration-dry-run-v1.json` is generated after `npm run db:pg -- dry-run-import`

## Final SQLite backup

Create and verify a final SQLite backup before exporting migration data:

```powershell
npm run audit:backup-restore:fingerprint
npm run audit:runtime:write-backup-restore
```

Required result:

- backup manifest exists
- backup checksum verifies
- runtime write is present in the backup copy
- restore read-back matches the backed-up business fingerprint

## Snapshot export

Print the current plan:

```powershell
npm run db:pg -- plan
```

Export a SQLite snapshot for migration rehearsal:

```powershell
npm run db:pg -- snapshot
```

The snapshot is written under the configured backup directory in `postgres-migration/`.
The command also writes `output/audit/postgres-migration-snapshot-v1.json` with checksum, table count, and row count evidence.

Generate the import manifest before loading PostgreSQL:

```powershell
npm run db:pg -- manifest
```

This writes `output/audit/postgres-migration-import-manifest-v1.json` with phase-by-phase import order, critical table mapping, and deferred tables.

Rehearse the import order and row accounting before touching PostgreSQL:

```powershell
npm run db:pg -- dry-run-import
```

This writes `output/audit/postgres-migration-dry-run-v1.json` with phase execution order, snapshot checksum verification, critical table coverage, duplicate-phase detection, and total row accounting across phase and deferred tables.

## PostgreSQL Rehearsal

Start only the PostgreSQL rehearsal service:

```powershell
$env:POSTGRES_PASSWORD="replace-with-a-strong-rehearsal-password"
docker compose -f docker-compose.postgres.yml up -d
```

If Docker is unavailable on Windows, bootstrap a local rehearsal instance from the official PostgreSQL Windows binary archive:

```powershell
$env:POSTGRES_WINDOWS_BIN_ZIP='C:\path\to\postgresql-17.x-windows-x64-binaries.zip'
$env:POSTGRES_PASSWORD='replace-with-a-strong-rehearsal-password'
npm run db:pg:start-rehearsal
npm run audit:db:postgres-portable-rehearsal
```

This extracts the official binaries under `output/postgres-runtime/` if needed, initializes a local data directory, and starts PostgreSQL on `127.0.0.1:${POSTGRES_PORT:-5432}`. Native PostgreSQL Windows tools require ASCII-only binary and data paths. When the repository path contains non-ASCII characters, the script automatically isolates the runtime under `C:\AilaoDaPostgresRehearsal`; set `POSTGRES_RUNTIME_ROOT` to an explicit ASCII-only location to override it. The start report redacts the password, so provide the rehearsal secret through `POSTGRES_URL` or `DATABASE_URL` only to the import command that needs it.

Do not start the default application container from this compose file. The current default app package is SQLite-first and must not be pointed at PostgreSQL by changing only `DATABASE_URL`.

Use the PostgreSQL server artifact produced under `output/postgres-server-artifact/` with:

```powershell
$env:AILAODA_PRISMA_PROVIDER="postgresql"
$env:DATABASE_URL="postgresql://ailaoda:<password>@127.0.0.1:5432/ailaoda?schema=public"
$env:POSTGRES_URL=$env:DATABASE_URL
```

Run schema creation, import rehearsal, and data verification from the generated PostgreSQL client artifact. Record the snapshot file, database URL host, artifact manifest, and verification output in `output/audit/`.

Use `output/audit/postgres-migration-dry-run-v1.json` as the import checklist:

- execute phases in manifest order
- capture per-phase row counts after each load step
- verify critical tables land in the expected phase
- stop immediately if row totals drift from the dry-run report

When the PostgreSQL schema is provisioned and the target database is empty, run the importer:

```powershell
npx prisma db push --schema output/postgres-prisma-artifact/prisma/schema.prisma
npm run db:pg -- import
```

If the rehearsal database already contains data and you intend to reset it first:

```powershell
$env:POSTGRES_IMPORT_MODE="truncate"
npm run db:pg -- import
```

The importer writes `output/audit/postgres-migration-import-v1.json` with imported row counts, target reset mode, per-table verification, and sequence adjustments. It still does not replace route-level smoke tests or rollback evidence.

If you want the schema push, import, and import audit to run as one rehearsal window:

```powershell
npm run run:db:postgres-import-rehearsal
```

This writes `output/audit/postgres-import-rehearsal-run-v1.json` with step-by-step orchestration evidence.

Validate the import evidence immediately after the importer finishes:

```powershell
npm run audit:db:postgres-import-rehearsal
```

Required result:

- `output/audit/postgres-migration-import-v1.json` exists
- import report snapshot checksum matches the latest snapshot report
- every manifest table appears in the import evidence with matching inserted rows
- verification rows all report `matches: true`
- `output/audit/postgres-import-rehearsal-audit-v1.json` records the import evidence gate

After the import evidence passes, create queryable PostgreSQL `jsonb` shadow
columns for legacy address, contact, and evidence fields:

```powershell
$env:POSTGRES_URL="postgresql://ailaoda:<password>@127.0.0.1:5432/ailaoda?schema=public"
npm run db:pg -- normalize-json
```

This operation is idempotent, creates GIN indexes, retains the legacy text
columns for rollback, and reports malformed legacy JSON in
`output/audit/postgres-json-normalization-v1.json`.

When the local portable rehearsal instance is no longer needed:

```powershell
npm run db:pg:stop-rehearsal
```

## Cutover smoke tests

Before production cutover, run route-level read/write smoke tests against the PostgreSQL server artifact:

```powershell
npm run audit:stock:ledger
npm run audit:orders:api
npm run audit:procurement:api
npm run audit:warehouse:ledger
npm run audit:collection:server-search
npm run audit:payment:reconcile
npm run audit:backup-restore:fingerprint
```

Required result:

- stock balances reconcile with latest movements
- order, procurement, warehouse, collection, and payment read/write paths pass
- backup/restore fingerprint remains clean for the selected runtime mode

## Rollback

Rollback is mandatory if any of these occur:

- PostgreSQL schema creation fails
- imported row counts or business fingerprints mismatch
- any route-level smoke test fails
- the PostgreSQL server artifact starts without `AILAODA_PRISMA_PROVIDER=postgresql`
- operators cannot prove which final SQLite backup was used

Rollback command:

```powershell
npm run db:pg -- rollback <backup-file.db>
```

The rollback command writes `output/audit/postgres-migration-rollback-v1.json` with the restored backup name and manifest verification result.

After rollback:

```powershell
npm run audit:runtime:write-backup-restore
npm run audit:db:integrity
npm run audit:stock:ledger
```

Keep `DATABASE_URL` on SQLite until a new rehearsal passes.

## Non-Claims

- `npm run audit:db:postgres-migration-rehearsal` proves prerequisites and rollback controls, not live data migration.
- `npm run db:pg -- dry-run-import` proves import ordering and row accounting, not live PostgreSQL writes.
- `npm run db:pg -- import` proves data landed in PostgreSQL tables, not route-level write behavior or rollback readiness.
- `npm run audit:db:postgres-import-rehearsal` proves the import evidence is internally consistent, not that the app routes are safe to cut over.
- `npm run build:backend:postgres-server-artifact` proves a PostgreSQL build artifact, not data correctness.
- `docker-compose.postgres.yml` proves a rehearsal database boundary, not application cutover.
- Do not claim production cutover until the PostgreSQL artifact, imported data, route smoke tests, backup/restore, and rollback evidence all pass in the same rehearsal window.
