# Agent Collaboration Playbook For AilaoDa ERP/CRM

Date: 2026-07-07

This playbook defines which local skills and agent roles should support the
AilaoDa ERP/CRM production-readiness work. It is deliberately conservative:
use trusted local skills, bounded read-only explorers, and evidence gates before
letting any agent write code.

## Safety Position

- Use only skills already available in this Codex environment.
- Do not install third-party "agent" packages or prompt bundles from unknown
  sources.
- Do not run code copied from random web pages.
- Do not let multiple agents edit the same files at the same time.
- Do not let a subagent claim completion; the main controller must inspect the
  diff and rerun the relevant gates.
- Do not mix PR2 commercial UI/UX audit work with engineering-readiness work.

## Trusted Local Skill Set

### Project Controller

Skill:

- `项目总控中心`

Use for:

- multi-step engineering changes
- sequencing research, execution, verification, and recovery
- keeping PR scope tight
- avoiding long-running or stuck commands

Deliverable:

- current plan
- validation results
- stop/continue decision

### ERP System Architect

Skill:

- `erp-system-architecture`

Use for:

- PostgreSQL migration planning
- OpenAPI/shared contract design
- backend service/repository boundaries
- dashboard read-model architecture
- tenant/permission/audit boundaries

Deliverable:

- domain map
- ownership boundaries
- lifecycle and state-machine notes
- rollout phases

### Anti-Hallucination Controller

Skill:

- `erp-anti-hallucination-review`

Use for:

- any claim of readiness, stability, release safety, or CI green
- money, inventory, approval, permission, backup, restore, and dashboard work
- preventing false-green reports

Deliverable:

- scope
- risk level
- gate reached
- evidence
- mismatch
- decision
- next action

### ERP Audit Role Orchestrator

Skill:

- `erp-audit-roles`

Use for:

- role-based UI, backend, reconciliation, stuck-job, and recovery audits
- coordinating independent checks in parallel
- keeping evidence and stop conditions clear

Deliverable:

- role used
- tested target
- pass/fail/stuck result
- evidence path or command result
- recovery action if needed

### Enterprise UI Auditor

Skills:

- `erp-ui-audit`
- `erp-frontend-flow-tester`
- `frontend-skill` with ERP/product-ui constraints

Use for:

- shell consistency
- route layout drift
- dark-mode contrast
- mobile table/card usability
- language switching
- empty/loading/error/forbidden states
- browser screenshot evidence

Important constraint:

`frontend-skill` is useful for visual hierarchy and restraint, but this project
is an ERP/CRM app, not a marketing site. Use its "app UI" and "utility copy"
guidance. Avoid landing-page hero thinking for operational screens.

Deliverable:

- route
- viewport
- screenshot path
- visible state
- issue layer: shell, page, component, state, API, or runtime

### Security And Supply-Chain Reviewer

Skill:

- `security-best-practices`

Use for:

- dependency hygiene
- Express/React security review
- CSP, CSRF, secrets, file upload, auth, storage, redirects
- deciding whether a new dependency is acceptable

Deliverable:

- evidence-backed security finding or approval note
- affected file/line
- mitigation
- validation needed

### SRE / Production Readiness Explorer

Skills:

- `项目总控中心`
- `erp-anti-hallucination-review`
- `erp-audit-roles`

Use for:

- Docker/runtime paths
- health checks
- backup/restore
- logs and metrics
- CI and package provenance
- stale runtime/process/file-lock diagnosis

Deliverable:

- risk register
- validation gates
- runtime/process evidence
- rollout and recovery plan

## Recommended Agent Roster

Use subagents only when the task is concrete, bounded, and can run in parallel.
Default subagent mode is read-only explorer. Worker agents are allowed only when
the write set is narrow and non-overlapping.

| role | mode | use when | output |
|---|---|---|---|
| Product R&D Lead / PM Controller | explorer | every future PR, business actor/workflow definition, roadmap tradeoffs | PR charter, actor, workflow, lifecycle, risk level, acceptance evidence |
| Enterprise UI/UX Designer | explorer | auditing dashboard, Smart Filter, mobile cards, route clarity, utility-copy quality | UI audit checklist, screenshots needed, state matrix, design risks |
| Engineering Architect | explorer or worker | API contracts, DB/runtime, service boundaries | ADR, contract proposal, migration plan |
| SRE / Production Readiness Lead | explorer | build/runtime/db/cache/observability/storage readiness | risk register, validation gates, rollout plan |
| Security Reviewer | explorer | new dependencies, auth/session/file/CSP/CSRF changes | security findings and dependency approval |
| Frontend Test Engineer | worker | adding focused component tests or test harness | isolated test files and npm script |
| Backend Chain Tester | explorer or worker | write/read/approve/post/import flows | API evidence and reconciliation result |
| Stress & Reconciliation Officer | explorer | duplicate submit, double approve/post, stock/money/status races | conflict matrix, before/after amounts/status/counts |
| Encoding / Stale Entry Triage | explorer | mojibake, wrong route, stale runtime, old bundle behavior | source-vs-runtime diagnosis, offending route/file, safe fix suggestion |
| Timer Judge | explorer | long browser/API/release checks | timeout threshold, elapsed time, retry/stuck verdict |
| Recovery Officer | local main controller only | stale runtime, locked files, broken build, partial migration | stopped PID, build result, restarted runtime, verification |

## When To Spawn Agents

Good delegation:

- "Inspect dashboard routes and list missing executive KPI evidence."
- "Review storage/upload routes for local-disk coupling; no edits."
- "Add tests only for `components/ui/businessFilters.ts`; do not touch UI."
- "Review docs and propose PR order; no code changes."

