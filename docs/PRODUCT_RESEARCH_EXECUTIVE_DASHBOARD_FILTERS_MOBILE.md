# Product Research: Executive Dashboard, Smart Filters, and Mobile Data Views

This note captures research before implementation. It focuses on mature ERP,
BI, and admin products, with open-source projects preferred where possible.
The goal is to decide how AilaoDa ERP/CRM should cross from an operation tool
into an operating brain without importing a large product surface blindly.

## Local Evidence

- `pages/Dashboard.tsx` already has Recharts and a revenue trend bar chart.
- `services/dashboard.service.ts` and `backend/src/routes/dashboard.routes.ts`
  already expose `/dashboard` and `/dashboard/trends`.
- The current dashboard is still mostly operational: cards, trend bars,
  inventory alerts, tasks, recommendations, and BI roadmap cards.
- It does not yet expose YoY/MoM comparison, cash forecast, AR aging,
  customer tiers, retention, KPI drill-down, or a mobile owner summary.
- `components/DataTable.tsx` and `components/ui/EnterpriseDataGrid.tsx`
  support keyword search, sorting, pagination, column visibility, import, and
  export.
- The current grids do not expose a typed advanced filter contract for date
  ranges, amount ranges, status multi-select, customer/SKU facets, or saved
  filter presets.
- Mobile data views still lean on horizontal table scrolling; there is no
  reusable mobile card renderer in the table primitives.

## Projects Reviewed

### ERPNext / Frappe

Why it matters:
ERPNext is a mature open-source ERP. Its dashboard model combines dashboards,
analytics pages, reports, and workspaces so users can monitor trends,
exceptions, transactions, and operational status in one place.

Useful pattern for AilaoDa:
- Treat dashboard, reports, and workspaces as separate layers.
- Dashboard is for day-to-day monitoring.
- Reports/analytics pages are for deeper review.
- List views include filters, sorting, paging, tags, and view switching.
- Mobile is framed as access to forms, reports, print formats, dashboards,
  workflows, and permissions from any device.

Sources:
- https://docs.frappe.io/erpnext/erpnext-dashboards
- https://docs.frappe.io/framework/user/en/api/list
- https://frappe.io/erpnext/mobile

### Odoo

Why it matters:
Odoo is a mature ERP suite with strong search/filter/group/favorite habits and
customizable dashboards backed by spreadsheet-style dynamic data.

Useful pattern for AilaoDa:
- Dashboard widgets should centralize live business metrics, not only shortcut
  cards.
- Filters should support preconfigured filters, custom filters, AND/OR rule
  groups, grouping, comparison to previous period/year, and saved favorites.
- Comparison is a first-class business need: previous period and previous year
  should be visible near trend charts instead of buried in exports.

Sources:
- https://www.odoo.com/documentation/19.0/applications/productivity/dashboards.html
- https://www.odoo.com/documentation/19.0/applications/essentials/search.html

### SAP Fiori Analytical List Page

Why it matters:
SAP Fiori is not the open-source baseline, but its Analytical List Page is a
strong reference for enterprise decision screens.

Useful pattern for AilaoDa:
- The executive dashboard should have global KPI tags/cards with criticality.
- The primary page should support visual filters and compact filters.
- A hybrid chart/table view is useful for moving from trend to records.
- Variant management matters: users should save filter and view presets.
- Visual filter selection should carry into compact filters.

Sources:
- https://www.sap.com/design-system/fiori-design-web/v1-108/page-types/floorplans/analytical-list-page/usage
- https://help.sap.com/docs/ABAP_PLATFORM_NEW/468a97775123488ab3345a0c48cadd8f/3d33684b08ca4490b26a844b6ce19b83.html

### Apache Superset

Why it matters:
Superset is a mature open-source BI platform. It is useful as a reference for
semantic metrics, dashboard filters, cross-filtering, drill-to-detail, and
chart caching.

Useful pattern for AilaoDa:
- Do not calculate every dashboard metric ad hoc in the React page.
- Define a backend metric layer or read model for canonical metrics.
- Add dashboard filters and cross-filtering as data contracts, not only UI
  widgets.
- Cache expensive charts separately from operational writes.

Sources:
- https://superset.apache.org/
- https://superset.apache.org/user-docs/using-superset/creating-your-first-dashboard/

### Metabase

Why it matters:
Metabase is a mature open-source analytics product focused on simple
dashboard filters and drill-through exploration.

Useful pattern for AilaoDa:
- Dashboard-level filters avoid duplicate dashboards for every period or
  business segment.
- Drill-through should turn a chart click into a filtered record list.
- Table cell and chart point actions are part of the analytics workflow.

Sources:
- https://www.metabase.com/docs/latest/dashboards/filters
- https://www.metabase.com/docs/latest/questions/visualizations/drill-through

