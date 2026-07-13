# Commercial ERP/CRM UI/UX Audit PR2

This PR adds the commercial UI/UX audit layer only. It uses the PR1 isolated parallel Playwright runner as the browser execution foundation and adds route configuration, scoring, evidence indexing, and report generation for commercial ERP/CRM readiness review.

Research-first input:

```text
docs/COMMERCIAL_UI_UX_OPEN_SOURCE_RESEARCH.md
```

The audit criteria should use mature ERP/CRM, BI, and admin references as pattern evidence, not as a request to embed another product or implement roadmap items inside PR2.

## Research And Agent Support

Use only installed local skills and bounded read-only subagents for PR2 research support.
Do not install external agent frameworks, prompt packs, npm packages, GitHub
scripts, or browser extensions for this PR.

Installed local PR2 skills:

- `.agents/skills/erp-commercial-product-manager`: turns ERP/CRM/BI research
  into scoped audit criteria, business impact, and future PR sequencing.
- `.agents/skills/erp-enterprise-ui-designer`: reviews dashboards, tables,
  Smart Filters, mobile layouts, dark mode, accessibility, and mojibake risk.
- `.agents/skills/erp-team-rd-coordinator`: enforces PR scope, validation
  order, directory hygiene, and no-PR1/no-stash boundaries.
- `.agents/skills/erp-codebase-scout`: performs read-only route, component,
  script, package command, and evidence-path reconnaissance before edits.
- `.agents/skills/erp-enterprise-software-delivery`: adds enterprise software
  delivery discipline for architecture, security, observability, release gates,
  dependency safety, and evidence-first engineering.
- `.agents/skills/erp-ai-feature-governance`: governs internal AI assistant,
  OCR, Smart Form Fill, import parsing, external model privacy gates, role
  isolation, red-team tests, and AI evidence reporting.
- `.agents/skills/erp-evidence-first-reasoning`: aligns PR2 work with
  Claude/Fable-like planning habits that are locally verifiable: claim,
  evidence, planner/executor/verifier separation, false-green traps, scoped
  edits, exact verification, and directory-state reporting.

Existing trusted local skills for PR2:

- `erp-ui-audit`: route shell, language, layout drift, state rendering, and
  screenshot evidence.
- `erp-audit-roles`: role boundaries, evidence templates, timeout/stop rules,
  and recovery escalation.
- `erp-anti-hallucination-review`: prevents false-green claims from build-only
  or screenshot-only evidence.
- `frontend-skill`: use only its app/product UI and utility-copy guidance for
  enterprise surfaces; do not apply landing-page hero patterns to ERP screens.
- `erp-system-architecture`: use only for read-only product architecture
  framing when an audit finding implies dashboard, filter, mobile, or BI
  contract work in a later PR.
- `security-best-practices`: use for dependency, CSP/CSRF, storage, service
  worker, secret, upload, and supply-chain guardrails.

This PR does not install third-party agent packages. The seven PR2 skills above
are repository-local and inspectable, with lightweight `agents/openai.yaml`
metadata for Codex discovery. This PR run also reads and applies their
`SKILL.md` files directly before making scoped audit changes.

Enterprise software development research conclusion:

- Prefer local skills and bounded role agents over unknown prompt packs or agent
  frameworks.
- Useful enterprise roles for this project are product owner, enterprise
  architect, UI/product designer, QA/release engineer, security/SRE reviewer,
  codebase scout, evidence-first verifier, and AI feature governance reviewer.
- Official Codex and Claude-style skill/subagent/hook patterns support local
  skills, specialized agents, tool restrictions, lifecycle guardrails,
  planner/executor/verifier separation, trace/eval evidence, and review before
  stateful action. PR2 absorbs those patterns as local reasoning and audit
  criteria, not as a new runtime dependency.
- No exact, locally verifiable `claude-fable 5` skill was found. PR2 therefore
  uses `erp-evidence-first-reasoning` as the safe mapped implementation of the
  requested thinking style and avoids claiming proprietary compatibility.

Allowed subagent roster:

- Product R&D / PM explorer: compare mature ERP/CRM/BI patterns, define audit
  criteria, and identify non-goals.
- Enterprise UI/UX explorer: inspect route evidence requirements, desktop and
  mobile table/list behavior, dark-mode contrast, and design-system drift.
