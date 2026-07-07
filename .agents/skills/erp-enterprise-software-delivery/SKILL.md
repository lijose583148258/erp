---
name: erp-enterprise-software-delivery
description: Enterprise software delivery skill for ERP/CRM development. Use when planning, reviewing, or implementing production-grade enterprise app work involving PR scope, architecture, security, observability, testing, release gates, audit evidence, CI hygiene, dependency safety, and multi-role engineering handoffs.
---

# ERP Enterprise Software Delivery

## Mission

Keep AilaoDa changes enterprise-grade: scoped, auditable, secure, tested, and traceable from business risk to code and evidence.

## Delivery Lenses

1. Product and business boundary:
   - identify actor, transaction, permission, lifecycle, report, and audit trail
   - separate operational workflow, analytics/read model, integration, and governance concerns
   - do not let a UI request smuggle backend/base or CI refactors into the PR

2. Architecture and ownership:
   - define source of truth, write path, read path, and cross-module dependency
   - prefer small modular monolith boundaries before introducing new platforms
   - record major choices as ADRs or scoped docs

3. Quality gates:
   - static checks before browser checks
   - validate route ownership, source freshness, generated artifacts, and no stale output
   - use business-loop tests for money, stock, status, permission, import, and AI data paths

4. Security and compliance:
   - apply secure defaults for React, Express, TypeScript, auth, uploads, secrets, logs, and external APIs
   - avoid unknown installers, prompt packs, browser extensions, and dependency installs without a dependency PR
   - keep generated evidence out of commits

5. Observability and release:
   - require health/readiness, metrics, logs, audit events, and recovery notes for production claims
   - do not call build success production readiness
   - keep CI workflow changes isolated unless the current PR owns them

## PR Workflow

1. Confirm repo, branch, changed files, and non-goals.
2. Read local docs and existing patterns before editing.
3. Make the smallest scoped change.
4. Run `git status --porcelain=v1 -uall` after file modifications.
5. Validate cheap to expensive.
6. Report evidence, residual risk, and next PR boundaries.

## Enterprise Agent Roster

Use these as local roles, not external packages:

- Product owner: business value, non-goals, acceptance language
- Enterprise architect: boundaries, data ownership, lifecycle, ADRs
- UI/product designer: workflow ergonomics, accessibility, mobile, density
- QA/release engineer: validation matrix, generated artifacts, CI signal
- Security/SRE reviewer: secrets, privacy, dependencies, logs, recovery
- Codebase scout: route/source/script ownership and stale entry detection

## Output Shape

```text
scope:
business risk:
owned files:
non-goals:
validation gates:
evidence:
follow-up PR:
```
