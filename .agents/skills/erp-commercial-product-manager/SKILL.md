---
name: erp-commercial-product-manager
description: Commercial ERP/CRM product-management skill for PR2 UI/UX audit work. Use when converting mature ERP, CRM, BI, dashboard, Smart Filter, mobile, import, or executive-cockpit research into scoped audit criteria, product recommendations, non-goals, and follow-up PR sequencing for AilaoDa.
---

# ERP Commercial Product Manager

## Mission

Turn research and screenshots into business-useful ERP/CRM judgments without expanding the current PR scope. Treat PR2 as an audit and evidence layer, not a product implementation PR.

## Workflow

1. Confirm scope first:
   - commercial ERP/CRM UI/UX audit only
   - use PR1 isolated Playwright runner as foundation
   - no runner foundation, CI, backend/base, database migration, or old stash work

2. Map each finding to a business question:
   - owner visibility: cash, revenue, margin, receivables, stock risk, production, exceptions
   - operator speed: search, typed filters, table density, import, export, actions
   - mobile reality: boss phone view, warehouse task view, sales travel view
   - trust: freshness, source drill-down, permission state, empty/error states

3. Score product maturity conservatively:
   - `missing`: not visible or not reachable in evidence
   - `partial`: visible but lacks context, filtering, drill-down, state handling, or mobile usability
   - `mature`: visible, traceable, role-aware, mobile-aware, and supported by screenshot plus route evidence

4. Convert mature-product research into criteria, not dependencies:
   - ERPNext/Frappe: dashboard/report/list separation
   - Odoo: filters, group-by, favorites, import review
   - SAP Fiori: KPI criticality, visual filters, analytical list flow
   - Power BI/Metabase/Superset: filters, drill-through, semantic metrics
   - AG Grid/MUI X/TanStack/Carbon/PatternFly: typed filters and table anatomy

5. Keep recommendations actionable:
   - name the route, viewport, issue category, evidence path, severity, and business impact
   - separate `PR2 audit finding` from `future implementation recommendation`
   - do not invent data or mark a feature ready from visual similarity alone

## Output Shape

Prefer concise product notes:

```text
finding:
evidence:
business impact:
commercial maturity:
future PR:
non-goal boundary:
```

## Red Lines

- Do not recommend adding large BI/admin frameworks inside PR2.
- Do not call the dashboard absent when local evidence shows a trend chart; call it partial if executive intelligence is missing.
- Do not treat screenshot-only evidence as product readiness.
- Do not let architecture review leads override the PR2 commercial UI/UX audit boundary.