- Codebase integration explorer: read only the local PR2 files, package scripts,
  route config, and runner integration points to keep the implementation
  boundary clean.
- Security/SRE explorer: keep dependency and evidence collection safe, and
  verify PR2 does not cross into PR1, backend/base, or engineering-readiness
  work.
- Evidence-first verifier: re-check claims against files, command output,
  reports, screenshots, and `git status` before PR2 readiness language is used.

Subagent constraints:

- read-only unless a future task grants a narrow, disjoint write set
- no package installs
- no external agent runtime
- no CI workflow edits
- no runner foundation edits
- no backend/base fixes
- no stale stash restoration
- main controller must inspect all conclusions and rerun relevant audit
  commands before marking PR2 ready

Rejected support sources:

- unknown GitHub "agent packs", npm agent frameworks, browser extensions, or
  pasted shell installers
- any tool that requires secrets, GitHub write access, or broad filesystem
  mutation to perform a read-only product/UI audit
- any generated code or prompt bundle that cannot be traced to this repository
  or to official project documentation

## Audit Roles

PR2 should organize findings by audit role. These roles are research and
evidence lenses; they do not authorize product implementation in this PR.

| Role | Checks | Required evidence |
|---|---|---|
| `executive-cockpit-auditor` | Whether dashboard answers owner questions: sales, cash, AR aging, inventory risk, production bottleneck, CRM health, exception backlog, customer concentration, YoY/MoM, drill-down | route, viewport, screenshot, visible KPIs, chart/list evidence, missing KPI list |
| `data-grid-auditor` | Table density, search, sort, pagination, column visibility, export, numeric alignment, sticky columns/actions, row actions, empty/loading/error states, long text handling | desktop and mobile screenshots, matched text, console/page/network failures |
| `smart-filter-auditor` | Date range, amount range, status multi-select, customer/SKU/warehouse/owner facets, selected chips, clear/apply, URL state, saved view readiness, permissions consistency | filter UI evidence, route query/hash state, before/after screenshot |
| `mobile-ops-auditor` | Whether mobile uses business cards or task-shaped layout instead of squeezed desktop tables; touch filters; bottom navigation; sticky element overlap | 375px/390px screenshots, table overflow note, touch-target and card readability evidence |
| `a11y-theme-auditor` | WCAG contrast, focus visibility, accessible names, keyboard flow, chart meaning not color-only, reduced motion, light/dark, zh/en/vi text readability and mojibake | theme/language screenshots, contrast notes, mojibake findings, focus/state notes |

Known PR2 audit warning:

- Dashboard should be graded as partial, not absent, because current local
  source already includes a trend chart path.
- A chart screenshot is not enough to mark the executive cockpit mature.
- Chinese, English, and Vietnamese text readability must be checked; mojibake
  is a commercial UI/UX blocker even when the route renders.
- Do not fabricate business data for the report. If a source metric is missing,
  report `unavailable` or `not implemented`.

## Research-To-Audit Criteria

PR2 uses mature ERP/CRM, BI, and enterprise design references as scoring
criteria, not as dependencies. These criteria are stored in:

```text
scripts/audit-routes/commercial-erp-crm-ui-ux-routes.cjs
```

The automated route score remains an evidence-health gate. Product maturity is
a second review layer and must be judged from screenshots, route state, visible
text, and missing-capability notes.

| Dimension | Criteria IDs | Mature references |
|---|---|---|
| Executive cockpit | `DASH-01` to `DASH-04`, `METRIC-01`, `ROLE-01`, `FLOW-01` | SAP Fiori Analytical List Page, ERPNext dashboards, Metabase/Superset filters and drill-through, CFO dashboard patterns |
| Smart Filter | `FILTER-01` to `FILTER-04` | Odoo Search/Favorites, SAP Fiori Filter Bar, MUI X/AG Grid/TanStack typed filters |
| Mobile operations | `MOBILE-01` to `MOBILE-04` | React-admin mobile lists, SAP Fiori responsive tables, PatternFly mobile toolbar guidance, Power BI mobile owner summaries |
| Accessibility/theme/language | `DARK-01` to `DARK-02`, `A11Y-01`, `LANG-01` | WCAG 2.2 contrast and non-text contrast, SAP Fiori accessibility guidance, multilingual ERP text hygiene |
| Enterprise table | `TABLE-01` to `TABLE-03` | Carbon Data Table, AG Grid, Ant Design alignment, Material data tables, large-data/server-side table patterns |
| Import UX | `IMPORT-01` to `IMPORT-02` | Odoo import/export, ERPNext data import validation |
| AI governance and assistant UX | `AI-01` to `AI-06` | Local AI-first policy, external model privacy gates, role isolation, human-in-loop OCR/import, command-bar planner/executor/verifier, AI analytics source links, red-team evidence |
| State, policy, and report hygiene | `STATE-01`, `POLICY-01`, `REPORT-01` | Enterprise empty/error/no-permission states, PWA/offline stale-data policy, anti-false-green audit reporting |

