# Contributing

This project is an ERP/CRM system with business-critical flows. Changes should
be evidence-driven and scoped tightly enough to review.

## Branch Scope

Keep unrelated work out of the same branch.

Examples:
- UI/UX audit work should not include backend/base/CI changes.
- Dashboard/filter/mobile work should not include PostgreSQL migration.
- PostgreSQL migration should not include visual redesign.

## Local Validation

Use the smallest validation set that proves the change, then widen before a PR.

Baseline commands:

```powershell
npm run typecheck
npm run build
npm run build:backend
npm run prisma:validate
```

Engineering readiness evidence:

```powershell
npm run audit:engineering:readiness
```

Browser/runtime changes should also run the relevant browser audit. Start the
stable runtime first when a browser audit needs the app:

```powershell
npm run start:stable
npm run test:browser:isolated:parallel
```

## Change Classes

- `architecture`: database, API contracts, module boundaries, state layers
- `product-experience`: dashboard, filters, mobile views, forms, tables
- `runtime`: Docker, packaging, health checks, observability, storage
- `security`: auth, permissions, CSRF/CSP, secret management
- `audit`: scripts, reports, screenshots, evidence collection
- `docs`: ADRs, runbooks, roadmap, contribution notes

## Evidence Expectations

For business flows, a green build is not enough. Prefer evidence that includes:
- API read-back
- browser read-back
- screenshot or report path for UI changes
- affected route/module list
- explicit non-goals

## Pull Request Notes

Each PR should state:
- scope
- non-goals
- changed files by category
- validation commands and results
- generated report paths when applicable
- known remaining gaps
