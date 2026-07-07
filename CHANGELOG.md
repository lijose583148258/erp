# Changelog

All notable changes should be recorded here. Use this file for user-visible,
operator-visible, and architecture-relevant changes.

## Unreleased

### Added

- Engineering production-readiness audit command.
- Research note for executive dashboard, Smart Filters, and mobile data views.
- Production-readiness roadmap.
- ADR process seed for research-first operating brain work.
- Contribution guide with validation expectations.
- TanStack Query server-state provider and Dashboard query-key migration.
- Shared Dashboard read-model contract and dashboard contract audit.
- Zustand Dashboard UI store and client-state audit.
- Vitest, Testing Library, jsdom, and frontend test foundation audit.
- EnterpriseDataGrid virtualized-row baseline and virtualized list audit.

### Changed

- Dashboard overview and trend reads now use the shared server-state query layer.
- Dashboard frontend service now imports shared contract types instead of
  declaring local response interfaces.
- Dashboard UI snapshots, tasks, inventory alerts, system status, chart data,
  and chart layout now use a scoped store instead of local component state.
- Frontend unit testing now runs Vitest/Testing Library before the existing
  lightweight runner.
- Upgraded root `axios` to reduce production dependency audit findings.

### Known Gaps

- SQLite remains the default runtime database artifact.
- Frontend strict TypeScript is not enabled.
- Smart Filter contract is not implemented yet.
- Mobile card data view is not implemented yet.
- Executive dashboard metrics are still partial.
- Scoped client state is only proven for Dashboard so far; broad AppContext
  responsibility reduction remains pending.
- Frontend test foundation is present, but coverage is still narrow and must
  expand to forms, table filters, mobile cards, and dashboard store behavior.
- Shared contracts are still partial: Dashboard has frontend compile-time
  adoption and backend source-field audit, but backend route code does not yet
  compile against generated/shared response contracts.
- Production dependency audit still reports non-TanStack residual findings in `xlsx` and transitive packages from existing dependencies.
- Virtualized rows are now available in `EnterpriseDataGrid`, but adoption is
  intentionally limited to local client-side pages; server-paged business
  tables still need route-level browser evidence before broad rollout.