Route config binds applicable `criteriaIds`, required evidence, action evidence,
and sampling notes to each route. A route-health score cannot satisfy a product
criterion unless the report also contains the required manual evidence or an
explicit unavailable/unsampled marker.

`DARK-01` and `DARK-02` are bound into route criteria because theme contrast is
commercial UI/UX evidence, not a purely visual preference. `MOBILE-04` is
intentionally limited to `dashboard` and `financeAnalytics` mobile routes
because it audits the owner phone summary, while `MOBILE-01` to `MOBILE-03`
cover operational mobile record views.

Each product criterion is scored manually as:

- `0`: missing, misleading, or commercially unsafe
- `1`: present but incomplete or weakly evidenced
- `2`: mature enough for a commercial ERP/CRM operator

The optional `0-5` product dimension view is only a summary derived from those
criterion scores. It is not the same as the automated route-health score.

Hard caps:

- scope guard failure caps the run at `blocked`
- stale route, no screenshot, or fabricated KPI data caps the route at
  `blocked`
- screenshot-only evidence without product criteria review cannot exceed
  `watch`

## Route Evidence Coverage

The commercial route set should keep coverage focused on high-value ERP/CRM
surfaces. At minimum, report evidence should group these modules when present:

- `dashboard`
- `crm`
- `orders`
- `collections`
- `financeAnalytics` (`#financeAnalytics`)
- `contracts`
- `shipping`
- `discrepancies`
- `production`
- `warehouse`
- `procurement`
- `barter`
- `team`
- `audit`
- `settings`

AI-related commercial evidence should cover:

- global AI assistant drawer usability and refusal clarity
- Settings > AI Settings privacy gate and external model opt-in copy
- OCR, Smart Form Fill, and table import preview/human-confirmation behavior
- role-isolation evidence from existing AI regression and browser audit scripts
- explicit future implementation boundary for command bar and AI analytics

Each route evidence card should record:

- URL or hash route
- user role or seeded audit user
- locale and theme, or an explicit unsampled reason
- viewport
- screenshot path
- matched expected text
- console, page, and network failures
- issue category: executive dashboard, table/grid, smart filter, mobile,
  accessibility/theme, language/encoding, permission, stale route, or report
  hygiene
- severity and business impact

PR2 report aggregation should show findings by module, viewport, risk, and
issue type. A single total score is useful for tracking but is not enough for
product decisions.

Minimum sampling matrix:

- viewports: `desktop` 1440x900, `mobile-390` 390x844, `mobile-375` 375x812
- themes: light and dark, or explicit unsampled reason
- locales: zh, en, and vi, or explicit unsampled reason
- high-risk route notes: focus/accessibility, mobile overflow/card state, and
  filter/table action evidence where applicable

## Scope Guard

- commercial ERP/CRM UI/UX audit only
- uses PR1 isolated parallel Playwright runner as foundation
- may add audit route definitions, commercial-readiness scoring, evidence collection, screenshots, and report generation
- must not modify PR1 runner behavior unless required by PR2 audit and narrowly scoped
- must not include unrelated CI/base/backend fixes
- must not restore old mixed stash content

## Non-goals

- no PR1 runner foundation changes
- no CI workflow changes
- no backend/base/runtime refactor
- no SQLite to PostgreSQL migration
- no TypeScript strict-mode rollout
- no frontend directory restructuring or state-management replacement
- no business data write flow, approval, delete, cancel, or submit actions

