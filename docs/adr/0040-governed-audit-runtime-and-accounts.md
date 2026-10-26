# ADR 0040: Governed audit runtime and isolated accounts

## Status

Accepted.

## Context

Runnable browser, API, concurrency, and reconciliation audits had accumulated two unsafe conveniences: published demo passwords and silent fallback to `D:/AilaoDaRuntime/stable.db`. The first can make a test exercise a shared account instead of an isolated fixture. The second can make an audit pass against the wrong database when the intended runtime is unavailable.

## Decision

1. Runnable audits resolve their database through `scripts/lib/audit-runtime-context.cjs`.
2. Resolution order is explicit `DATABASE_URL`, explicit `AILAODA_RUNTIME_DB_PATH`, then the stable-runtime origin report. No audit-specific fixed drive fallback is allowed.
3. SQLite audits fail when the resolved file is absent. PostgreSQL URLs remain explicit and are never rewritten as SQLite.
4. Audits create scope-specific accounts through `ensureUiAuditAccounts`. Passwords are random per process unless a private caller supplies one, and are never written to reports.
5. `active-audit-hardcode-ratchet-v1.cjs` scans scripts reachable from package commands and GitHub workflows, including recursively invoked scripts. Existing debt is explicit in a baseline. New debt and stale baseline entries both fail the gate.
6. A script may enter `scripts/quarantine/` only after reachability, replacement, and output-consumer evidence show that it is no longer an active entry point.

## Consequences

- An audit now fails closed instead of silently targeting a workstation-specific database.
- Concurrent runs use deterministic usernames but independent credentials, avoiding dependence on published demo accounts.
- The baseline is a temporary debt ledger, not an allowlist: every remediation must remove its matching entry.
- Generated audit reports remain under `output/` and are not committed.
