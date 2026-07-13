---
name: erp-audit-roles
description: Use when auditing, testing, stabilizing, or recovering the ERP/CRM system with role-based UI checks, manual flows, backend chain checks, encoding triage, timing control, concurrency stress, reconciliation, or recovery.
---

# ERP Audit Roles

## Overview

Use this skill to run role-based ERP audits and point tests without losing the system's current design language or runtime assumptions. It turns UI checks, manual testing, backend verification, encoding triage, timing checks, stress injection, reconciliation, and recovery into a repeatable operating model.

## Why this skill exists

The workflow is intentionally modeled as a team of specialist operators: each role has a narrow mission, a clear stop condition, and a concrete deliverable. This keeps the audit reliable and prevents one long, mixed prompt from drifting across UI, front-end, backend, timing, and recovery work.

## When to use

Use this skill when the request involves one or more of the following:
- UI shell consistency, language switching, layout drift, or state rendering
- Manual page-by-page ERP/CRM testing
- Backend write/read chain validation
- Encoding, garbled text, wrong-entry, or stale-entry-point triage
- Timeout, stuck-job, or long-running action control
- Concurrency, duplicate submission, or conflict injection
- Amount/state reconciliation
- Restart, rebuild, rollback, or recovery after a failure

## Role Set

Load the matching reference and keep the role boundaries strict:
- Front-end manual flow tester
- UI consistency auditor
- UI language auditor
- UI state tester
- Backend chain tester
- Encoding and garbled-text auditor
- Timer and stuck judge
- Stress and conflict researcher
- Reconciliation officer
- Recovery officer

See [references/role-map.md](references/role-map.md) for the exact trigger, evidence, and stop conditions for each role.
See [references/ui-role-map.md](references/ui-role-map.md) for UI-specific role boundaries and evidence rules.

## Operating Model

1. Pick the smallest role set that covers the task.
2. Run UI, front-end, backend, encoding, and reconciliation checks in parallel when they do not depend on each other.
3. Keep recovery and rebuild actions serialized.
4. Timebox every action; never wait forever.
5. Record evidence immediately after each role finishes.
6. If a result depends on the current runtime, verify the runtime was restarted after any code change.

For release-readiness or high-risk flows, pair this skill with:
- `erp-anti-hallucination-review`

## Output Expectations

Return concise findings with:
- role used
- what was tested
- whether it passed
- what failed or got stuck
- evidence path or command/result summary
- next action if recovery is needed

## Guardrails

- Do not change visual style unless a defect is confirmed.
- Do not call a UI change complete until shell, language, and state behavior are checked in the browser.
- Do not treat a source fix as complete until the runtime has been rebuilt or restarted if required.
- Prefer low-risk, reversible edits before structural changes.
- Keep the role matrix stable; extend it only when a new repeated failure mode appears.

## Resources

- [references/role-map.md](references/role-map.md)
- [references/ui-role-map.md](references/ui-role-map.md)
- [references/operating-checklist.md](references/operating-checklist.md)
- [../erp-anti-hallucination-review/SKILL.md](../erp-anti-hallucination-review/SKILL.md)
