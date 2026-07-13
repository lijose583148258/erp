---
name: erp-codebase-scout
description: Read-only ERP/CRM codebase reconnaissance skill. Use before editing PR2 audit work to map routes, components, scripts, package commands, runner integration, generated evidence paths, changed files, and stale or conflicting implementation points.
---

# ERP Codebase Scout

## Mission

Find the real route, component, script, and evidence ownership before edits. This skill is intentionally read-only unless the user grants a separate narrow write task.

## Recon Checklist

1. Confirm repo and branch:
   - `git remote -v`
   - `git branch --show-current`
   - `git status --porcelain=v1 -uall`

2. Locate PR2 surfaces:
   - `docs/COMMERCIAL_UI_UX_AUDIT_PR2.md`
   - `docs/COMMERCIAL_UI_UX_OPEN_SOURCE_RESEARCH.md`
   - `scripts/audit-routes/commercial-erp-crm-ui-ux-routes.cjs`
   - `scripts/commercial-erp-crm-ui-ux-audit-v1.cjs`
   - `package.json` audit script wiring

3. Locate application evidence:
   - route registry and hash navigation
   - dashboard, CRM, orders, collections, finance, shipping, production, warehouse, procurement, team, audit pages
   - DataTable and EnterpriseDataGrid primitives
   - language/theme/context providers

4. Check runner boundary:
   - do not edit `scripts/parallel-isolated-playwright-audit-v1.cjs` unless PR2 cannot run without a narrow fix
   - prefer route config and wrapper changes
   - keep `output/` generated evidence untracked

5. Report conflicts:
   - stale routes
   - expected text mismatches
   - screenshot path mismatch
   - forbidden changed files
   - package script gaps

## Preferred Commands

Use `rg` first:

```powershell
rg -n "audit:commercial:ui-ux|commercial-erp-crm-ui-ux|ISOLATED_PLAYWRIGHT_ROUTES_FILE" .
rg -n "hash: '#|case 'dashboard'|activePath|DataTable|EnterpriseDataGrid" app pages components scripts
```

## Output Shape

```text
branch:
changed files:
owned files:
route/script map:
risks:
safe edit set:
```
