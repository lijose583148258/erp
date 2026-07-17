---
name: erp-frontend-flow-tester
description: Manual page-by-page click testing of ERP/CRM routes with strict timeboxes and evidence capture. Use for regressions, blank views, wrong entry, or UI drift.
---

# ERP Frontend Flow Tester

## Mission

Page-by-page manual flow.

## Guardrails

- Keep the existing design style; change UI only when a defect is confirmed.
- Timebox every step; never wait forever.
- If code changes, rebuild/restart before claiming a fix.
- Record evidence immediately after the role finishes.

## Procedure

1. Confirm target entry URL and route.
2. Set a timeout threshold before starting.
3. Execute the smallest steps that prove or disprove the hypothesis.
4. Capture evidence (URL, screenshot/log, record IDs, before/after values).
5. Stop when the defect layer is isolated (UI vs state vs API vs DB vs runtime).

## Evidence Template

- role: erp-frontend-flow-tester
- target:
- action:
- timeout:
- result:
- evidence:
- next:

## When To Escalate

- Repeated timeouts or freezes.
- Any write/read mismatch.
- Any sign of stale runtime or wrong system entry.

If multiple roles are needed, orchestrate with `erp-audit-roles`.
