# ADR 0019: Production Dependency Security Boundary

## Status

Accepted

## Context

Production dependency audit found a critical `protobufjs` advisory through the AI SDK dependency chain, high axios advisories, transitive spreadsheet-export advisories, and high `xlsx` advisories. ERP imports and exports spreadsheet files in several UI paths, so spreadsheet support needs a maintained implementation rather than removal.

The project needs a repeatable gate that rejects production dependency advisories and prevents the no-fix spreadsheet parser from returning through future imports.

## Decision

Upgrade direct dependencies and constrain vulnerable transitive packages with npm overrides.

- Upgrade `axios` and `@google/genai`.
- Replace the direct `xlsx` dependency with `exceljs` for browser import/export helpers and audit scripts.
- Override `protobufjs`, `ws`, `form-data`, `minimatch`, `brace-expansion`, and `uuid` to fixed ranges in `package.json`.
- Add `scripts/production-dependency-security-audit-v1.cjs`.
- Require `npm audit --omit=dev --json` to have zero production vulnerabilities.
- Reject direct or indirect application usage of the no-fix `xlsx` package.
- Add `utils/spreadsheetSecurity.ts` and `utils/spreadsheetIO.ts`; require spreadsheet imports to validate extension and size before workbook parsing.

## Consequences

Production advisories are now actively constrained instead of silently accepted through the lockfile.

Spreadsheet import/export keeps the current user workflow while moving away from the no-fix SheetJS package. The boundary still treats uploaded spreadsheets as untrusted input: files are user-triggered, extension-limited, and capped to the configured client-side size limit before parsing.
