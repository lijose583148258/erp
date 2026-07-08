# Changelog

All notable changes should be recorded here. Use this file for user-visible,
operator-visible, and architecture-relevant changes.

## Unreleased

### Added

- Engineering production-readiness audit command.
- Research note for executive dashboard, Smart Filters, and mobile data views.
- Production-readiness roadmap.
- ADR process seed for research-first operating brain work.
- Contribution guide with validation expectations.
- TanStack Query server-state provider and Dashboard query-key migration.
- Shared Dashboard read-model contract and dashboard contract audit.
- Zustand Dashboard UI store and client-state audit.
- Vitest, Testing Library, jsdom, and frontend test foundation audit.
- EnterpriseDataGrid virtualized-row baseline and virtualized list audit.
- Mobile card data-view baseline for `EnterpriseDataGrid` and legacy `DataTable`.
- Dashboard backend generated contract sync and compile-time response binding.
- Dashboard backend repository/service read-model boundary.
- Dashboard OpenAPI response schemas and frontend service contract tests.

### Changed

- Dashboard overview and trend reads now use the shared server-state query layer.
- Dashboard frontend service now imports shared contract types instead of
  declaring local response interfaces.
- Dashboard backend route now compiles overview and trend responses against the
  generated Dashboard contract mirror, including ISO string dates for recent
  order timestamps.
- Dashboard route now delegates overview and trend reads to
  `dashboard-read.service.ts`, with Prisma query ownership isolated in
  `dashboard.repository.ts`.
- `docs/openapi.yaml` now documents concrete Dashboard overview and trend
  response schemas, and `services/dashboard.service.test.ts` covers the
  frontend Dashboard service contract/fallback behavior.
- Backend cache dependencies now use `ioredis` as the single Redis client,
  removing the unused duplicate `redis` package from the backend manifest and
  lockfile.
- Dashboard UI snapshots, tasks, inventory alerts, system status, chart data,
  and chart layout now use a scoped store instead of local component state.
- Frontend unit testing now runs Vitest/Testing Library before the existing
  lightweight runner.
- Upgraded root `axios` to reduce production dependency audit findings.

### Known Gaps

- SQLite remains the default runtime database artifact.
- Frontend strict TypeScript is not enabled.
- Smart Filter contract is not implemented yet.
- Mobile card data view is not implemented yet.
- Executive dashboard metrics are still partial.
- Scoped client state is only proven for Dashboard so far; broad AppContext
  responsibility reduction remains pending.
- Frontend test foundation is present, but coverage is still narrow and must
  expand to forms, table filters, mobile cards, and dashboard store behavior.
- Shared contracts are still route-limited: Dashboard now has frontend and
  backend compile-time adoption through a generated mirror, but additional
  routes still need generated/shared response contracts.
- Backend layering is still partial: Dashboard reads have a repository/service
  boundary, but broader controllers/routes still need direct-Prisma migration.
- Production dependency audit still reports non-TanStack residual findings in `xlsx` and transitive packages from existing dependencies.
- Cache strategy is defined and the Redis client dependency is now unified, but
  read-heavy module adoption and focused cache behavior tests are still pending.
- Virtualized rows are now available in `EnterpriseDataGrid`, but adoption is
  intentionally limited to local client-side pages; server-paged business
  tables still need route-level browser evidence before broad rollout.
- Mobile card rendering now exists at the shared table layer, but route-specific
  card slots and mobile screenshots still need to be added for sales,
  warehouse, collections, and procurement workflows.
