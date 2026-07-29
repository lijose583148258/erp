# ADR 0019: Production Dependency Security Boundary

## Status

Accepted

## Context

Production dependency audit found a critical `protobufjs` advisory through the AI SDK dependency chain, high axios advisories, transitive spreadsheet-export advisories, and high `xlsx` advisories. ERP imports and exports spreadsheet files in several UI paths, so spreadsheet support needs a maintained implementation rather than removal.

On 2026-07-26, the upstream ExcelJS 4.4.0 tree still resolved vulnerable Archiver/Unzipper transitive versions. `npm audit fix` suggested ExcelJS 4.1.1, but an isolated install proved that downgrade still contained nine advisories. The repository also declared `@google/genai` without importing it from any active source file.

A direct `archiver@8.0.0` override made `npm audit` green but failed the real ExcelJS streaming API with `Archiver is not a function`, and its eager ESM load broke Jest. That result was rejected as a false green.

The project needs a repeatable gate that rejects production dependency advisories and prevents the no-fix spreadsheet parser from returning through future imports.

## Decision

Use exact production versions, remove unused runtime dependencies, and constrain vulnerable transitive packages only after an executable compatibility probe.

- Upgrade `axios`; remove the unused `@google/genai` direct dependency.
- Replace the direct `xlsx` dependency with `exceljs` for browser import/export helpers and audit scripts.
- Pin ExcelJS exactly to `4.4.0`.
- Keep official `archiver@8.0.0`, but expose its current classes through the repository-owned `backend/packages/archiver-exceljs-compat` legacy factory expected by ExcelJS 4.x. The adapter also bridges ExcelJS `StreamBuf` to a Node `PassThrough`; it does not buffer the complete worksheet.
- Resolve ExcelJS' `archiver` dependency to that local compatibility package with an npm `$archiver` override. Override `unzipper@0.12.5` and `uuid@11.1.1`.
- Override `protobufjs`, `ws`, `form-data`, `minimatch@10.2.5`, `brace-expansion@5.0.8`, and `uuid` to fixed versions in `package.json`.
- Require Node `>=20.19.0`, where synchronous `require(esm)` interoperability is enabled by default.
- Load `exceljs/lib/doc/workbook` through the backend spreadsheet boundary so ordinary API startup and exports do not eagerly load the optional streaming writer.
- Add `scripts/production-dependency-security-audit-v1.cjs`.
- Require `npm audit --omit=dev --json` to have zero production vulnerabilities.
- Require the dependency gate to create, write, parse, and compare both document and streaming XLSX workbooks containing Chinese, Vietnamese, numbers, a formula, and styles. This prevents a forced major transitive override from becoming a security-only false green.
- Reject direct or indirect application usage of the no-fix `xlsx` package.
- Add `utils/spreadsheetSecurity.ts` and `utils/spreadsheetIO.ts`; require spreadsheet imports to validate extension and size before workbook parsing.
- Build the license/SBOM inventory from both the root and backend lockfiles. When a package manifest omits SPDX metadata, only an exact recognized package LICENSE text may supply the effective classification, while preserving the original declaration and evidence source.

## Consequences

Production advisories are now actively constrained instead of silently accepted through the lockfile.

Spreadsheet import/export keeps the current user workflow while moving away from the no-fix SheetJS package. The boundary still treats uploaded spreadsheets as untrusted input: files are user-triggered, extension-limited, and capped to the configured client-side size limit before parsing.

The compatibility overrides are an explicit temporary maintenance boundary, not permission to auto-upgrade major versions. Any change to ExcelJS, Archiver, Unzipper, Minimatch, Brace Expansion, or UUID must rerun the runtime probe, frontend build, backend tests, production audit, and full license gate.

The isolated compatibility proof passed on the signed official Node 20.20.2 Windows binary (archive SHA-256 `dc3700fdd57a63eedb8fd7e3c7baaa32e6a740a1b904167ff4204bc68ed8bf77`) and the local Node 24 runtime. Node 22 remains enforced by CI and production image validation.