The external AI audit notes about PostgreSQL, strict TypeScript, directory
restructuring, Zustand/TanStack Query, backend layering, OpenAPI, Docker
optimization, API versioning, realtime notifications, file storage, search,
cache, JSON normalization, CSRF/MFA, secret management, engineering docs,
SDK/webhook, RUM/Web Vitals, and frontend component tests are valid review
leads for future architecture work, but they are outside PR2. PR2 records that
disagreement as audit context and does not implement those architecture
recommendations.

## Engineering Readiness Follow-up Boundary

Source evidence checked during PR2 shows the engineering-readiness concern is
real, but several broad review claims need correction before they become
implementation tickets:

| Area | Current source evidence | PR2 decision | Future PR lane |
|---|---|---|---|
| Production database | Default runtime remains SQLite, but copied-schema PostgreSQL validation passes, `scripts/postgres-prisma-artifact-v1.cjs` generates an isolated PostgreSQL Prisma client artifact under `output/`, `docker-compose.postgres.yml` provides a PostgreSQL-only rehearsal database, `scripts/build-postgres-server-artifact-v1.cjs` builds a copied backend dist wired to the generated PostgreSQL Prisma client, `scripts/postgres-raw-sql-compat-audit-v1.cjs` reports zero P1 cutover blockers and zero P2 raw SQL review files, and `scripts/postgres-migration-rehearsal-audit-v1.cjs` gates the preflight/backup/snapshot/rollback runbook | Foundation added; do not claim production cutover yet | live PostgreSQL data import rehearsal, inventory/cost route smoke tests, same-window rollback execution, and PostgreSQL backup/restore verification |
| TypeScript strictness | root `tsconfig.json` has no full-app `strict`; `backend/tsconfig.json` already has `strict: true`; `tsconfig.strict.json` now gates selected frontend typed boundaries, including state, runtime error boundaries, virtual rows, realtime service, shared contract, and SDK files, through `npm run typecheck:strict` | Foundation added; do not claim full frontend strict completion yet | expand strict include list route by route, then move strict flags into root tsconfig |
| Frontend structure | root has `app/`, `components/`, `pages/`, `services/`, and excludes `src`; no canonical frontend `src/` tree | Do not move files in PR2 | staged `src/` migration with import aliases and active-source gates |
| Shared contracts | `shared/api-contract.ts` is generated from `backend/src/routes/apiRegistry.ts` for API namespaces, response envelopes, pagination metadata, route modules, and the first customer/order/collection overdue list DTOs; root `types.ts` still manually mirrors broader domain shapes while Prisma models live under `backend/prisma/models/*.prisma` | Foundation added; do not claim broad endpoint DTO completion yet | endpoint-specific generated API DTOs for payments, inventory, finance, and richer OpenAPI schemas |
| Backend layering | `backend/src/services/customer-query.service.ts` now owns CRM customer list/stat read logic and `OrderWorkspaceService` owns sales order reads; many remaining controllers still combine HTTP and data access | Foundation added | route-by-route service extraction with transaction/read-model tests |
| Client/server state | `app/serverState.ts` provides deterministic query keys, in-flight dedupe, TTL reuse, and invalidation; `app/clientState.ts` adds a Zustand shell-level client-state store; sales order workspace reads orders/customer lookup/active contracts through the server-state boundary, and collection center reads workbench/overdue search pages through the same boundary | Foundation added | broaden server-state adoption route by route and migrate performance-sensitive Context consumers to direct Zustand selectors |
| Route loading and errors | `app/appContent.tsx` uses `React.lazy` and `PageErrorBoundary` for active pages; `index.tsx` wraps the shell in `ErrorBoundary`; `scripts/frontend-runtime-resilience-audit-v1.cjs` and frontend unit tests cover actionable root/page fallbacks | Foundation added | browser-level fault injection for lazy import failures and production observability wiring for client issue reports |
| Large tables | `EnterpriseDataGrid` uses `@tanstack/react-virtual` for measured row virtualization and overscan on large loaded pages; `scripts/frontend-bundle-budget-audit-v1.cjs` enforces build asset budgets after Vite output; server pagination/search remains the main production path | Foundation added | browser route timing budgets, mobile-specific list renderers, and search/index strategy |
| PWA/offline | `public/app-pwa.js` registers `/sw.js`; `public/sw.js` caches only shell/static assets, excludes API/upload/metrics/health/readiness endpoints, and falls back to `public/offline.html` | Foundation added; do not cache ERP record data offline yet | stale-data labels, conflict handling, encrypted persistence, and mobile offline read/write rules |
| Observability | backend exposes protected `/metrics`, `/health`, `/ready`; browser RUM/Web Vitals collection posts to `/api/rum/vitals`; requests emit W3C `traceparent`/`X-Request-Id`; `docker-compose.yml` includes optional Prometheus/Grafana/OpenTelemetry Collector under the `observability` profile with starter alerts and `ops/grafana/dashboards/ailaoda-overview.json` | Foundation added; do not call production observability complete | token rotation, alert receivers, tuned thresholds, OpenTelemetry SDK spans/exporters, log aggregation, and trace storage |
| API versioning | active API modules are mounted under both `/api` and `/api/v1`; OpenAPI JSON is served from both namespaces, with typed customer/order/collection overdue list schemas under the stable v1 surface | Foundation added | deprecation policy and endpoint DTO expansion once more schemas are fully specified |
| Realtime collaboration | `backend/src/services/realtime-notification.service.ts` exposes authenticated `/ws/notifications`; order/payment mutation paths publish workflow events; frontend shell connects via `services/realtime.service.ts` | Foundation added | persisted delivery receipts, tenant-aware channels, heartbeat telemetry, and managed WebSocket scaling |
| File storage | `backend/src/services/file-storage.service.ts` defines `FileStorageProvider` with local and S3/MinIO-compatible providers; contract/POD writes and protected downloads use `fileStorage`; `docker-compose.yml` includes optional MinIO rehearsal under the `object-storage` profile | Foundation added | retention policy, bucket lifecycle rules, signed direct-upload URLs, and deployment-specific bucket provisioning |
| Search engine | `backend/src/services/search.service.ts` centralizes customer/order Prisma fallback search and Meilisearch candidate ID recall; customer/order lists still apply Prisma business filters and data-scope permissions; `docker-compose.yml` includes optional Meilisearch rehearsal under the `search` profile | Foundation added | external indexer/backfill jobs, permission-aware document model, freshness monitoring, ranking, and procurement/warehouse indexing |
| Unified cache | `backend/src/services/cache.service.ts` defines a unified cache boundary with optional Redis, memory fallback, Prometheus metrics, health visibility, and currency rate snapshot adoption | Foundation added | more read-model consumers, explicit invalidation tests, dashboard panels, and stale-data rules |
| JSON field normalization | several business fields are stored as JSON strings, including `addressesJson`, `contactsJson`, `evidenceJson`, `processJson`, `qualitySpecJson`, `ocrMetadata`, and `dataScopesJson` | Out of PR2 | typed JSON normalization or relational model split for high-risk domains |
| API documentation | OpenAPI JSON/docs are served for `/api` and `/api/v1`; `shared/api-contract.ts` and `sdk/ailaoda-api-client.ts` are generated from `backend/src/routes/apiRegistry.ts`; customer/order/collection overdue list reads now have endpoint-specific DTO helpers; `backend/src/services/webhook.service.ts` publishes signed order/payment lifecycle webhooks | Foundation added | broader endpoint request/response schemas, generated DTOs, and durable webhook retry/dead-letter management |
| Security collaboration | helmet CSP exists; `backend/src/security/csrfBoundary.ts` enforces the current Bearer-token-only CSRF/session boundary; `backend/src/security/secretManagement.ts` centralizes JWT secret checks; `backend/src/security/mfa.service.ts` adds a TOTP login gate for configured roles; `scripts/production-dependency-security-audit-v1.cjs` gates zero production dependency vulnerabilities and blocks no-fix `xlsx` usage | Partial foundation | per-user MFA enrollment/recovery, external secret-manager provider integration, and a new CSRF token design if the product moves to HttpOnly cookie sessions |
| Engineering docs | `CONTRIBUTING.md` and `CHANGELOG.md` exist; `docs/adr/` now records API/versioning, file storage, PostgreSQL artifact, unified cache, CSRF/session boundary, secret management, MFA login gate, generated SDK, PWA offline shell, frontend server-state, realtime notification, outbound webhook, virtualized grid, search provider, frontend strict TypeScript ratchet, backend read service layering, shared API contract generation, frontend client-state store, production dependency security, PostgreSQL deployment boundary, PostgreSQL server artifact, and PostgreSQL raw SQL compatibility decisions | Foundation added | release ownership, support policy, and module owner documentation |
| Frontend component tests | `test:unit:frontend` covers selected server-rendered UI/helpers and a React Testing Library/JSDOM proof that TanStack Virtual bounds mounted grid rows; broad route-level component coverage is still not present | Partial foundation | frontend component/unit test expansion for filters, dashboard states, mutation flows, and AI surfaces |

