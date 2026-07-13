# Commercial UI/UX Research: Mature Commercial And Open-Source ERP, CRM, BI, And Admin Patterns

Date: 2026-07-07

This is a research-first note for PR2 and the follow-up product roadmap. It
does not implement product behavior. It defines what AilaoDa should learn from
mature commercial and open-source ERP/CRM, BI, and admin products before adding
executive dashboard, Smart Filter, and mobile data-card work.

## Scope

Research questions:

- What do mature commercial and open-source ERP/CRM products show on an executive operating dashboard?
- How do mature products handle business filters beyond keyword search?
- How do mature admin systems avoid desktop tables shrinking poorly on mobile?
- Which open-source projects are useful references, and which should stay as
  pattern references only?

Repository boundary:

- PR2 remains commercial ERP/CRM UI/UX audit only.
- This note can inform PR2 scoring criteria and route priorities.
- Product implementation should happen in later focused PRs.
- Do not mix this with PR1 runner foundation, CI workflow, backend base fixes,
  database migration, or stale stash content.

## Skill And Agent Selection

PR2 uses local, inspectable support only. The goal is to improve research
coverage without introducing supply-chain risk or uncontrolled code changes.

Repository-local skills installed for this PR:

- `.agents/skills/erp-commercial-product-manager`
- `.agents/skills/erp-enterprise-ui-designer`
- `.agents/skills/erp-team-rd-coordinator`
- `.agents/skills/erp-codebase-scout`
- `.agents/skills/erp-enterprise-software-delivery`
- `.agents/skills/erp-ai-feature-governance`
- `.agents/skills/erp-evidence-first-reasoning`

These skills are used as working instructions for PR2 development: product
criteria, enterprise UI review, team/R&D scope control, read-only codebase
reconnaissance, enterprise delivery discipline, and AI feature governance. They
do not add runtime dependencies.

Accepted support:

- the repository-local PR2 skills above
- local repo-specific skills: `erp-ui-audit`, `erp-audit-roles`,
  `erp-anti-hallucination-review`
- local architecture/product framing skills: `erp-system-architecture`,
  `frontend-skill`
- security framing only when needed: `security-best-practices`
- bounded read-only explorers for product research, enterprise UI/UX criteria,
  and codebase integration reconnaissance

Rejected support:

- external agent frameworks, browser extensions, prompt packs, pasted shell
  installers, or unknown GitHub scripts
- package installs whose only purpose is to run an audit assistant
- tools that require secrets or broad write access for read-only research
- generated recommendations that cannot be tied back to official docs,
  mature open-source projects, or current repository evidence

### Enterprise Development And Agent Research

Useful external patterns were researched but not installed as packages:

- OpenAI/Codex Skills pattern: keep specialized workflows as local `SKILL.md`
  instructions plus optional references/scripts/assets, not as opaque binaries.
  PR2 follows this by storing project-local skills under `.agents/skills`.
- OpenAI Agents pattern: production AI systems need explicit roles, tools,
  guardrails, tracing, and evaluations. PR2 absorbs this as future AI criteria
  and an AI governance skill; it does not add an agent runtime dependency.
- OpenAI/Codex subagents and hooks pattern: specialized workers and deterministic
  lifecycle checks are useful when bounded, reviewed, and traceable. PR2 applies
  this as read-only role lenses and manual evidence gates, not as new hooks or
  automation that can mutate the repository.
- Claude Code hooks/subagents pattern: custom subagents can isolate context and
  restrict tools, while hooks can run lifecycle guardrails. PR2 uses only the
  safe reasoning pattern because no exact, locally verifiable `claude-fable 5`
  skill was found.
- GitHub Copilot coding-agent pattern: agent work should happen on branches,
  with human review and PR evidence. PR2 mirrors that discipline by keeping the
  commercial UI/UX audit branch separate from PR1 and engineering-readiness work.

Project-specific enterprise roles now available as local skills:

- Commercial PM: criteria, business impact, roadmap and non-goals
- Enterprise UI designer: dashboard/filter/table/mobile/accessibility review
- Team R&D coordinator: branch scope, validation, directory hygiene
- Codebase scout: route/component/script ownership discovery
- Enterprise delivery reviewer: architecture, security, release and evidence gates
- AI feature governance reviewer: assistant/OCR/import privacy, role isolation,
  evals, and red-team evidence
- Evidence-first reasoning reviewer: claim/evidence mapping, false-green traps,
  planner/executor/verifier separation, directory-state reporting, and exact
  verification before readiness language

This keeps PR2 in the research-and-evidence lane: use experts as lenses, then
make the main controller inspect the diff and rerun the audit commands.

Sources:

- https://developers.openai.com/codex/skills
- https://platform.openai.com/docs/guides/agents
- https://docs.anthropic.com/en/docs/claude-code/sub-agents
- https://docs.anthropic.com/en/docs/claude-code/hooks
- https://docs.github.com/en/copilot/using-github-copilot/coding-agent

## Local Baseline

Current AilaoDa evidence:

- `pages/Dashboard.tsx` already imports Recharts and renders a revenue trend
  bar chart with `ResponsiveContainer` and `BarChart`.
- `services/dashboard.service.ts` already calls `/dashboard/trends`.
- `backend/src/routes/dashboard.routes.ts` already exposes
  `GET /api/dashboard/trends`.
- The dashboard is therefore partial, not absent. The gap is executive
  operating intelligence: YoY/MoM comparison, cash forecast, receivables aging,
  customer segmentation, retention, KPI drill-down, and mobile owner summary.
- `components/DataTable.tsx` and `components/ui/EnterpriseDataGrid.tsx` already
  support keyword search, sorting, pagination, column visibility, export, and
  horizontal overflow.
- Current table filtering is mostly keyword or page-specific chips. There is
  no shared typed Smart Filter contract for date range, amount range, status
  multi-select, customer/SKU/entity facets, saved presets, or URL-safe state.
- Mobile record lists still lean on table overflow. There is no reusable mobile
  card contract for business rows.

## Mature And Open-Source References

### ERPNext / Frappe

Why it matters:

ERPNext is a mature open-source ERP. Frappe separates desk list views, reports,
dashboards, and mobile access instead of forcing every business question into a
single page.

Patterns worth adopting:

- Keep dashboard, report, and workspace responsibilities separate.
- Treat list filters, paging, sorting, tags, and view switching as normal ERP
  list behavior, not advanced features.
- Use dashboard cards and charts for monitoring, then route users to reports or
  filtered lists for detail.
- Mobile should support forms, dashboards, reports, workflows, and permissions,
  not just a squeezed table.

AilaoDa decision:

- Adopt the separation of dashboard, reports, and record lists.
- Use list filters as a shared primitive.
- Do not clone ERPNext workspaces wholesale.

Sources:

- https://docs.frappe.io/erpnext/erpnext-dashboards
- https://docs.frappe.io/framework/user/en/api/list
- https://frappe.io/erpnext/mobile
- https://github.com/frappe/erpnext

### Odoo

Why it matters:

Odoo is a mature ERP suite with strong daily habits around search, filters,
group-by, favorites, dashboards, spreadsheet-backed dashboards, and period
comparison.

Patterns worth adopting:

- Search views combine filters, group-by, and favorites.
- Business users can save useful filters instead of rebuilding them every day.
- Dashboard metrics should support comparison to previous period or previous
  year near the chart, not only in exports.
- Custom dashboards can centralize live business metrics from multiple apps.

AilaoDa decision:

- Use Odoo-style advanced filters and saved views as the Smart Filter target.
- Add period comparison to executive metrics.
- Avoid embedding an Odoo-like dashboard builder before canonical metrics exist.

Sources:

- https://www.odoo.com/documentation/19.0/applications/essentials/search.html
- https://www.odoo.com/documentation/19.0/applications/productivity/dashboards.html
- https://www.odoo.com/documentation/19.0/applications/productivity/spreadsheet/insert.html
- https://www.odoo.com/documentation/19.0/applications/essentials/export_import_data.html
- https://github.com/odoo/odoo

### Microsoft Power BI / Dynamics CFO Workspace

Why it matters:

Power BI and Dynamics CFO workspace are useful mature references for executive
finance dashboards and mobile-optimized reports. They show that an owner or CFO
view should prioritize revenue, expense, net income, gross margin, AP/AR,
cash-flow forecast, aged balances, and mobile layout rules.

Patterns worth adopting:

- Put cash, receivables, sales, margin, and exception risk into the first
  executive reading path.
- Use KPI visuals with trend, goal, and status context.
- Treat mobile reports as their own layout, not a compressed desktop canvas.
- Keep finance KPIs traceable to report pages and source records.

AilaoDa decision:

- Use these as executive-dashboard content benchmarks.
- Do not integrate Power BI in PR2.

Sources:

- https://learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/analytics/cfo-power-bi
- https://learn.microsoft.com/en-us/power-bi/visuals/power-bi-visualization-kpi
- https://learn.microsoft.com/en-us/power-bi/create-reports/power-bi-create-mobile-optimized-report-about
- https://learn.microsoft.com/en-us/power-bi/create-reports/power-bi-create-mobile-optimized-report-best-practices

### Salesforce

Why it matters:

Salesforce is a mature CRM reference for dashboards, reports, dashboard
filters, dynamic dashboards, mobile dashboard limitations, and drill-down into
report data.

Patterns worth adopting:

- CRM dashboards should be role-aware and permission-aware.
- Dashboard filters and report filters are separate but connected.
- Sales and customer KPIs need drill paths into reports, lists, and records.
- Mobile dashboard evidence should be checked separately from desktop.

AilaoDa decision:

- Use Salesforce as a CRM dashboard and report-filter benchmark.
- Do not copy Salesforce dashboard-builder complexity into the first dashboard
  implementation.

Sources:

- https://help.salesforce.com/s/articleView?id=sf.dashboards_overview.htm
- https://help.salesforce.com/s/articleView?id=sf.dashboards_filtering.htm
- https://help.salesforce.com/s/articleView?id=sf.reports_drill_down.htm

### Dolibarr

Why it matters:

Dolibarr is a long-running open-source ERP/CRM. Its strength is modular
business coverage and practical CRM/ERP screens rather than highly polished BI.

Patterns worth adopting:

- Keep module-level screens direct and operational.
- Enable business capabilities incrementally.
- Use dashboards and boxes for quick operational status.

AilaoDa decision:

- Adopt the modular rollout discipline.
- Do not use Dolibarr as the main dashboard UX benchmark; it is more useful as
  a scope-control reference.

Sources:

- https://www.dolibarr.org/
- https://wiki.dolibarr.org/
- https://github.com/Dolibarr/dolibarr

### SuiteCRM

Why it matters:

SuiteCRM is an open-source CRM reference with role-oriented dashboards,
dashlets, record lists, and CRM-specific workflows.

Patterns worth adopting:

- Dashboards can be role-specific instead of one universal wall of widgets.
- CRM users need quick customer, opportunity, activity, and follow-up context.
- Dashlets are useful when users can arrange personal work surfaces, but they
  need governance for executive metrics.

AilaoDa decision:

- Use role-specific dashboard slices for sales, finance, warehouse, and owner
  views.
- Keep executive KPIs canonical and governed, not purely user-configurable.

Sources:

- https://docs.suitecrm.com/
- https://github.com/salesagility/SuiteCRM

### Apache Superset

Why it matters:

Superset is a mature open-source BI platform. It is useful for semantic
metrics, dashboard filters, chart exploration, cross-filtering, and caching.

