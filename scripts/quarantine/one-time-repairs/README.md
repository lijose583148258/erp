# One-time repair quarantine

These scripts are retained for forensic rollback only. They are not supported runtime or release entry points.

## Quarantined on 2026-08-01

| Script | Former purpose | Isolation evidence | Supported replacement |
|---|---|---|---|
| `stock-ledger-manual-inbound-source-ref-repair-v1.cjs` | One-time backfill of missing `source_ref` on posted manual inbound entries | No package command, GitHub workflow, active script reference, or non-generated report consumer | Current warehouse write path plus `npm run audit:stock:ledger` |
| `stock-ledger-opening-balance-repair-v1.cjs` | One-time opening-balance ledger backfill | No package command, GitHub workflow, active script reference, or non-generated report consumer | Versioned database migration/rehearsal and `npm run audit:stock:ledger` |

Do not execute these against a current database. If historical incident reconstruction requires one, restore it to an isolated branch, inspect its SQL against the matching schema revision, and run dry mode on a copied database first.