Recommended follow-up order after PR2:

1. Live PostgreSQL data import rehearsal, inventory/cost route smoke tests, same-window rollback execution, and PostgreSQL backup/restore verification.
2. Endpoint-specific OpenAPI DTO generation beyond the customer/order/collection overdue read contracts.
3. Frontend state rollout: broader server-state adoption plus direct Zustand selectors for high-churn shell consumers.
4. Frontend strictness and component/unit test foundation.
5. Web Vitals/RUM and API versioning after the contract boundary is stable.
6. Object-storage retention/direct-upload strategy, search/cache strategy, JSON normalization, realtime notifications, and MFA/security hardening.

PR2 uses this table only as evidence discipline. None of these future lanes is
implemented by the commercial UI/UX audit PR.

Evidence commands used for this boundary:

```powershell
rg -n "provider|sqlite|postgres|DATABASE_URL" backend/prisma Dockerfile backend/Dockerfile backend/src/config/runtime.ts
rg -n '"strict"' tsconfig.json backend/tsconfig.json
rg -n "React.lazy|PageErrorBoundary|Suspense" app components pages
rg -n "/api/v1|app\.use\(" backend/src/server.ts
rg -n "socket\.io|WebSocket|new WebSocket|EventSource|SSE" backend/src app components pages services package.json backend/package.json
rg -n "express\.static\(uploadDir|getUploadDir|/uploads|S3|MinIO|bucket" backend/src services components pages
rg -n "contains:|LIKE|search|index" backend/src services components pages app
rg -n "ioredis|redis|cache|PRAGMA cache_size" backend/src backend/package.json services components pages app
rg -n "Json|Json\?|String.*Json|addressesJson|contactsJson|evidenceJson|ocrMetadata|dataScopesJson" backend/prisma backend/src
rg -n "swagger|openapi|api-docs|webhook|sdk" docs backend/src package.json backend/package.json .github
rg -n "csrf|CSRF|helmet|contentSecurityPolicy|mfa|totp|two-factor|2fa|JWT_SECRET|secret manager|vault" backend/src backend/package.json package.json
rg -n "vitest|@testing-library|jest|describe\(|it\(|test\(" package.json backend/package.json app components pages services utils backend/src
```

