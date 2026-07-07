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

### Changed

- Dashboard overview and trend reads now use the shared server-state query layer.
- Dashboard frontend service now imports shared contract types instead of
  declaring local response interfaces.
- Upgraded root `axios` to reduce production dependency audit findings.

### Known Gaps

- SQLite remains the default runtime database artifact.
- Frontend strict TypeScript is not enabled.
- Smart Filter contract is not implemented yet.
- Mobile card data view is not implemented yet.
- Executive dashboard metrics are still partial.
- Client-side UI state is still mostly AppContext/useState; scoped store migration remains pending.
- Shared contracts are still partial: Dashboard has frontend compile-time
  adoption and backend source-field audit, but backend route code does not yet
  compile against generated/shared response contracts.
- Production dependency audit still reports non-TanStack residual findings in `xlsx` and transitive packages from existing dependencies.
