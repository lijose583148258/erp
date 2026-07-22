# Deployment

## Windows Local Pilot

The packaged artifact is currently a Windows local pilot package.

Default entry:

```text
http://127.0.0.1:5001/
```

Default runtime data root:

```text
D:\AilaoDaRuntime
```

If a workstation has no usable `D:` drive, do not patch source code by hand. Use a governed migration drill and record the chosen runtime path before moving business data.

## Linux / Docker / Cloud

Do not treat the Windows local package as a Linux server package.

Linux or Docker deployment requires:

- Prisma Client generated for the target platform
- `prisma validate` passed on the target build runner
- target database path or PostgreSQL connection configured explicitly
- backup, upload, and log paths mounted outside the container image
- release verification run after startup

The Prisma schema includes `binaryTargets = ["native", "windows", "debian-openssl-3.0.x"]` so a fresh generate step can support Windows and Debian OpenSSL 3 runners. The generated client inside a prebuilt Windows package is still not proof of Linux readiness.

## PostgreSQL Rehearsal Boundary

`docker-compose.postgres.yml` provides a PostgreSQL-only integration environment for schema validation and migration rehearsal:

```powershell
$env:POSTGRES_PASSWORD = '<strong rehearsal password>'
docker compose -f docker-compose.postgres.yml up -d postgres
npm run audit:db:postgres-artifact
npm run audit:db:postgres-boundary
```

If Docker is unavailable on a Windows rehearsal host, bootstrap a local PostgreSQL instance from the official PostgreSQL Windows binary zip:

```powershell
$env:POSTGRES_WINDOWS_BIN_ZIP = 'C:\path\to\postgresql-17.x-windows-x64-binaries.zip'
$env:POSTGRES_PASSWORD = '<strong rehearsal password>'
npm run db:pg:start-rehearsal
```

On Windows, the native PostgreSQL data and binary paths must be ASCII-only. The rehearsal script automatically falls back to `C:\AilaoDaPostgresRehearsal` when this repository path contains non-ASCII characters. Set `POSTGRES_RUNTIME_ROOT` to an explicit ASCII-only location when a different isolated runtime root is required. Portable archives are extracted into immutable SHA-256-addressed directories under `portable-cache`; changing the archive never recursively replaces a previous binary directory. The start report redacts its connection password; inject the same rehearsal secret through `POSTGRES_URL` or `DATABASE_URL` only in the import command environment.

This does not start the application container. The current app image remains a SQLite Prisma artifact and intentionally refuses a PostgreSQL `DATABASE_URL`. A production PostgreSQL cutover still requires a PostgreSQL-specific server artifact, raw SQL compatibility checks, migration and rollback rehearsal, and route-level read/write smoke tests.

## PostgreSQL Server Artifact

For a PostgreSQL application topology, use the dedicated production artifact. It
builds the frontend and PostgreSQL-specific backend in one reproducible image;
it does not reuse the SQLite Prisma client.

```powershell
$env:POSTGRES_PASSWORD = '<strong database password>'
$env:JWT_SECRET = '<long random application secret>'
docker compose -f docker-compose.production-postgres.yml up -d --build
```

The compose file refuses to start without `POSTGRES_PASSWORD` and `JWT_SECRET`.
Run the migration/import and route-level smoke-test runbook before treating this
topology as a production cutover.

For PostgreSQL deployment rehearsal, build the server artifact that binds the compiled backend to the generated PostgreSQL Prisma client:

```powershell
npm run build:backend:postgres-server-artifact
npm run audit:db:postgres-server-artifact
```

The artifact is written to:

```text
output/postgres-server-artifact/
```

Runtime start shape:

```powershell
$env:NODE_ENV = 'production'
$env:AILAODA_DEPLOYMENT_MODE = 'saas'
$env:AILAODA_PRISMA_PROVIDER = 'postgresql'
$env:DATABASE_URL = 'postgresql://user:password@host:5432/ailaoda?schema=public'
node output/postgres-server-artifact/backend/dist/server.js
```