### React-admin

Why it matters:
React-admin is a mature open-source admin framework. Its list architecture
separates data fetching, filtering, pagination, and display layout.

Useful pattern for AilaoDa:
- Keep list state as a formal context or model.
- Desktop can render a table while mobile renders a simpler list/card layout.
- React-admin's `SimpleList` mobile switch is a good pattern for our
  `DataTable` and `EnterpriseDataGrid` mobile card view.

Sources:
- https://marmelab.com/react-admin/List.html

### TanStack Table / TanStack Virtual

Why it matters:
TanStack libraries are headless and fit the current custom design better than
dropping in a full visual grid framework.

Useful pattern for AilaoDa:
- Model global search separately from column filters.
- Support manual server-side filtering for large ERP data.
- Keep filter state serializable for URLs and saved presets.
- Use virtualization only when the UI truly renders many rows without
  pagination; pagination and server filtering should stay the default for
  operational ERP tables.

Sources:
- https://tanstack.com/table/v8/docs/guide/column-filtering
- https://tanstack.com/virtual/latest

### Material React Table / AG Grid

Why it matters:
These are useful comparison points for mature grid behavior, even if AilaoDa
keeps its custom grid primitives.

Useful pattern for AilaoDa:
- Per-column filter variants should be declared in column definitions.
- Select/autocomplete filters work well for status, customer, SKU, and user.
- Date and number filters need first-class UI, not keyword hacks.
- Virtualization should be opt-in and measured.

Sources:
- https://www.material-react-table.com/docs/guides/column-filtering
- https://www.material-react-table.com/docs/guides/virtualization
- https://www.ag-grid.com/react-data-grid/filtering/

## Recommended AilaoDa Direction

### 1. Executive Operating Dashboard

Build this as an operating cockpit, not a generic chart wall.

Minimum model:
- `GET /api/dashboard/executive-summary`
- `GET /api/dashboard/revenue-trend?period=month&compare=previousYear`
- `GET /api/dashboard/cash-forecast`
- `GET /api/dashboard/receivables-aging`
- `GET /api/dashboard/customer-segments`
- `GET /api/dashboard/kpi-drilldown?...`

First screen:
- Global KPI strip: revenue, gross margin, overdue AR, cash runway,
  inventory risk.
- Main trend: revenue/profit with YoY and MoM comparison.
- Risk pane: AR aging, stock risk, approval backlog.
- Drill action: click any KPI/chart segment to open a filtered business list.
- Mobile owner summary: today's revenue, cash risk, overdue AR, urgent
  approvals, top exception.

### 2. Smart Filter Contract

Add typed filter definitions to the table primitives before adding more UI.

Suggested shape:
- `text`
- `dateRange`
- `numberRange`
- `amountRange`
- `multiSelect`
- `entitySelect`
- `boolean`

The filter state should be:
- serializable
- URL-friendly
- usable for client-side and server-side filtering
- saved as presets/favorites later
- auditable in reports and browser tests

### 3. Mobile Data Card View

Do not treat mobile as a squeezed table.

Recommended table primitive additions:
- `mobileCard?: (row) => ReactNode`
- `mobilePrimaryText?: (row) => ReactNode`
- `mobileSecondaryText?: (row) => ReactNode`
- `mobileMeta?: (row) => Array<{ label, value, tone? }>`
- `mobileActions?: (row) => ReactNode`

Rules:
- Desktop remains table-first.
- Mobile defaults to cards for record lists.
- Warehouse, shipping, collections, and sales order lists should be first.
- Horizontal scroll stays as a fallback only for dense expert views.

### 4. Import Governance

Odoo-style filters and ERPNext-style list discipline are not enough for bulk
data. Imports need a deliberate flow.

Minimum import flow:
- Parse file.
- Show preview with mapped columns.
- Validate required fields and domain values.
- Choose duplicate strategy: skip, update, create new, manual review.
- Submit accepted rows.
- Export rejected rows with error messages.

## Suggested Order Of Work

1. Research-backed audit and roadmap.
2. Smart Filter typed contract in `EnterpriseDataGrid`.
3. Mobile card renderer for `EnterpriseDataGrid`.
4. Dashboard executive API contract and mock-safe frontend shell.
5. Real executive metrics backed by read models.
6. Import preview and rejected-row export.
7. Optional TanStack Table/Virtual adoption only after the custom primitive
   reaches the limits of its current implementation.

## Decision

For this repo, the best path is not to embed Superset/Metabase/Odoo inside
AilaoDa. Use them as pattern references. Keep the product experience native,
because this ERP already has strong custom workflows, permissions, and audit
scripts. Adopt headless libraries only where they strengthen primitives:
TanStack Query for server state, TanStack Table concepts for filter state, and
TanStack Virtual for measured long-list rendering.
