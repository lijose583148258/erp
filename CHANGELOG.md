# Changelog

All notable changes to this project should be recorded here.

The format follows a pragmatic Keep a Changelog style. Dates use `YYYY-MM-DD`.

## Unreleased

### Added

- Versioned API namespace foundation for `/api` and `/api/v1`.
- Baseline OpenAPI JSON and docs endpoints.
- Browser Web Vitals RUM ingestion and Prometheus aggregation.
- Protected file storage boundary with local and S3/MinIO-compatible provider support.
- PostgreSQL Prisma artifact probe for production database migration readiness.
- PostgreSQL rehearsal compose boundary with required password, healthcheck, and guardrails against connecting the current SQLite app artifact.
- PostgreSQL server artifact build and audit boundary that rewires the copied backend dist to the generated PostgreSQL Prisma client.
- PostgreSQL raw SQL compatibility audit that fails unclassified SQLite-only SQL and records P2 raw SQL review items after the P1 blocker set is cleared.
- PostgreSQL migration rehearsal audit and runbook covering preflight, final SQLite backup, snapshot export, PostgreSQL rehearsal, route smoke tests, rollback triggers, and explicit non-claims.
- Structured PostgreSQL migration plan/snapshot/manifest/dry-run-import/rollback evidence reports under `output/audit/` from `npm run db:pg -- ...`.
- Added `npm run db:pg -- import` to load a migration snapshot into a provisioned PostgreSQL rehearsal database and emit `output/audit/postgres-migration-import-v1.json`.
- Added `npm run audit:db:postgres-import-rehearsal` to validate PostgreSQL import evidence against the latest snapshot and manifest.
- Added `npm run run:db:postgres-import-rehearsal` to orchestrate schema push, snapshot import, and import-audit in one rehearsal window.
- Stock entry source idempotency constraint for PostgreSQL-compatible create/conflict handling.
- Unified cache boundary with optional Redis, memory fallback, health visibility, and cache metrics.
- CSRF/session boundary for the current Bearer-token-only API authentication model.
- Secret management boundary for JWT secret quality checks and redacted readiness metadata.
- MFA login gate for configured roles using TOTP verification.
- Generated module-level TypeScript API SDK under `sdk/ailaoda-api-client.ts`.
- Generated shared base API contract under `shared/api-contract.ts` for namespaces, response envelopes, pagination metadata, and route modules.
- Endpoint-specific OpenAPI/SDK DTO boundary for high-frequency customer, order, and collection overdue list queries.
- Conservative PWA offline shell with Service Worker registration and network-only API/upload/metrics boundaries.
- Frontend server-state client with deterministic query keys, in-flight dedupe, TTL reuse, invalidation, and sales order plus collection center adoption.
- Zustand client-state store boundary for shell session, preference, notification, and command-palette state while preserving the existing AppContext facade.
- Frontend runtime resilience audit for root/page error boundaries and route-level lazy-loaded pages.
- Frontend bundle budget audit for entry, route/module, vendor, spreadsheet, CSS, and total build assets.
- Production dependency security audit with npm overrides for runtime advisories and a zero-vulnerability production audit gate.
- Authenticated `/ws/notifications` realtime channel for order and payment workflow notifications.
- Signed outbound webhook boundary for order and payment lifecycle events.
- Shared `EnterpriseDataGrid` virtual row window for large loaded pages.
- Search provider boundary for customer/order Prisma fallback search plus Meilisearch candidate ID recall, metrics, health status, and optional compose rehearsal.
- Prometheus/Grafana/OpenTelemetry observability stack profile with protected metrics scraping, starter alert rules, trace context headers, and an AilaoDa overview dashboard.
- Frontend strict TypeScript ratchet through `tsconfig.strict.json` and `npm run typecheck:strict`.
- Customer read service boundary for CRM list/stat queries.
- Frontend unit-test command for selected UI/helper coverage.
- High-frequency customer/order list query audit.
- ADRs for API versioning, file storage, PostgreSQL artifact probing, unified cache, CSRF/session boundary, secret management, MFA, generated API SDK, PWA offline shell, frontend server-state, realtime notification, outbound webhook, virtualized grid, search provider, frontend strict TypeScript ratchet, backend read service layering, shared API contract generation, frontend client-state store, production dependency security, frontend runtime resilience, frontend bundle performance budget, PostgreSQL deployment boundary, PostgreSQL server artifact, PostgreSQL raw SQL compatibility, and PostgreSQL migration rehearsal decisions.

