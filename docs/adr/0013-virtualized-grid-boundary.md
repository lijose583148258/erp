# ADR 0013: Virtualized Grid Boundary

## Status

Accepted

## Context

High-frequency ERP screens can reach thousands of customer, order, collection, procurement, and shipping rows. Server-side pagination and search are still the primary production strategy, but some operating workspaces load large local result sets for export, filtering, or reconciliation.

Rendering every loaded row at once creates avoidable DOM pressure, scroll jank, and white-screen risk on lower-end desktops. The original deterministic window helper proved the rendering boundary, but maintaining scroll measurement, browser resize handling, and dynamic row heights locally would duplicate mature open-source infrastructure.

## Decision

Use `@tanstack/react-virtual` inside `EnterpriseDataGrid` and remove the local virtual-window algorithm.

- `EnterpriseDataGrid` enables row virtualization by default when the loaded page exceeds a threshold.
- TanStack Virtual owns viewport observation, measured row sizes, overscan, and total-size calculation.
- The grid keeps its existing table markup, sticky header, sticky first column, row actions, sorting, export, and pagination behavior.
- Virtualization is scoped to the currently loaded page or server page; it does not replace server-side pagination, filtering, or search.
- `OperatingDataGrid` passes through a `virtualized` toggle for high-frequency operating pages.
- `scripts/virtualized-grid-audit-v1.cjs` verifies the production dependency, hook integration, row measurement, spacer contract, and operating-grid passthrough.

## Consequences

Large loaded pages mount only the measured visible row window plus overscan rows, reducing DOM size without changing the business data contract. Dynamic row heights and viewport changes are delegated to a maintained library instead of local scroll math.

This is not a replacement for database-level pagination, indexes, or search engines. Future work should add measured browser performance budgets and mobile-specific list renderers.
