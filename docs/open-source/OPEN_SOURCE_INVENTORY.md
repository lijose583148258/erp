# Open-source inventory baseline

## Admission policy

Dependencies are admitted only when they solve a verified requirement and remain behind an owned adapter.

### Automatically allowed

- MIT
- Apache-2.0
- BSD-2-Clause
- BSD-3-Clause
- ISC
- PostgreSQL License

### Mandatory manual review

- LGPL, MPL, EPL, GPL, AGPL
- dual or mixed licensing
- packages whose npm and repository license metadata disagree
- examples, plugins, themes, fonts, icons, or generated code under a different license

### Release blocking

- BUSL/BSL
- SSPL
- Commons Clause
- PolyForm
- non-commercial terms
- unknown license for any production dependency
- any RevoGrid Pro or other commercial-only module in the browser bundle

## Current BOM Grid PoC admission

Only these new direct dependencies are admitted:

| Package | Exact version | Purpose | Status |
|---|---:|---|---|
| `@revolist/revogrid` | `4.23.22` | RevoGrid Core candidate | Lab only |
| `react-data-grid` | `7.0.0-beta.61` | React-native grid candidate | Lab only |
| `zod` | `4.4.3` | Shared import and row validation | Accepted boundary |
| `decimal.js` | `10.6.0` | Deterministic client-side calculations | Accepted boundary |

No search server, queue, OCR engine, workflow engine, second state library, second virtualization library, or complete spreadsheet engine is admitted by this PoC.

## Generated evidence

Run:

```bash
npm run build
npm run audit:licenses:bom-grid-candidates
npm run audit:licenses
```

The candidate-only gate proves that the PoC did not introduce a disallowed package. The full gate
remains the release gate and must not be weakened when an older transitive dependency fails.
Evidence is written to `artifacts/licenses/`.
