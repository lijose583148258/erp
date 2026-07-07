---
name: erp-evidence-first-reasoning
description: Evidence-first reasoning workflow for AilaoDa ERP/CRM work. Use when the user asks to align with Claude/Fable-like thinking, when claims conflict, when an audit could become false-green, or when PR2 commercial UI/UX work needs planner/executor/verifier separation, scoped evidence, directory hygiene, and clear non-goals.
---

# ERP Evidence-First Reasoning

## Mission

Make ERP/CRM work harder to fool. This skill converts broad requests, external review claims, and visual impressions into a controlled loop: state the claim, gather evidence, make the smallest scoped change, verify the exact requirement, then report what is proven and what is still only a lead.

This skill can absorb Claude/Fable-like planning habits as a workflow pattern, but it must not claim exact compatibility with a proprietary or unverifiable "Claude Fable" system.

## Core Loop

1. Claim:
   - Rewrite the user request or review note as verifiable claims.
   - Mark each claim as current PR scope, future PR lead, or rejected for safety.
   - Preserve explicit non-goals.

2. Evidence:
   - Inspect current files, commands, screenshots, reports, or route state before trusting memory.
   - Prefer local repo evidence and official documentation over summaries.
   - If public/external research is used, keep it as criteria unless the PR explicitly owns implementation.

3. Plan:
   - Separate planner, executor, and verifier roles even when one agent performs them.
   - Choose the smallest edit set that makes the target claim more true.
   - Define the stop condition and the command or artifact that proves progress.

4. Execute:
   - Edit only the current lane.
   - For PR2, stay inside commercial UI/UX audit routes, configs, report generation, local skills, and docs.
   - Do not smuggle runner foundation, CI workflow, backend/base, database migration, or old stash changes into the audit PR.

5. Verify:
   - Run cheap checks before expensive checks.
   - Distinguish route evidence health from product readiness.
   - Treat build success, HTTP 200, and screenshot existence as partial evidence only.

6. Report:
   - Say what is proven, what is weak evidence, what is out of scope, and what belongs in a future PR.
   - Include changed directories and validation commands.
   - After file changes, run `git status --porcelain=v1 -uall` and summarize the directory state.

## PR2 Reasoning Rules

- Repository: `lijose583148258/erp`.
- Branch: `codex/commercial-erp-crm-ui-ux-audit-v1`.
- Scope: commercial ERP/CRM UI/UX audit only.
- Allowed: route definitions, commercial-readiness criteria, evidence collection, screenshots, report generation, local skills, and documentation.
- Blocked: PR1 runner behavior, CI workflow, backend/base, database migration, old mixed stash, broad architecture implementation.
- Generated output under `output/` must remain uncommitted.

## False-Green Traps

- Do not say "merged", "ready", "production-grade", or "complete" without checking authoritative current state.
- Do not call a dashboard absent if source or screenshot evidence shows a partial dashboard.
- Do not mark AI features safe from UI copy alone; require role isolation, privacy gate, and eval/red-team evidence.
- Do not mark product maturity from the PR2 automated route score alone.
- Do not accept external AI review text as fact until local files or browser evidence confirm it.

## Output Shape

```text
claim:
evidence checked:
scope decision:
edit set:
verification:
directory state:
proven:
not proven / future PR:
```