This still does not perform data migration, rollback rehearsal, raw SQL compatibility proof, or route-level smoke testing.

## OpenAPI Contract Boundary

Versioned API contract verification should stay green before packaging or integration rollout:

```powershell
npm run audit:api:openapi
npm run audit:api:sdk
```

Contract entry points:

```text
/api/openapi.json
/api/v1/openapi.json
/api/docs
/api/v1/docs
```

This proves the versioned contract and generated SDK boundary still exist. It does not yet prove that every endpoint has full request/response DTO coverage.

## Frontend Production Readiness

Before packaging or server rollout, keep the frontend production baseline green:

```powershell
npm run audit:frontend:production-readiness
```

This orchestration runs:

```text
audit:frontend:server-state
audit:frontend:client-state
audit:frontend:runtime-resilience
audit:ui:virtualized-grid
audit:pwa:offline
audit:observability:rum
test:unit:frontend
audit:frontend:bundle-budget
```

Artifacts:

```text
output/audit/frontend-production-readiness-v1.json
output/audit/frontend-production-readiness-v1.md
```

This proves the current frontend keeps the resource-style server-state boundary, shell-level client-state store, route lazy loading plus error fallbacks, virtualized high-frequency tables, offline shell boundary, browser web-vitals intake, unit test coverage, and bundle budgets. It does not yet replace broader RTL/Vitest suites, mobile-device audits, or production RUM dashboards/alerts.

## Security Production Readiness

Before packaging or server rollout, keep the security baseline green:

```powershell
npm run audit:security:production-readiness
```

This orchestration runs:

```text
audit:security:csp
audit:security:csrf-boundary
audit:security:mfa
audit:security:secrets
audit:security:dependencies
```

Artifacts:

```text
output/audit/security-production-readiness-v1.json
output/audit/security-production-readiness-v1.md
```

This proves the current release keeps a strict CSP boundary, Bearer-only CSRF/session model, MFA login gate for configured roles, centralized secret resolution with production rejection for weak JWT secrets, and a clean production dependency audit. It does not yet replace hardware-backed secret storage, operator key rotation, MFA enrollment/recovery workflows, or external dependency scanning in CI.

## PostgreSQL Import Rehearsal Window

When a PostgreSQL rehearsal database is available, the governed import window is:

```powershell
$env:POSTGRES_URL = 'postgresql://user:password@host:5432/ailaoda?schema=public'
npm run run:db:postgres-import-rehearsal
```

Artifacts:

```text
output/audit/postgres-migration-import-v1.json
output/audit/postgres-import-rehearsal-audit-v1.json
output/audit/postgres-import-rehearsal-run-v1.json
```

Run the deployment migration readiness gate after the window:

```powershell
npm run audit:deployment:readiness
```

The gate now consumes all three reports above. It returns `failed` when the orchestrated run or import audit is red, and it does not treat a dry-run report, a missing import report, or a stale failed run as production evidence. A passing import window proves schema push, data import, and import-evidence validation in one recorded window. It still does not replace route-level smoke tests, backup/restore verification, or rollback evidence.

## MinIO / S3 File Storage

Local file storage remains the default for desktop and private pilots:

```text
FILE_STORAGE_DRIVER=local
```

For S3-compatible storage, configure:

```text
FILE_STORAGE_DRIVER=minio
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_BUCKET=ailaoda-files
S3_ACCESS_KEY_ID=<access key>
S3_SECRET_ACCESS_KEY=<secret key>
S3_FORCE_PATH_STYLE=true
```

Optional MinIO rehearsal service:

```powershell
$env:S3_ACCESS_KEY_ID = '<minio access key>'
$env:S3_SECRET_ACCESS_KEY = '<minio strong secret>'
docker compose --profile object-storage up -d minio
npm run audit:storage:abstraction
```