Patterns worth adopting:

- Define canonical metrics outside individual React components.
- Use a semantic or read-model layer for expensive dashboard questions.
- Dashboard filters should be data contracts, not only UI widgets.
- Cross-filtering and drill-to-detail are expected analytics behaviors.

AilaoDa decision:

- Learn from Superset's metric and filter model.
- Do not embed Superset in AilaoDa for the first dashboard PR.
- Build small read-only dashboard APIs first.

Sources:

- https://superset.apache.org/
- https://superset.apache.org/docs/intro
- https://github.com/apache/superset

### Metabase

Why it matters:

Metabase is a mature open-source analytics product that makes dashboard
filters, parameters, and drill-through understandable for non-technical users.

Patterns worth adopting:

- Dashboard filters prevent duplicated dashboards for every date range,
  customer, warehouse, or owner.
- Drill-through turns a chart point or table value into the next filtered
  business question.
- Business users should be able to move from KPI to source records quickly.

AilaoDa decision:

- KPI cards and charts should carry drill-down links into filtered ERP lists.
- Dashboard filter state should reuse the same Smart Filter model as tables.

Sources:

- https://www.metabase.com/docs/latest/dashboards/filters
- https://www.metabase.com/docs/latest/questions/visualizations/drill-through
- https://github.com/metabase/metabase

### React-admin

Why it matters:

React-admin is a mature open-source admin framework. Its list architecture
separates list state, filtering, pagination, data fetching, and display
rendering.

Patterns worth adopting:

- Keep list state formal and shareable.
- Separate data fetching and display layout.
- Render desktop rows as tables and mobile rows as simpler list/card entries.

AilaoDa decision:

- Keep AilaoDa's custom visual system.
- Borrow the list-state and mobile-list pattern.
- Add mobile card slots to AilaoDa grid primitives before broad page rewrites.

Sources:

- https://marmelab.com/react-admin/List.html
- https://github.com/marmelab/react-admin

### Appsmith Table

Why it matters:

Appsmith is not an ERP benchmark, but its table widget documents the practical
behaviors that business users expect from heavy operational lists: server-side
pagination, sorting, searching, filtering, inline editing, stable primary keys,
and limits around infinite scroll.

Patterns worth adopting:

- Treat server-side pagination, sorting, and filtering as table-readiness
  evidence for large ERP data.
- Keep unique row identifiers explicit.
- Avoid mixing infinite scroll with client-only behaviors that cannot scale.
- Keep inline edits and bulk actions tightly governed.

AilaoDa decision:

- Use Appsmith as a pragmatic audit reference for table behavior.
- Do not add Appsmith or a low-code runtime to the product.

Sources:

- https://docs.appsmith.com/reference/widgets/table

### TanStack Table / TanStack Virtual

Why it matters:

TanStack is open-source and headless. It fits a custom ERP design system better
than importing a full visual grid.

Patterns worth adopting:

- Separate global search from column filters.
- Support both client-side filtering and manual server-side filtering.
- Keep filter state serializable so it can live in URL query params and saved
  presets.
- Use virtualization only when measured row volume requires it.

AilaoDa decision:

- Adopt TanStack-style concepts first.
- Add the dependency only if the current grid primitive reaches a clear limit.
- Keep server-side filtering as the default for large ERP lists.

Sources:

- https://tanstack.com/table/v8/docs/guide/column-filtering
- https://tanstack.com/table/v8/docs/guide/global-filtering
- https://tanstack.com/virtual/latest
- https://github.com/TanStack/table

### SAP Fiori Analytical List Page

Why it matters:

SAP Fiori is not the open-source baseline, but it is a strong enterprise UX
reference for decision screens.

Patterns worth adopting:

- Use KPI tags/cards with criticality.
- Combine visual filters and compact filters.
- Let chart selection drive filtered record views.
- Support variant management for saved filter and view presets.
- Keep chart and table on the same analytical path.

