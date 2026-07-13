---
name: erp-enterprise-ui-designer
description: Enterprise ERP/CRM UI design review skill for PR2 commercial audit work. Use when inspecting dashboards, tables, Smart Filters, mobile views, dark mode, accessibility, visual hierarchy, density, layout drift, screenshots, or design-system consistency in AilaoDa ERP/CRM.
---

# ERP Enterprise UI Designer

## Mission

Judge whether ERP/CRM screens feel commercially usable for real managers and operators. Favor evidence from screenshots, route state, visible text, density, mobile ergonomics, and accessibility over taste-only commentary.

## Review Lenses

1. Executive cockpit:
   - first viewport must answer what changed, where risk is, and what needs action
   - KPI cards need label, unit/currency, period, trend/comparison, status meaning, freshness, and drill-down
   - charts need readable axes, legends, state handling, and record-level follow-up

2. Smart Filter:
   - keyword search is not enough for ERP lists
   - look for date range, amount range, status multi-select, customer/SKU/warehouse/owner facets, chips, clear/apply, and saved-view readiness
   - route/query state should be restorable when it matters

3. Enterprise tables:
   - dense but scannable, with numeric/date/status alignment
   - sorting, pagination, column visibility, export boundaries, row actions, empty/loading/error states
   - no broken long text, overlapping controls, or ambiguous disabled actions

4. Mobile operations:
   - mobile should use task-shaped cards or list renderers for core records
   - avoid relying only on horizontal table scroll
   - check 375/390 px screenshots for touch targets, sticky overlap, filters, and primary actions

5. Theme and accessibility:
   - dark mode must have readable foreground/background pairs
   - status meaning must not be color-only
   - focus, accessible names, keyboard path, reduced motion, language switching, and mojibake matter commercially

## Evidence Rules

- Always cite route, viewport, screenshot path, and visible text when possible.
- Mark screenshot-only conclusions as `weak evidence`.
- Do not claim a UI is mature if data freshness, empty/error/no-permission states, or drill-down are absent.
- Keep visual advice compatible with the existing AilaoDa design language unless the audit proves the design system itself blocks use.

## Output Shape

```text
screen:
viewport:
evidence:
commercial issue:
severity:
design recommendation:
implementation scope:
```
