# ADR 0001: Research-First Operating Brain Roadmap

Status: Accepted

Date: 2026-07-07

## Context

AilaoDa ERP/CRM already has broad module coverage and a strong audit culture.
The current gaps are production-grade engineering foundation, executive
decision support, Smart Filters, mobile data views, and collaboration
governance.

External review also raised dashboard and mobile concerns. Source evidence
shows the dashboard already has a Recharts revenue trend chart and a trend API,
but it does not yet provide executive-grade YoY/MoM, cash forecast, AR aging,
customer tiering, retention, KPI drill-down, or a mobile owner summary.

Research reviewed mature and open-source products including ERPNext/Frappe,
Odoo, Apache Superset, Metabase, React-admin, TanStack Table/Virtual, Material
React Table, and AG Grid. SAP Fiori Analytical List Page was used as a mature
enterprise reference for KPI and visual-filter design.

## Decision

We will not embed a full BI platform or replace the current table primitives as
the first step.

We will:
- add repeatable engineering/product readiness evidence first
- keep native AilaoDa workflows, permissions, and audit scripts
- use researched products as pattern references
- implement Smart Filter state before dashboard drill-down
- add mobile card rendering to the existing grid primitives
- build executive dashboard APIs/read models before adding more visuals

## Consequences

Positive:
- Dashboard, filters, and mobile work share one filter model.
- The first implementation slice is smaller and easier to verify.
- AilaoDa keeps its domain-specific ERP workflows instead of becoming a
  generic BI shell.
- The roadmap can be reviewed through repeatable audit output.

Tradeoffs:
- Executive dashboard value arrives in stages rather than one large rewrite.
- Some mature BI features, such as cross-filtering and semantic metrics, need
  to be implemented deliberately in AilaoDa's backend contracts.
- Smart Filter work must be designed carefully enough to support both
  client-side and server-side filtering.

## Follow-up ADRs

- PostgreSQL runtime split and migration strategy
- Service worker/offline stale-data policy
- API versioning and OpenAPI contract strategy
- Cache strategy and Redis client choice
- Storage abstraction and S3/MinIO adapter strategy