## Commands

Start the governed runtime before browser evidence collection:

```powershell
npm run start:stable
```

Run the commercial UI/UX audit:

```powershell
npm run audit:commercial:ui-ux
```

The command sets `ISOLATED_PLAYWRIGHT_ROUTES_FILE` to:

```text
scripts/audit-routes/commercial-erp-crm-ui-ux-routes.cjs
```

It then runs:

```text
scripts/parallel-isolated-playwright-audit-v1.cjs
```

## Evidence Output

Each run writes to:

```text
output/commercial-ui-ux-audit/<runId>/
```

Required evidence:

- `commercial-ui-ux-report-v1.json`
- `commercial-ui-ux-report-v1.md`
- `summary.txt`
- `isolated-playwright/parallel-report.json`
- `isolated-playwright/worker-*/screenshots/*.png`
- `isolated-playwright/worker-*/report.json`

Generated evidence stays under `output/` and should not be committed.

## Route Evidence Health

The wrapper scores each configured route from the isolated runner evidence:

- route rendered expected text: 50 points
- screenshot captured: 20 points
- no console/page/network failures: 25 points
- route has commercial metadata: 5 points

Commercial weights come from the route config. Critical revenue, cash, inventory,
production, and permission modules carry higher weight than lower-risk review
surfaces.

This is an automated route evidence-health score. It proves route render,
screenshot, browser health, and metadata coverage. It does not prove product
readiness by itself.

Default pass threshold:

```text
COMMERCIAL_UI_UX_MIN_SCORE=85
```

Route evidence-health bands:

- `ready`: score >= 95
- `watch`: score >= threshold and < 95
- `blocked`: score < threshold