### Changed

- Customer and order list query contracts now cap `pageSize` at 100.
- Legacy customer/order `getAll` service calls now behave as limited first-page snapshots instead of hidden large-window fetches.
- Sales order workspace now preserves server pagination metadata and discloses loaded-page scope.
- Docker runtime hardening now uses non-root execution and reduced container privileges.
- CSP defaults no longer rely on inline script/style allowances.
- Spreadsheet imports now reject unsupported extensions and files larger than the configured 2 MB client-side parsing limit.
- Spreadsheet import/export paths now use `exceljs` behind a shared browser IO helper instead of the no-fix `xlsx` package.
- Root and page-level error fallbacks now show actionable, non-garbled recovery UI and record client issues.
- File storage can now use `FILE_STORAGE_DRIVER=s3` or `minio` while preserving protected `/uploads/...` URLs.
- Customer and order list search can use Meilisearch candidate IDs while preserving Prisma-side business filters and data-scope permissions.
- Observability rehearsal can provision Prometheus and Grafana without making `/metrics` public.
- Backend requests now emit W3C `traceparent` and `X-Request-Id` headers for log/client correlation.
- Auth login, customer address/contact persistence, supplier creation, authorization policy seeding, commercial workflow/notification creation, stock entry creation, and inventory cost ledger adjustment creation moved representative SQLite raw SQL writes behind Prisma APIs.
- Commercial workflow/notification runtime tables and authorization policy migration markers are now represented in Prisma schema for PostgreSQL artifact generation.
- Dynamic RBAC Casbin policy loading and barter stock reversal replay now use Prisma relation reads instead of raw joins.
- Authorization role/permission management and commercial workflow/readiness/BI summary operations now use Prisma model APIs instead of raw SQL.
- Inventory stock movement and inventory cost ledger read/write paths now use Prisma model, relation, and aggregate APIs instead of raw SQL.
- PostgreSQL raw SQL compatibility reports now distinguish portable reviewed raw SQL files from remaining P2 review files; the current P2 review count is zero.
- Deployment readiness now requires the PostgreSQL migration rehearsal boundary in addition to PostgreSQL artifact, server artifact, and raw SQL compatibility gates.

### Security

- Default demo credentials are guarded in release safety mode.
- Metrics endpoint access is permission-protected.
- Token-like cookie API authentication without Bearer auth is rejected.
- Missing or placeholder production JWT secrets are rejected through a central secret boundary.
- Configured high-privilege roles can require MFA before access or refresh tokens are issued.
- Fixable production dependency advisories for Axios, protobuf, WebSocket, multipart form, and glob matching chains are constrained through direct upgrades and npm overrides.
- Production `npm audit --omit=dev` now passes with zero reported vulnerabilities.

### Still Pending

- Live PostgreSQL data import rehearsal, same-window rollback execution, PostgreSQL backup/restore verification, and route-level smoke tests against the PostgreSQL server artifact.
- Full frontend strict TypeScript rollout beyond the current ratchet include set.
- Backend service-layer rollout beyond CRM customer reads.
- Endpoint-specific generated API DTO boundary beyond the customer/order/collection overdue read contracts.
- Broader direct Zustand selector adoption beyond the shell-level AppContext compatibility facade.
- Broad frontend server-state rollout beyond the sales order and collection center workspaces.
- External search indexer, permission-aware document model, reindex jobs, freshness monitoring, and ranking for large customer/order/SKU datasets.
- Object-storage retention policy, bucket lifecycle rules, signed direct-upload URLs, and deployment-specific bucket provisioning.
- Observability token rotation, alert notification routing, environment-specific thresholds, OpenTelemetry SDK spans/exporters, log aggregation, and trace storage.
- Browser route timing budgets and mobile-specific list renderers for dense ERP grids.
- Per-user MFA enrollment/recovery and external secret-manager provider integration.
- Broader endpoint-specific DTO SDK generation and durable webhook retry/dead-letter management.
- Per-module offline read/write rules, stale-data labeling, and conflict handling beyond the shell fallback.
- CONTRIBUTING ownership expansion for release management and long-term maintainership.
