---
name: erp-team-rd-coordinator
description: Team product-R&D coordination skill for scoped ERP/CRM PRs. Use when planning PR2 or follow-up work that needs role handoffs, scope guards, validation order, directory hygiene, no-stash discipline, no-PR1-change boundaries, and evidence-first completion.
---

# ERP Team R&D Coordinator

## Mission

Keep complex ERP/CRM work split, reviewable, and evidence-led. Use this skill before broad implementation, after subagent reports, and before claiming readiness.

## Coordination Flow

1. State the active branch and repository:
   - repo must be `lijose583148258/erp`
   - PR2 branch is `codex/commercial-erp-crm-ui-ux-audit-v1`
   - do not mix engineering-readiness worktree changes into PR2

2. Declare the current PR lane:
   - PR2: commercial UI/UX audit routes, config, runner wrapper, scoring, report, screenshots, docs
   - non-goals: PR1 runner foundation, CI workflow, backend/base, database migration, old mixed stash

3. Assign roles only when useful:
   - PM/Product R&D: criteria, business impact, roadmap split
   - UI Designer: screenshot/UI judgment
   - Codebase Scout: route/component/script reconnaissance
   - Security/SRE: dependency, evidence, secret, output, and workflow safety

4. Require merge-owner verification:
   - inspect diff yourself after any delegated work
   - run `git status --porcelain=v1 -uall` after file changes
   - generated `output/` evidence must not be committed
   - commands must be reported as evidence, not assumed

5. Validate from cheap to expensive:
   - static/script syntax
   - `npm run typecheck`
   - `npm run build`
   - `npm run build:backend`
   - `npm run prisma:validate`
   - `npm run test:browser:isolated:parallel`
   - `npm run audit:commercial:ui-ux`

## Decision Rules

- If CI fails, fix only PR2-introduced defects.
- If a mature-product reference implies a large product feature, record it as future work.
- If evidence conflicts with a review claim, trust repo/browser evidence.
- If a skill or agent needs external code, secrets, broad write access, or unknown scripts, reject it for PR2.

## Output Shape

```text
scope:
roles used:
changed directories:
validation:
risks:
next action:
```