AilaoDa decision:

- Use Fiori as a quality benchmark, not a code dependency.
- Match the operating pattern: KPI -> visual filter -> table/list drill-down.

Sources:

- https://www.sap.com/design-system/fiori-design-web/v1-108/page-types/floorplans/analytical-list-page/usage
- https://experience.sap.com/fiori-design-web/analytical-list-page/
- https://www.sap.com/design-system/fiori-design-web/v1-108/foundations/best-practices/ui-elements/tables/table-overview

### Ant Design / Ant Design Pro

Why it matters:

Ant Design is a mature enterprise React design system with strong table,
alignment, form, density, and admin-console conventions. It is useful as a
Chinese-market enterprise UI reference because it emphasizes predictable
layout, data-table operation, and enterprise product consistency.

Patterns worth adopting:

- Use alignment and numeric formatting rules to improve dense table scanning.
- Keep table actions, filters, pagination, and batch controls consistent.
- Avoid decorative UI when the user needs repeated operational work.
- Treat an enterprise design system as a shared product language, not a visual
  skin.

AilaoDa decision:

- Use Ant Design as a design-system benchmark.
- Do not replace the current component system inside PR2.

Sources:

- https://ant.design/components/table/
- https://ant.design/docs/spec/introduce/
- https://ant.design/docs/spec/alignment/

### MUI X Data Grid

Why it matters:

MUI X is a mature React data-grid reference for typed filter models, toolbar
filter entry, column-specific operators, and controlled filter state.

Patterns worth adopting:

- Treat filters as a structured model with items and a logic operator.
- Keep column-level operators type-aware instead of treating all filters as
  keyword text.
- Support controlled filter state so filters can later be serialized to the
  URL, reports, and saved views.
- Keep quick search separate from business filters.

AilaoDa decision:

- Use MUI X as a filter-model reference, not as an immediate dependency.
- PR2 should audit whether AilaoDa tables expose typed business filters, not
  just keyword search.

Sources:

- https://mui.com/x/react-data-grid/filtering/
- https://mui.com/x/react-data-grid/server-side-data/

### AG Grid

Why it matters:

AG Grid is a commercial-grade grid benchmark with mature column filters, quick
filter, external filter, row models, import/export, accessibility, touch, and
server-side data patterns.

Patterns worth adopting:

- Provide different filter types for text, number, date, and set values.
- Allow multiple column filters to work together with quick or external
  filters.
- Treat server-side filtering, export, keyboard access, and touch behavior as
  commercial table-readiness concerns.
- Avoid assuming a desktop grid alone solves mobile workflows.

AilaoDa decision:

- Use AG Grid as a capability benchmark for table audit scoring.
- Do not replace the existing grid in PR2.

Sources:

- https://www.ag-grid.com/react-data-grid/filtering/
- https://www.ag-grid.com/react-data-grid/server-side-model-filtering/
- https://www.ag-grid.com/react-data-grid/accessibility/

### IBM Carbon Data Table

Why it matters:

Carbon is a mature enterprise design system. Its data table guidance treats
search, filtering, display settings, expansion, selection, pagination, and
accessibility as table anatomy, not optional decoration.

Patterns worth adopting:

- Put search, filtering, display settings, and primary utilities in a clear
  table toolbar.
- Use row expansion when dense records need progressive disclosure.
- Keep row size, header size, pagination, and batch actions consistent.
- Use component accessibility status as evidence, not visual taste.

AilaoDa decision:

- Audit table toolbars and data states against Carbon-style enterprise table
  anatomy.
- Keep AilaoDa's visual language; borrow the information architecture.

Sources:

- https://carbondesignsystem.com/components/data-table/usage/
- https://carbondesignsystem.com/components/data-table/accessibility/

### PatternFly Toolbar And Mobile Filters

Why it matters:

PatternFly is useful for enterprise data views because it documents how filters,
bulk selection, actions, item counts, pagination, overflow menus, and mobile
toolbars should behave together.

