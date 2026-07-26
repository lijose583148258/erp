# ADR-0001: Governed BOM Grid PoC

- Status: Experimental
- Date: 2026-07-26
- Decision owners: ERP product, production operations, engineering, security

## Context

The existing BOM page is retained. Building spreadsheet behavior from scratch has high IME, focus, clipboard, virtualization, accessibility, and maintenance risk. Selecting a grid by screenshots would create vendor lock-in and false confidence.

## Decision

Run two isolated candidates:

- `/production/bom-grid-lab/revogrid`
- `/production/bom-grid-lab/react-data-grid`

Both candidates must use the same:

- `BomGridAdapter`;
- `BomItemDraft` and `BomGridRow`;
- Decimal calculation and Zod validation;
- golden fixtures;
- production BOM save/readback API;
- operation sequence and scoring rubric.

Business code must not call candidate-internal APIs. Candidate APIs are confined to `RevoGridLab.tsx` and `ReactDataGridLab.tsx`.

## Hard rejection gates

- Chinese or Vietnamese IME loses text;
- Enter commits during composition;
- 300-row paste shifts columns or loses rows;
- focus drifts after insertion;
- material editor cannot be controlled;
- a core requirement needs a Pro/commercial feature;
- dependency or bundle growth exceeds the agreed budget;
- dark theme or keyboard accessibility regresses;
- React 19.2.4 build is unstable;
- save/readback differs in any field;
- commercial or unknown-license code enters the production bundle.

## Weighted score

| Criterion | Weight | Veto |
|---|---:|---|
| Chinese/Vietnamese IME | 20 | yes |
| 300-row copy/paste | 20 | yes |
| Keyboard continuity | 15 | yes |
| Save/readback consistency | 15 | yes |
| Material editor | 10 | yes |
| Undo/redo | 5 | no |
| 1000-row performance | 5 | no |
| React 19.2.4 compatibility | 5 | yes |
| Testability | 3 | no |
| Bundle/dependency risk | 2 | no |

Adoption requires at least 85/100, every veto gate passing, build/typecheck/browser gates passing, and zero commercial or unknown-license code in the bundle.

## Rollout boundary

Formal adoption remains disabled:

```dotenv
VITE_BOM_GRID_V2_ENABLED=false
VITE_BOM_GRID_V2_USER_IDS=
```

Rollout order: developers, test accounts, one high-frequency operator, limited production department, default-on, then old-page retirement review. The existing page and transaction chain remain the rollback path.

## Deferred design-only topics

- Zod expansion outside BOM;
- Decimal database migration;
- ExcelJS light migration;
- PostgreSQL material search;
- BOM versions and work-order snapshots;
- material master data, quality, compliance, genealogy, accounts payable, and general ledger.