Product-readiness dimensions should use the `0/1/2` criterion scoring above.
A `0-5` dimension summary may be derived later for dashboarding, but PR2 must
keep it separate from route evidence health.

| Dimension | Evidence focus |
|---|---|
| Entry and shell | role, URL, menu path, language, route ownership, no stale entry drift |
| Owner cockpit | first-screen coverage of cash, sales, AR, inventory/production, CRM, exceptions |
| KPI quality | value, period, unit/currency, YoY/MoM, target or threshold, freshness, loading/empty/error |
| KPI drill-down | KPI to chart/list/detail path, preserved filters, traceable record IDs |
| Trend analysis | granularity, comparison, anomaly explanation, chart/table continuity |
| Cash and receivables | cash forecast, AR aging, overdue customers, credit risk, invoice/payment detail |
| Smart Filter | structured filters, selected chips, clear/apply, URL-safe state, permission consistency |
| Advanced table | pagination, sorting, search/filter, scale behavior, column controls, export boundaries |
| Import UX | template, mapping, preflight validation, failed-row evidence, duplicate/update policy |
| Mobile owner view | 375/390px readability, no overlap, core KPIs first, touch-friendly filters |
| States and exceptions | loading, empty, error, forbidden, timeout, NaN/undefined protection |
| Report hygiene | no mojibake, clear pass/fail semantics, collision-safe report fields, reproducible evidence |

## Environment Variables

| Variable | Default | Purpose |
|---|---:|---|
| `APP_URL` | `http://127.0.0.1:5001/` | ERP app URL |
| `COMMERCIAL_UI_UX_RUN_ID` | generated | Stable output folder id |
| `COMMERCIAL_UI_UX_WORKERS` | `2` | Worker count passed to PR1 runner |
| `COMMERCIAL_UI_UX_MIN_SCORE` | `85` | Commercial readiness pass threshold |
| `PLAYWRIGHT_USERNAME` | `commercial_ui_ux_audit_admin` | Audit user base name |
| `PLAYWRIGHT_PASSWORD` | `AuditSmoke12345!` | Audit user password |

## PR2 Validation Set

Run these before marking PR2 ready:

```powershell
npm run typecheck
npm run build
npm run build:backend
npm run prisma:validate
npm run test:browser:isolated:parallel
npm run audit:commercial:ui-ux
```

If CI fails, fix only defects introduced by PR2. Do not bring unrelated PR1 runner, CI, backend/base, or old stash changes into this PR.

AI governance follow-up validation for the future AI enhancement PR:

```powershell
npx tsx ./scripts/ai-security-regression.ts
npm run audit:ai:isolation
node ./scripts/crm-ai-assistant-browser-audit-v1.cjs
node ./scripts/crm-permission-ai-audit-v1.cjs
```

These commands are not a substitute for PR2 commercial UI/UX evidence; they are
the planned safety gates for the next focused AI feature enhancement PR.

## AI Future Work Governance Matrix

PR2 does not implement or expand AI runtime behavior. It records the governance
shape required before internal AI features can be called commercially safe.

| AI surface | Lane | PR2 status | Required governance before implementation |
|---|---|---|---|
| Global AI assistant | assistant | future-only | local/rules default, external model opt-in, sensitive prompt refusal, role isolation, mobile-safe drawer, eval/red-team evidence, audit logs, read-back for any confirmed write |
| OCR document recognition | OCR | future-only | privacy gate, user-approved extraction preview, field validation, duplicate/error handling, role-restricted routes, refusal evidence, parse/confirm audit events, read-back |
| Smart import and table parsing | import | future-only | template/sample guidance, preview before commit, duplicate/update policy, failed-row export, customer-pool isolation, human confirmation, post-import read-back |
| AI command bar | commandBar | future-only | planner/executor/verifier separation, typed tool registry, navigation/read-only intents first, no hidden writes, permission checks before every action, command red-team tests |
| AI analytics | analytics | future-only | canonical metric definitions, source links, confidence and unavailable markers, no raw sensitive records, no fabricated KPI/customer/finance/formula details, anti-fabrication eval |

The generated commercial report mirrors this matrix under `aiGovernance.matrix`.
Every row is deliberately marked `future-only` until a focused AI PR provides
privacy, permission, eval, audit-log, and read-back evidence.