Patterns worth adopting:

- Group related filters rather than leaving a single keyword box to do all
  business filtering.
- Collapse complex filters into a mobile toggle panel at small breakpoints.
- Move excess actions into overflow menus instead of crowding the toolbar.
- Keep item count or pagination visible after filtering.
- Place toolbar controls near list/card view switches.

AilaoDa decision:

- PR2 should score whether mobile table/list filters collapse into a usable
  panel instead of forcing horizontal overflow.
- Future card/list view work should reuse the same filter toolbar state.

Sources:

- https://www.patternfly.org/components/toolbar/design-guidelines/
- https://www.patternfly.org/components/table/design-guidelines/

### WCAG Contrast And Accessibility Baseline

Why it matters:

Dark mode and glass-style surfaces can look premium while failing commercial
accessibility. PR2 should treat contrast as measurable evidence.

Patterns worth adopting:

- Normal text must meet the WCAG 2.2 contrast-minimum threshold of 4.5:1.
- Large text can use the 3:1 threshold, but ratios must not be rounded up.
- Color evidence must include foreground and background pairs, not screenshots
  alone.
- Keyboard focus, accessible names, reduced motion, and touch target evidence
  should be included for high-value routes.

AilaoDa decision:

- PR2 should keep dark-mode contrast as an audit dimension.
- Fixes belong in later UI implementation PRs unless the audit route itself is
  broken.

Sources:

- https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- https://developer.mozilla.org/en-US/docs/Web/Accessibility

### PWA, Offline, And Web Vitals

Why it matters:

Mobile owner and warehouse scenarios need a clear offline policy, but ERP data
can be stale or sensitive. A PWA should not be added as a visual checkbox.

Patterns worth adopting:

- Service workers are powerful request/response proxies and require deliberate
  cache scope and update rules.
- Authenticated business data should not be cached blindly.
- Use Web Vitals as product evidence for mobile responsiveness, not just build
  success.
- Offline capability needs a business policy: which data can be read offline,
  how stale it may be, how conflicts are reconciled, and when writes are
  blocked.

AilaoDa decision:

- PR2 can report that offline/PWA is missing or undefined.
- Do not implement service workers in PR2.

Sources:

- https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers
- https://web.dev/articles/vitals

### Internal AI Assistant And Governed AI Features

Why it matters:

AilaoDa already has AI surfaces: global AI assistant, AI settings, local/rules
mode, external model privacy gate, Smart Form Fill, OCR/table import, contract
recognition, and CRM AI security audits. These are commercially important, but
they touch sensitive ERP data and must be governed before expansion.

Patterns worth adopting:

- Local/rules mode remains default; external AI requires explicit opt-in.
- Safe AI context should include role, route, language, currency, and allowed
  counts/summaries, never raw sensitive records.
- AI write-capable features stay human-in-loop: preview, validate, confirm,
  write, then read back.
- AI assistant, command bar, OCR, import parsing, and analytics need reproducible
  red-team/eval scripts before they are described as commercially safe.
- Planner/executor/verifier separation is a future runtime pattern for AI
  command bar and analytics. PR2 only audits readiness.

AilaoDa current evidence:

- `components/AIAssistant.tsx`
- `components/AISettings.tsx`
- `components/SmartFormFill.tsx`
- `components/TableImport.tsx`
- `services/aiSecurity.ts`
- `services/aiConfig.ts`
- `scripts/ai-security-regression.ts`
- `scripts/ai-isolation-redteam-regression.ts`
- `scripts/crm-ai-assistant-browser-audit-v1.cjs`
- `scripts/crm-permission-ai-audit-v1.cjs`

AilaoDa decision:

- PR2 adds AI governance criteria and Settings route coverage.
- AI feature implementation is deferred to a focused follow-up PR.
- The next AI PR should improve assistant UX, OCR/import preview and validation,
  AI command bar, AI analytics, and eval reporting under the
  `.agents/skills/erp-ai-feature-governance` workflow.

