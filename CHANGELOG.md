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

### Changed

- Dashboard overview and trend reads now use the shared server-state query layer.
- Upgraded root `axios` to reduce production dependency audit findings.

### Known Gaps

- SQLite remains the default runtime database artifact.
- Frontend strict TypeScript is not enabled.
- Smart Filter contract is not implemented yet.
- Mobile card data view is not implemented yet.
- Executive dashboard metrics are still partial.
- Client-side UI state is still mostly AppContext/useState; scoped store migration remains pending.
- Production dependency audit still reports non-TanStack residual findings in `xlsx` and transitive packages from existing dependencies.
