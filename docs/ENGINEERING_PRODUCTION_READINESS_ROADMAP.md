# Engineering Production Readiness Roadmap

This roadmap turns the current source evidence and product research into
sequenced implementation work. It keeps PRs small enough to validate while
still moving toward the full production-grade ERP/CRM goal.

## Scope

The objective is to improve the engineering foundation, production readiness,
and modern web baseline of AilaoDa ERP/CRM.

This roadmap covers:
- production database direction
- TypeScript strictness
- frontend source layout and shared contracts
- state and server-state management
- OpenAPI and frontend test foundation
- executive dashboard, Smart Filters, mobile data cards
- production readiness, security, ADRs, and collaboration docs

## Evidence Baseline

Repeatable audit:

```powershell
npm run audit:engineering:readiness
```

Current report:

```text
output/audit/engineering-production-readiness-v1.json
output/audit/engineering-production-readiness-v1.md
```

Research note:

```text
docs/PRODUCT_RESEARCH_EXECUTIVE_DASHBOARD_FILTERS_MOBILE.md
```

Engineering reference research:

```text
docs/ENGINEERING_PRODUCTION_OPEN_SOURCE_RESEARCH.md
```

Agent collaboration playbook:

```text
docs/AGENT_COLLABORATION_PLAYBOOK.md
```

Integration spec:

```text
docs/EXECUTIVE_DASHBOARD_FILTER_MOBILE_INTEGRATION_SPEC.md
```

Important corrections from source evidence:
- Dashboard already has a Recharts revenue trend chart and trend API.
- Route-level lazy loading already exists through `app/appContent.tsx`.
- `PageErrorBoundary` already wraps lazy page rendering.
- Vite already uses manual chunks for icons, charts, spreadsheet, HTTP, and
  motion dependencies.
- Backend already exposes `/metrics`, `/health`, `/ready`, and `/livez`.
- Helmet CSP exists, but still allows inline script/style and has no CSRF
  strategy.
- PWA/service worker is intentionally disabled through `/sw.js`.

## PR Sequence

### PR-A: Evidence And Governance

Goal:
Make the production-readiness gaps repeatable and reviewable.

Deliverables:
- `audit:engineering:readiness`
- `audit:business-filters`
- engineering readiness report JSON/Markdown under `output/audit`
- product research note for dashboard/filter/mobile patterns
- engineering reference research for production runtime, contracts, tests,
  observability, search, cache, and storage
- integration spec for shared filter state, dashboard drill-down, and mobile cards
- this roadmap
- first ADR directory and architecture decision records
- CONTRIBUTING and CHANGELOG foundations

Validation:
- `node -c scripts/engineering-production-readiness-audit-v1.cjs`
- `npm run audit:business-filters`
- `npm run audit:engineering:readiness`
- `npm run typecheck`
- `npm run build`

### PR-B: Smart Filter Table Contract

Goal:
Move from keyword-only search toward SAP Fiori/Odoo-style Smart Filters while
keeping the current AilaoDa table design.

Deliverables:
- typed filter definitions for `EnterpriseDataGrid`
- filter state model with `text`, `dateRange`, `numberRange`, `amountRange`,
  `multiSelect`, `entitySelect`, and `boolean`
- URL-serializable filter state
- client-side filtering for small local data
- manual server-side filter passthrough for large ERP lists
- focused tests for filter state and render behavior

Recommended first surfaces:
- sales orders
- collections
- warehouse stock balances
- procurement

Validation:
- `npm run typecheck`
- frontend unit tests for filter state
- targeted browser audit for one high-value filtered route

### PR-C: Mobile Data Card View

Goal:
Stop treating mobile data views as squeezed desktop tables.

Current baseline:
- `EnterpriseDataGrid` and legacy `DataTable` now render automatic mobile
  record cards on small viewports while keeping the desktop table at `md` and
  wider breakpoints.
- Both table primitives expose optional mobile slots for custom primary text,
  secondary text, status, metadata, actions, and full custom card rendering.
- `audit:mobile-card-data-view` verifies both primitives, interaction parity
  markers, mobile/desktop viewport switching, exported mobile types, and
  readiness-audit coverage.

Deliverables:
- `mobileCard` or equivalent renderer in `EnterpriseDataGrid`
- default mobile card slots: primary, secondary, metadata, status, actions
- first mobile card adoption in sales orders or warehouse
- browser screenshots for desktop and mobile viewports

Validation:
- `npm run audit:mobile-card-data-view`
- `npm run typecheck`
- targeted browser screenshot audit for mobile record lists
- no regression to desktop table behavior

### PR-C2: Virtualized Dense Lists

Goal:
Keep dense local ERP/CRM lists responsive without replacing server-side
pagination for large business datasets.

Current baseline:
- `EnterpriseDataGrid` uses `@tanstack/react-virtual` for local page data above
  a configurable row threshold.
- Virtualization is disabled when `manualPagination` and server paging are in
  use, so customer/order-scale datasets still rely on backend paging.
- `audit:virtualized-lists` verifies the dependency, component adoption,
  scroll-container evidence, server-paging guard, and readiness-audit coverage.

Validation:
- `npm run audit:virtualized-lists`
- `npm run audit:engineering:readiness`
- `npm run typecheck`

### PR-D: Executive Operating Dashboard

Goal:
Turn Dashboard from an operational hub into an executive operating cockpit.

Deliverables:
- dashboard API contract for executive summary
- revenue/profit trend with YoY and MoM comparison
- cash forecast
- receivables aging heatmap
- customer segmentation and retention/repurchase metrics
- KPI drill-down links into filtered business lists
- mobile owner summary for a 3-minute daily review