Sources:

- https://platform.openai.com/docs/guides/agents
- https://github.com/openai/skills
- https://docs.github.com/en/copilot/using-github-copilot/coding-agent

## Research Conclusions

1. The "boss cannot see the business" criticism is directionally valid, but the
   local evidence must be stated accurately. AilaoDa already has a trend chart;
   it does not yet have an executive operating cockpit.
2. Mature products do not solve dashboards by adding random cards. They define
   canonical metrics, dashboard filters, period comparison, risk surfacing, and
   drill-down to records.
3. Smart Filters are a product architecture primitive. They should be typed,
   URL-safe, reusable by grids and dashboards, and able to run in client or
   server mode.
4. Mobile ERP data screens should switch renderers. Desktop tables stay useful,
   but mobile should use business cards with primary text, status, metadata,
   and actions.
5. BI platforms are references, not immediate dependencies. Superset and
   Metabase validate the importance of semantic metrics, filters, and
   drill-through, but embedding either platform before AilaoDa has canonical
   metrics would add product and operations weight too early.
6. SAP Fiori validates the enterprise UX shape: KPI criticality, visual filters,
   compact filters, chart/table continuity, and variants.
7. MUI X, AG Grid, Carbon, and PatternFly agree on the same commercial table
   lesson: keyword search is only one layer. Typed filter models, grouped
   filters, toolbar discipline, accessibility, export behavior, and mobile
   collapse rules are part of the product contract.
8. PWA/offline support is not automatically good for ERP. It needs stale-data,
   cache, security, and reconciliation rules before implementation.

## How To Connect This To AilaoDa

Recommended connection order:

1. PR2 audit criteria first.
   Use this research to score commercial readiness: executive visibility,
   filter maturity, mobile record usability, dark-mode contrast, route
   stability, and evidence quality.

2. Shared Smart Filter contract.
   Add `BusinessFilterState` and `BusinessFilterDefinition` before broad page
   changes. The first real adoption should be sales orders, collections, or
   warehouse balances.

3. Mobile card contract.
   Add mobile renderer slots to the shared grid primitive, then adopt on one
   high-value operational list. Keep desktop tables unchanged.

4. Executive dashboard API contract.
   Add read-only APIs for executive summary, revenue/profit comparison,
   cash forecast, receivables aging, customer segments, and KPI drill-down.
   Do this before a visual dashboard rebuild.

5. Executive dashboard UI.
   Build the dashboard as an operating cockpit:
   revenue/profit trend with YoY/MoM, cash risk, overdue receivables, inventory
   risk, approval backlog, customer concentration, repeat purchase, and
   one-tap drill-down.

6. Saved presets and variants.
   Add saved filter presets after the shared filter state is proven on at least
   one business route.

## First Implementation Recommendation After Research

Product value says executive dashboard is the highest-return surface.
Implementation dependency says Smart Filter and KPI drill-down contracts should
come first.

The safest next product PR after PR2 audit is therefore:

- Add the shared Smart Filter model.
- Adopt it on one revenue or receivables route.
- Add enough URL-safe state for future dashboard drill-down.
- Then build the executive dashboard read model and UI on top of that contract.

This avoids a dashboard that looks impressive but cannot answer "why did this
number change?" or "which records make up this risk?".

## PR2 Audit Implications

PR2 should mark these as commercial UX gaps if evidence confirms them:

- Executive dashboard is partial, not absent.
- YoY/MoM, cash forecast, receivables aging, customer segmentation, retention,
  KPI drill-down, and mobile owner summary are missing or incomplete.
- Shared advanced filtering is missing if only keyword search or page-specific
  chips exist.
- Mobile record lists are incomplete if table overflow is the only usable
  representation.
- Dark mode should be checked with contrast evidence, not visual taste alone.