The application keeps authenticated `/uploads/contracts/:filename` and `/uploads/pod/:filename` URLs stable. With S3/MinIO enabled, objects are fetched through the storage provider into a controlled cache before the existing protected download route serves them.

## Meilisearch Candidate Search

Prisma fallback search remains the default:

```text
SEARCH_DRIVER=prisma
```

For customer/order list candidate ID recall through Meilisearch:

```text
SEARCH_DRIVER=meilisearch
MEILISEARCH_URL=http://meilisearch:7700
MEILISEARCH_API_KEY=<strong search key>
SEARCH_INDEX_PREFIX=ailaoda
```

Optional local Meilisearch rehearsal service:

```powershell
$env:MEILISEARCH_API_KEY = '<strong search key>'
docker compose --profile search up -d meilisearch
npm run audit:search:boundary
```

Expected index names:

```text
ailaoda_customers
ailaoda_orders
```

Meilisearch only returns candidate record IDs. The backend still applies Prisma business filters, pagination, and data-scope permissions before returning records. A production search rollout still needs indexer/backfill jobs, freshness monitoring, ranking rules, and permission-aware document design.

## Prometheus / Grafana Observability

The backend keeps `/metrics` permission-protected. Docker mounts the same one-line secret file into the app and Prometheus; Prometheus reads it through `credentials_file`. Administrator JWT access remains available for manual diagnostics.

Required observability rehearsal environment:

```text
AILAODA_METRICS_BEARER_TOKEN_FILE=./runtime-secrets/metrics-bearer-token.txt
GRAFANA_ADMIN_PASSWORD=<strong grafana password>
PROMETHEUS_PORT=9090
GRAFANA_PORT=3001
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_SERVICE_NAME=ailaoda-erp-crm
```

Create the referenced file before starting Compose. It must contain only the randomly generated bearer token and must not be committed. Native non-Docker runs may use `AILAODA_METRICS_BEARER_TOKEN` directly.

Start the optional stack:

```powershell
docker compose --profile observability up -d prometheus grafana otel-collector
npm run audit:observability:stack
```

Provisioned files:

```text
ops/prometheus/prometheus.yml
ops/prometheus/rules/ailaoda-alerts.yml
ops/grafana/provisioning/
ops/grafana/dashboards/ailaoda-overview.json
ops/otelcol/config.yml
```

Grafana URL:

```text
http://127.0.0.1:3001/
```

The backend also emits W3C `traceparent` and `X-Request-Id` headers and records trace IDs in request logs. This provides a rehearsal dashboard, starter alert rules, and an OTLP collector boundary. Production still needs token rotation, alert receivers, tuned thresholds, OpenTelemetry SDK spans/exporters, log aggregation, and trace storage.

## Distributed Sessions, Rate Limits, and Realtime

SaaS and multi-instance deployments require Redis. The PostgreSQL production compose provisions Redis with append-only persistence and password authentication.

Required environment:

```text
REDIS_PASSWORD=<strong URL-safe Redis password>
REDIS_URL=redis://:<URL-encoded password>@redis:6379/0
AUTH_TOKEN_STORE_DRIVER=redis
LOGIN_RATE_LIMIT_STORE=redis
REALTIME_BUS_DRIVER=redis
```

Local or private single-node packages may leave `REDIS_URL` empty and explicitly use `memory`. Never use the memory drivers for a load-balanced deployment.

Operational behavior:

- Refresh tokens are stored by SHA-256 hash and consumed once.
- Password changes advance a user session generation and revoke all older refresh tokens.
- Login and API rate-limit counters are shared by every application instance.
- Login protection uses a high-volume IP spray guard plus a stricter IP-and-username-hash guard, so users behind one corporate NAT do not consume each other's account budget.
- WebSocket events are delivered locally and fanned to other instances through Redis Pub/Sub.
- `/ready` and `/health` return `503` when configured Redis is unavailable.

Verification:

```powershell
npm run audit:security:distributed-auth
npm run audit:realtime:notifications
npm run audit:security:production-readiness
```
