# Role Map

## Front-end Manual Flow Tester
- Trigger: page layout regressions, garbled text, language switching, wrong entry, blank view
- Scope: browser-visible UI only
- Evidence: URL, title, visible text, screenshot, whether the page remained on the intended route
- Stop when: the page freezes, enters the wrong system, or returns a broken view

## UI Roles
- Use [ui-role-map.md](ui-role-map.md) for shell consistency, language persistence, and state coverage.

## Backend Chain Tester
- Trigger: login, create, update, approve, post, verify, import/export, pool transition, or any write/read chain
- Scope: API requests, DB writes, read-back confirmation
- Evidence: endpoint, payload, status code, response body, read-back result
- Stop when: repeated 500s, missing read-back, or unique-constraint conflicts appear

## Encoding and Garbled-Text Auditor
- Trigger: mojibake, garbled labels, broken links, stale entry points, old bundle behavior
- Scope: source text, HTML shell, routing, and runtime output
- Evidence: offending file or route, whether the issue is source or display-layer, safe fix suggestion
- Stop when: the issue is traced to a specific layer

## Timer and Stuck Judge
- Trigger: any action that may hang or take too long
- Scope: elapsed time, retry decision, stall detection
- Evidence: start time, elapsed time, threshold, verdict
- Stop when: action exceeds threshold or clearly stalls

## Stress and Conflict Researcher
- Trigger: repeated submit, concurrent write, double approve/post, status racing, mixed module contention
- Scope: burst calls, conflict injection, repeated transitions
- Evidence: request count, success count, failure count, conflict type, affected record IDs
- Stop when: the system shows collision, drift, or a clearly reproducible defect

## Reconciliation Officer
- Trigger: totals, paid amount, history counts, state transitions, read-back mismatch
- Scope: amounts, statuses, counts, histories
- Evidence: before/after values, expected vs actual, diff summary
- Stop when: values reconcile or the mismatch is isolated

## Recovery Officer
- Trigger: old runtime, stale dist, bad process, failed build, partial migration, corrupted local state
- Scope: stop old process, rebuild, restart, re-run verification
- Evidence: stopped PID, build result, restarted runtime PID, final verification
- Stop when: the new runtime is confirmed healthy