Bad delegation:

- "Make the app production ready."
- "Fix all UI."
- "Upgrade dependencies and see what happens."
- "Refactor backend layering across the whole repo."
- "Install an agent framework from GitHub."

## Product/Engineering Team Workflow

1. Product Manager explorer defines the business objective, non-goals, and PR
   slice.
2. ERP System Architect maps ownership, contracts, lifecycle, and rollout.
3. UI/UX explorer defines route-level evidence and interaction expectations.
4. Security reviewer checks dependencies, auth, file/storage, CSP/CSRF, and
   secrets before implementation.
5. Main controller implements or delegates a narrow worker task with a disjoint
   write set.
6. Anti-hallucination gate reruns relevant checks.
7. Main controller inspects diff, validates, and summarizes directory changes.

## Dependency And "No Virus" Rules

Before adding any package:

- Prefer existing dependencies and local scripts.
- Check `package-lock.json` is present and will be updated intentionally.
- Prefer official packages from known maintainers.
- Avoid packages that execute unnecessary install scripts.
- Do not install packages just because an agent recommends them.
- If install hangs, stop it and verify package files were not partially changed.
- Use `npm ci` for reproducible CI once dependency changes are finalized.
- Treat `npx` as network-capable unless the binary is already present in
  `node_modules`.
- Do not run `npm update` or `npm audit fix` casually; those are dependency
  change PRs, not routine verification.
- Review expected install scripts before dependency work. This repo already has
  Prisma generation and platform binaries in the dependency graph.
- Use a clean or disposable environment for dependency experiments when
  possible.
- Pick and document one registry policy before relying on dependency evidence
  for release.
- Real `.env` files must stay untracked. Do not put secrets in docs, generated
  reports, frontend bundles, or screenshots.

For this repo specifically:

- Vitest/Testing Library are reasonable future additions because they are
  mainstream testing tools for Vite/React.
- TanStack Query and TanStack Virtual are reasonable only after the first
  module-level contract is clear.
- Do not install external "AI agent" frameworks into the ERP app runtime.
- Do not embed Superset, Metabase, Odoo, or ERPNext into the product. Use them
  as references unless an explicit integration PR is opened.

## Verification Gates

Use these gates before saying a role, PR, or release slice is done:

1. L0 problem layer:
   confirm scope, active branch, remote, dirty tree, route/runtime, and whether
   the work belongs to PR2 or engineering-readiness.
2. L1 static/build:
   run only the relevant approved commands. Typical commands are
   `npm run typecheck`, `npm run build`, `npm run build:backend`,
   `npm run prisma:validate`, and focused audit scripts.
3. L2 route/shell:
   confirm route opens, shell renders, labels/language/state are correct, and no
   stale entry point is serving old code.
4. L3 business loop:
   for write flows, API read-back and browser read-back must match. Capture
   record IDs.
5. L4 recovery:
   backup/restore/login/read-back evidence is required for runtime, database,
   and migration changes.
6. L5 release-like:
   single runtime, health contract, clean source manifest, package provenance,
   and no old entry hijack.

## UI/UX Audit Evidence Checklist

The UI/UX designer role should start as read-only explorer. Implementation is a
separate, later worker role with a narrow write set.

Check:

- Shell: `Layout`, sidebar groups, mobile bottom navigation, command palette,
  language/theme/currency/compact/text-scale controls.
- Navigation and roles: module labels, route titles, descriptions, aliases, and
  role visibility.
- Tables: search, sorting, paging, column visibility, sticky columns/actions,
  Smart Filters, import/export, and mobile overflow.
- Product gaps: executive KPIs, Smart Filter adoption, mobile card views, and
  dark-mode contrast evidence.
- Enterprise UX: dense, scannable operational surfaces; no decorative dashboard
  mosaic unless it improves decision speed.
- Mobile: task-shaped data cards, not squeezed desktop tables.
- Accessibility: accessible names, focus order, modal focus trap, keyboard row
  actions, touch target size, and reduced-motion behavior.
- Browser runtime: console errors, failed requests, route ownership, stale
  bundle signs, and visible text rendering.

Evidence artifacts:

- per-route evidence card with role, URL/hash, viewport, user role, action,
  timeout, result, screenshot path, and issue layer
- desktop/tablet/mobile screenshots
- console/page/network failure list
- state matrix covering loading, empty, error, forbidden, offline/slow, dirty
  form, modal open, language changed, and theme changed
- route-level severity, user impact, owner, and whether the finding is product
  audit or implementation

## Current Project Application

The most useful near-term team setup:

1. Product Manager explorer:
   confirm PR scope and acceptance criteria for engineering-readiness slices.
2. UI/UX Designer explorer:
   audit executive dashboard, Smart Filter, and mobile record-list evidence.
3. Engineering/SRE explorer:
   keep PostgreSQL, OpenAPI, test foundation, cache, storage, and observability
   work sequenced safely.
4. Main controller:
   performs final edits, owns git status, validation, and directory summaries.

This keeps the project from drifting into either extreme: a pretty but
unverified UI, or a technically ambitious rewrite with no business evidence.

## Anti-Patterns To Avoid

- "Build passed, so it is production-ready."
- "HTTP 200 means the business flow closed."
- Running `npx` locally when dependencies are absent or untrusted.
- Mixing PostgreSQL migration, dashboard/UI work, dependency upgrades, and
  runtime packaging in one PR.
- Letting subagents edit overlapping files or claim final PASS.
- Publishing from a dirty source tree.
- Treating screenshots as proof without API/DB/read-back evidence.
- Ignoring CSP/CSRF partial status because Helmet exists.
- Enabling offline/service worker behavior before stale ERP data rules exist.
