# Contributing

This ERP/CRM codebase is a governed operational system. Changes should be small, auditable, and backed by evidence that matches the business risk.

## Development Flow

1. Read the relevant module code before editing.
2. Keep changes scoped to one business or platform concern.
3. Add or update tests/audit scripts for new production claims.
4. Run the cheapest relevant checks first, then broader builds.
5. Record architecture decisions in `docs/adr/` when a change affects runtime, security, storage, API contracts, observability, or deployment.

## Common Validation Commands

```bash
npm run typecheck
npm --prefix backend run build
npm run build
npm run test:unit:frontend
```

Use targeted gates when touching these areas:

```bash
npm run audit:security:csp
npm run audit:security:csrf-boundary
npm run audit:observability:rum
npm run audit:storage:abstraction
npm run audit:cache:strategy
npm run audit:lists:server-query
npm run audit:db:postgres-artifact
npm run audit:deployment:readiness
```

## Backend Expectations

- API routes should be mounted through the route registry when they are part of the public ERP/CRM surface.
- Do not import Redis clients directly in business modules; use `CacheService`.
- Do not write upload files directly from controllers; use the file storage boundary.
- State-changing API changes must preserve audit logs, permissions, validation, and read-back behavior.
- Keep `/api` and `/api/v1` compatibility in mind for public routes.

## Frontend Expectations

- High-frequency lists must use server-side pagination/query contracts and must not silently fetch large fixed windows.
- Page-level route loading should stay behind `React.lazy` and `PageErrorBoundary`.
- Prefer the enterprise grid path for new operational tables.
- Do not add offline/PWA caching for authenticated business data without a stale-data and conflict policy.

## Security Expectations

- API authentication is currently Bearer-token based; cookie-based API authentication is not enabled.
- CSP must default to external same-origin scripts/styles without unsafe inline allowances.
- Demo/default credentials must not be able to mint business tokens in release safety mode.
- Secrets belong in runtime environment or a future secret manager, never source files.

## Documentation

- Update `CHANGELOG.md` for user-visible, operational, security, or architecture changes.
- Add an ADR for decisions that future maintainers need to understand, including rejected alternatives.
- Keep audit reports evidence-based; do not mark production readiness from build success alone.
