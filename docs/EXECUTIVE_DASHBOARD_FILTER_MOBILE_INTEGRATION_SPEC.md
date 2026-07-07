# Executive Dashboard, Smart Filter, and Mobile Card Integration Spec

This spec turns the research note into implementation-ready contracts. It is
not a visual redesign. It defines the shared state and API shape that should
let Dashboard, grids, mobile cards, and future KPI drill-downs evolve together.

## Research Inputs

Patterns reviewed:
- ERPNext/Frappe: dashboards, analytics pages, reports, workspaces, list
  filters, sorting, paging, tags, and view switching.
- Odoo: dashboards, search bar filters, group-by, favorites, date filters, and
  global spreadsheet/dashboard filters.
- SAP Fiori Analytical List Page: KPI tags, visual filters, compact filters,
  variant management, chart/table analytic flow.
- Apache Superset: semantic metrics, dashboard filters, cross-filtering,
  chart/dashboard separation.
- Metabase: dashboard filters, parameters, drill-through from chart/table
  interactions into filtered records.
- React-admin: list context, table/list iterator separation, SimpleList for
  mobile devices.
- TanStack Table: global filtering, column filtering, faceting, manual
  server-side filtering, serializable table state.
- AG Grid and Material React Table: filter variants, faceted values, range
  filters, select and multi-select filters.

Decision:
Use these products as patterns, not embedded products. AilaoDa should keep its
native ERP workflows, permission model, and audit scripts.

## Shared Filter Model

The first implementation should create this model before any dashboard
rewrite.

```ts
export type BusinessFilterKind =
  | 'text'
  | 'dateRange'
  | 'numberRange'
  | 'amountRange'
  | 'multiSelect'
  | 'entitySelect'
  | 'boolean';

export type BusinessFilterOperator =
  | 'contains'
  | 'equals'
  | 'in'
  | 'between'
  | 'gte'
  | 'lte'
  | 'isTrue'
  | 'isFalse';

export interface BusinessFilterDefinition {
  key: string;
  label: string;
  kind: BusinessFilterKind;
  field?: string;
  operator?: BusinessFilterOperator;
  options?: Array<{ label: string; value: string }>;
  entity?: 'customer' | 'supplier' | 'sku' | 'user' | 'warehouse' | 'status';
  defaultValue?: unknown;
  serverParam?: string;
  clientAccessor?: (row: unknown) => unknown;
}

export interface BusinessFilterState {
  keyword?: string;
  values: Record<string, unknown>;
  quickPreset?: string;
  updatedAt: string;
}
```

Rules:
- The state must serialize to URL query parameters.
- The same state must support client filtering and server filtering.
- `keyword` stays separate from fielded filters.
- Server-side grids pass the filter state through without client filtering.
- Saved presets can reuse the same shape later.
- Dashboard KPI drill-down links should point to route + filter state.

## EnterpriseDataGrid Contract

Extend `components/ui/EnterpriseDataGrid.tsx` first.

Proposed props:

```ts
type SmartFilterMode = 'client' | 'manual';

interface EnterpriseDataGridFilterProps<T> {
  filterDefinitions?: BusinessFilterDefinition[];
  filterState?: BusinessFilterState;
  onFilterStateChange?: (state: BusinessFilterState) => void;
  filterMode?: SmartFilterMode;
  defaultQuickPreset?: string;
  onSaveFilterPreset?: (state: BusinessFilterState) => void;
}
```

Behavior:
- If `filterMode='client'`, apply supported filters locally after keyword
  search and before sorting/paging.
- If `filterMode='manual'`, render controls and call `onFilterStateChange`,
  but do not filter `data` locally.
- If no `filterDefinitions` are provided, current behavior must remain
  unchanged.
- Filters should render in a collapsible panel above the table, not inside
  column headers, to match ERP workflows and mobile constraints.

Minimum first filter controls:
- date range
- amount/number range
- status multi-select
- entity select placeholder with text search fallback

## Mobile Card Contract

Extend `EnterpriseDataGrid` without replacing the desktop table.

Proposed props:

