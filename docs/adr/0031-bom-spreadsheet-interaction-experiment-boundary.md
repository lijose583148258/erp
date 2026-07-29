# ADR 0031: BOM Spreadsheet Interaction Experiment Boundary

## Status

Accepted for controlled experiment only

## Context

BOM entry is a specialized high-frequency chemical manufacturing workflow. It requires continuous keyboard entry, Chinese and Vietnamese IME safety, matrix paste from Excel, bulk fill, deterministic validation, undo/redo, and save-readback consistency. These requirements are materially different from general ERP list browsing.

ADR 0013 remains the accepted boundary for general-purpose `EnterpriseDataGrid`: existing table markup with `@tanstack/react-virtual` for viewport virtualization. ADR 0019 requires zero production dependency vulnerabilities and treats spreadsheet input as untrusted.

The project must not replace the production BOM grid based on feature claims alone. Any candidate grid must be isolated from `BomItemDraft`, production transactions, and persistence through an adapter and must satisfy zero-commercial-license constraints.

## Decision

Create a controlled BOM grid laboratory before any production replacement.

- Keep the current production BOM page and transaction path unchanged.
- Add isolated routes for the existing React/TanStack implementation and, only after dependency approval, MIT `react-data-grid` as a candidate.
- Do not introduce AG Grid Enterprise, Handsontable commercial editions, Pro plugins, trial-locked features, or dependencies whose commercial-use boundary is unclear.
- Use a `BomGridAdapter` so candidate-grid APIs cannot leak into BOM domain models, validation, formulas, or save payloads.
- Reuse one sanitized BOM fixture and one validation/save-readback contract across candidates.
- Treat React 19.2.4 and Node 22 compatibility as measured gates, not documentation assumptions.
- Keep `exceljs` during the experiment; spreadsheet dependency removal or replacement is a separate ADR and security migration.
- Do not add another state-management or virtualization library when existing Zustand and `@tanstack/react-virtual` cover the requirement.
- Before adding any candidate dependency, record exact version, SPDX license, copyright notice, transitive dependency tree, maintenance activity, known advisories, React/Node compatibility evidence, and required notices in the open-source dependency inventory.

## Required gates

A candidate is ineligible if any of the following fails:

- Chinese or Vietnamese IME composition is committed early, lost, or duplicated.
- A 300-row tabular paste shifts columns, truncates rows, or bypasses validation.
- Keyboard navigation, insert/delete, focus recovery, or save-readback is nondeterministic.
- The 1,000-row fixture exceeds the agreed browser performance budget or causes visible blocking.
- Core behavior requires a paid, Pro, Enterprise, trial, or feature-locked package.
- Production dependency audit, license scan, SBOM generation, TypeScript build, browser tests, or existing certification gates fail.

Promotion requires a separate adoption ADR, a feature flag, staged rollout, and an always-available rollback to the existing BOM page.

## Consequences

ADR 0013 continues to govern general grids. This ADR creates a narrow exception for BOM interaction experiments without committing the product to a new grid library. No candidate may enter the formal BOM route until evidence demonstrates better operator throughput without weakening business validation, security, licensing, or rollback controls.
