# ADR 0021: Frontend Bundle Performance Budget

## Status

Accepted

## Context

The application now uses route-level lazy loading and manual vendor chunks, but production readiness still needs a measurable bundle budget. Vite warns when a raw chunk exceeds 500 KiB, and the spreadsheet import/export chunk is intentionally heavy because Excel parsing is loaded on demand rather than on the initial shell.

Without a repository-owned budget, frontend performance regresses through incidental dependency growth and the team has no objective signal beyond occasional build warnings.

## Decision

Add `scripts/frontend-bundle-budget-audit-v1.cjs` and expose it as `npm run audit:frontend:bundle-budget`.

The audit reads `dist/assets` after `npm run build`, computes raw and gzip sizes, and enforces budgets by category:

- entry JS
- app CSS
- route/module JS
- shared vendor JS
- spreadsheet JS
- total JS/CSS assets

The spreadsheet chunk keeps a separate budget because it is an explicit user-triggered import/export capability. It must remain isolated as `spreadsheet: ['exceljs']` in `vite.config.ts` and must not inflate the entry chunk.

## Consequences

Bundle size now has an auditable gate instead of relying on visual inspection of build logs. The current threshold is a foundation, not a final performance SLO.

Future work should add browser-level route timing budgets, mobile device profiles, and a lighter spreadsheet path if Excel import/export becomes common in first-session workflows.
