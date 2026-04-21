---
name: erp-anti-hallucination-review
description: Use when auditing or shipping ERP/CRM changes to prevent false-green outcomes (build-only pass, API-only pass, stale entry routing, schema drift, and report-level misreads). Enforces anti-hallucination gates before declaring completion.
---

# ERP Anti-Hallucination Review

## Overview

Use this skill to stop false confidence during ERP/CRM development.  
It turns "looks good" into a repeatable evidence process.

## When to use

Use this skill when:

- a change touches money, stock, status transitions, or permissions
- someone claims "ready", "stable", or "can go live"
- build passes but behavior still feels risky
- reports look green but route/data/runtime may still be wrong
- browser and API outcomes might disagree

## Mandatory Gates

You must pass these gates in order:

1. L0 problem-layer identification
2. L1 static/build checks
3. L2 route/shell checks
4. L3 real business loop checks
5. L4 backup/recovery checks when needed
6. L5 near-live stability checks when release claims are made

Do not skip gates by confidence or intuition.

## Core Rules

- AI is not the judge. Evidence is the judge.
- Never treat `build` as release readiness.
- Never treat `HTTP 200` as business closure.
- For high-risk domains, require API read-back and browser read-back.
- If old entry points still exist, verify active route ownership before editing.
- Keep report fields collision-safe (`formulaStatus`, `workOrderStatus`, etc.).

## Encoding Rule (always-on)

For garbled text or label drift, run:

1. translate intent
2. identify layer
3. fix only the right layer

Then enforce a mojibake gate:

- required labels must exist
- known garbled tokens must not exist

## Timebox Rule (always-on)

- Every action must have a timeout.
- Over 5 minutes requires a stuck verdict and next action.
- No infinite waiting loops.

## Output Template

- scope:
- risk level:
- gate reached:
- evidence:
- mismatch:
- decision:
- next action:

## References

- [anti-hallucination-checklist.md](references/anti-hallucination-checklist.md)
- [AI防幻觉开发制度_2026-04-16.md](../../../爱劳达软件治理中心/10_主线任务/AI防幻觉开发制度_2026-04-16.md)
- [模块验收分层标准_2026-04-16.md](../../../爱劳达软件治理中心/10_主线任务/模块验收分层标准_2026-04-16.md)
- [上线前反幻觉检查表_2026-04-16.md](../../../爱劳达软件治理中心/10_主线任务/上线前反幻觉检查表_2026-04-16.md)