```ts
export interface MobileCardMetaItem {
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
}

export interface EnterpriseDataGridMobileProps<T> {
  mobileCard?: (row: T) => React.ReactNode;
  mobilePrimaryText?: (row: T) => React.ReactNode;
  mobileSecondaryText?: (row: T) => React.ReactNode;
  mobileStatus?: (row: T) => React.ReactNode;
  mobileMeta?: (row: T) => MobileCardMetaItem[];
  mobileActions?: (row: T) => React.ReactNode;
}
```

Behavior:
- Desktop and tablet continue to use the table.
- Small mobile viewports render cards when mobile props exist.
- If no mobile props exist, current horizontal table fallback remains.
- Row click, keyboard access, test IDs, and row actions must keep parity.

First adoption targets:
- Sales orders
- Warehouse stock balances
- Collections
- Procurement receiving

## Executive Dashboard API Contract

Dashboard work should start with API contracts and read models, not more
frontend-only cards.

Recommended endpoints:

```text
GET /api/dashboard/executive-summary
GET /api/dashboard/revenue-trend?period=month&compare=previousYear
GET /api/dashboard/cash-forecast
GET /api/dashboard/receivables-aging
GET /api/dashboard/customer-segments
GET /api/dashboard/kpi-drilldown?metric=overdueReceivables&...
```

Minimum response concepts:

```ts
interface ExecutiveKpi {
  key: string;
  label: string;
  value: number;
  unit?: 'money' | 'count' | 'percent' | 'days';
  previousValue?: number;
  deltaPercent?: number;
  trend?: 'up' | 'down' | 'flat';
  criticality?: 'good' | 'watch' | 'risk' | 'critical';
  drilldown?: BusinessDrilldownLink;
}

interface BusinessDrilldownLink {
  route: string;
  filters: BusinessFilterState;
}
```

Executive first screen:
- KPI strip: revenue, gross margin, overdue AR, cash runway, inventory risk.
- Main chart: revenue/profit trend with YoY/MoM.
- Risk panel: AR aging, approval backlog, stock risk.
- Customer panel: customer tier, repeat purchase, concentration risk.
- Mobile owner summary: today's money, cash risk, urgent approvals, top
  exception, one-tap drill-down.

## Filter To Dashboard Drill-Down

The key architecture decision is that dashboard drill-down should reuse the
same `BusinessFilterState` as grids.

Example:

```ts
{
  route: '#orders',
  filters: {
    keyword: '',
    quickPreset: 'overdue-ar',
    values: {
      paymentStatus: ['unpaid', 'partial'],
      dueDate: { to: '2026-07-07' },
      amount: { gte: 10000 }
    },
    updatedAt: '2026-07-07T00:00:00.000Z'
  }
}
```

This keeps SAP Fiori-style KPI drill-down, Metabase-style drill-through, and
Odoo-style saved filters connected through one contract.

## Acceptance Criteria

For Smart Filter PR:
- Existing `EnterpriseDataGrid` usages render unchanged without filter props.
- At least one module uses `dateRange`, `amountRange`, and `multiSelect`.
- Filter state is URL-serializable.
- Manual filtering mode calls the parent without local filtering.
- Client filtering mode has focused unit tests.

For Mobile Card PR:
- One high-value route renders cards on mobile and table on desktop.
- Mobile cards expose primary text, status, key metadata, and row actions.
- Browser screenshot evidence covers mobile and desktop.

For Executive Dashboard PR:
- Existing dashboard routes keep working.
- New endpoints are read-only.
- KPI values have backend read-back evidence.
- KPI drill-down opens a filtered business list.
- Mobile owner summary fits in one viewport without table scrolling.

## Non-Goals For The First Implementation

- Do not migrate PostgreSQL in the same PR.
- Do not introduce a full BI platform inside AilaoDa.
- Do not replace all table usages at once.
- Do not enable service worker/offline mode before stale-data policy ADR.
- Do not rewrite dashboard visuals before backend metric contracts exist.

## First Implementation Slice

Recommended first PR after this research package:

1. Add `BusinessFilterDefinition` and `BusinessFilterState`.
2. Add optional filter props to `EnterpriseDataGrid`.
3. Implement client filtering for date range, number/amount range, and
   multi-select.
4. Keep manual mode for future server-side modules.
5. Add one adoption in sales orders or collections.
6. Add focused tests once the frontend test foundation lands, or add a
   temporary script-level filter audit if the test stack is not yet available.