Implementation rule:
Start with API contracts and deterministic read models. Avoid embedding a BI
platform directly into the app.

Validation:
- backend read-model tests or API audits
- browser audit for executive dashboard desktop and mobile
- screenshot evidence for KPI drill-down path

### PR-E: Frontend Test Foundation

Goal:
Add component-level regression coverage around shared UI primitives.

Current baseline:
- Vitest is configured in `vitest.config.ts` with jsdom and
  `tests/setup.ts`.
- `test:frontend:unit` now runs Vitest first, then the existing lightweight
  unit-test runner so earlier StatusBadge regression checks are preserved.
- `components/ui/StatusBadge.test.tsx` is the first Testing Library component
  test and verifies semantic status/risk evidence in rendered DOM.
- `audit:frontend-tests` verifies dependencies, config, setup, npm scripts,
  and Testing Library adoption together.

Deliverables:
- Vitest
- Testing Library
- jsdom
- tests for status badge logic, table filters, mobile cards, and dashboard KPI
  cards

Validation:
- `npm run audit:frontend-tests`
- `npm run test:frontend:unit`
- `npm run typecheck`
- existing browser audits remain green

### PR-F: OpenAPI And Shared Contracts

Goal:
Stop relying on implicit frontend/backend contracts.

Current baseline:
- Dashboard now has a shared read-model contract in
  `shared/contracts/dashboard.ts`.
- `services/dashboard.service.ts` imports the shared Dashboard response types
  instead of declaring frontend-only interfaces.
- `audit:dashboard:contract` checks that the frontend adopts the shared
  contract and that `backend/src/routes/dashboard.routes.ts` still emits the
  expected fields.
- This remains partial evidence until the backend also compiles against a
  shared/generated contract package. The current backend tsconfig is scoped to
  `backend/src`, so a safe generated package/rootDirs change should be handled
  deliberately.

Deliverables:
- OpenAPI generation or maintained OpenAPI artifact
- route inventory coverage
- Zod/OpenAPI response contracts for high-value modules
- generated or shared frontend types

Validation:
- OpenAPI lint/generation command
- `npm run audit:dashboard:contract`
- typecheck
- one frontend service migrated to generated/shared contract types

### PR-G: PostgreSQL Runtime Track

Goal:
Create a real production database path without breaking local SQLite flows.

Deliverables:
- PostgreSQL-specific Prisma provider/runtime artifact
- Docker Compose PostgreSQL service
- migration and seed strategy
- backup/restore validation against PostgreSQL
- rollback plan and runtime guard updates

Validation:
- `npm run prisma:validate`
- PostgreSQL migration probe
- backend build
- backup/restore audit
- business-chain API audit on PostgreSQL runtime

### PR-H: State And Server-State Layer

Goal:
Reduce global React context pressure and make server data predictable.

Current baseline:
- TanStack Query is mounted through `app/ServerStateProvider.tsx`.
- Dashboard overview and trend reads use query keys instead of ad hoc
  request state.
- Dashboard UI snapshots, task list, inventory alerts, system status, chart
  data, and chart layout are now owned by `stores/dashboardUiStore.ts`.
- `audit:client-state` verifies that a state-library dependency is paired
  with a real scoped store and Dashboard adoption. This avoids dependency-only
  false positives.

Deliverables:
- TanStack Query provider; first baseline is mounted in `app/ServerStateProvider.tsx`
- one read-heavy module migrated to query keys; first baseline covers Dashboard overview and trend reads
- invalidation after writes for the next migrated business module
- one scoped client store for high-churn UI state
- no broad rewrites before module proof

Validation:
- `npm run audit:client-state`
- frontend unit tests for query/store behavior
- targeted browser read/write/read-back audit

### PR-I: Production Operations

Goal:
Cover the remaining上线后爆点.

Deliverables:
- API versioning `/api/v1`
- storage abstraction with local and S3/MinIO adapters
- cache strategy with one Redis client
- OpenTelemetry trace pipeline
- search/read-model strategy after PostgreSQL
- JSON field normalization plan and migrations

Validation:
- release verification profile
- observability smoke
- file upload/read-back audit
- API compatibility audit

### PR-J: Security And Collaboration

Goal:
Make security and team practice explicit.

Deliverables:
- CSRF strategy
- CSP hardening plan
- MFA/TOTP design and privileged-role rollout
- managed secret provider adapter
- ADRs for major architecture choices
- CONTRIBUTING and CHANGELOG process
- webhook and SDK strategy after OpenAPI

Validation:
- auth/security API audits
- static config audit
- docs review checklist

## Product Research Conclusions

Do:
- use ERPNext/Odoo as references for ERP dashboard/list habits
- use SAP Fiori ALP as a reference for KPI, visual filters, and drill-down
- use Superset/Metabase as references for semantic metrics and dashboard
  filters
- use React-admin and TanStack as implementation references for React list
  state, mobile list/card rendering, filters, and virtualization

Do not:
- embed a full BI platform before defining canonical metrics
- replace the current table design wholesale
- enable service worker/offline mode before writing stale-data rules
- migrate PostgreSQL in the same PR as dashboard/filter/mobile UI work

## First High-Return Implementation Slice

After this research PR, the safest high-return slice is `PR-B Smart Filter
Table Contract`.

Reason:
- It is smaller than the dashboard rebuild.
- It directly improves sales, warehouse, procurement, collections, and finance.
- It creates the filter model needed for executive KPI drill-down.
- It sets up mobile cards and dashboard drill-down to share one filter state.

Recommended first implementation:
- add `filterDefinitions` and `filterState` to `EnterpriseDataGrid`
- support `dateRange`, `numberRange`, and `multiSelect`
- add one adoption in sales orders or collections
- add focused unit tests before broad rollout
