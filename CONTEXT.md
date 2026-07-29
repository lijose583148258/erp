# AilaoDa ERP Program Context

## Purpose

AilaoDa ERP is a fast-operating system for Chinese and Vietnamese chemical trading and manufacturing businesses. It must support high-frequency human entry, changing orders and formulas, batch inventory, procurement, production, collections, goods-offset settlement, and auditable operational control without becoming a heavyweight ERP that operators avoid.

This file is the shared context for product, architecture, security, testing, release, and operational decisions. When a proposal conflicts with this file or an accepted ADR, the conflict must be resolved and documented before implementation.

## Business environment

- Operators work under time pressure and frequently copy from Excel, WeChat, email, supplier documents, and historical orders.
- The business includes chemical trading, batch manufacturing, procurement, warehouse operations, shipping, collections, and barter/goods-offset settlement.
- Chinese, English, and Vietnamese data and UI paths are required.
- Orders, formulas, material availability, prices, exchange rates, delivery dates, and settlement methods change frequently.
- The user budget for software licensing is zero. Commercially usable open-source software or existing project code must be preferred.
- The system must remain operable on lower-end Windows desktops, weak networks, long browser sessions, and common factory peripherals.

## Product principles

1. Normal work must be fast; exceptional or risky work must be visible.
2. Draft entry may be flexible; posted inventory, verified payments, cost ledgers, released batches, and published BOM versions must be controlled and auditable.
3. Human-readable errors must explain what happened, whether data was saved, and the next corrective action.
4. No workflow is considered complete because a YAML file or static audit passes. Runtime evidence is required.
5. Synthetic-scale evidence must never be represented as real production-data evidence.
6. New capabilities must be introduced behind a reversible boundary or feature flag.
7. The existing production route must remain available until the replacement proves better with the same business data and save-readback contract.
8. No paid, Pro, Enterprise, trial-locked, per-developer, per-instance, or unclear-license component may become a required production dependency.

## Current technical baseline

- Frontend: React 19.2.4, TypeScript, Zustand, TanStack Virtual, Recharts.
- Backend: Node.js, TypeScript, Prisma, SQLite compatibility path, PostgreSQL deployment path.
- Enterprise topology under test: PostgreSQL primary/replica, Redis/Sentinel, object storage, search, Prometheus, OpenTelemetry, and two application instances.
- Existing enterprise audits cover build, security, authentication, permissions, concurrency, finance, inventory, PostgreSQL migration, HA, load, backup, browser workflows, and operational evidence.
- BOM currently supports percentage and fixed consumption, standard batch scaling, process stages, substitution groups, loss and variance fields, Excel-style paste helpers, stock/cost risk summaries, and production transaction linkage.

## Current evidence status

As of 2026-07-29:

- A synthetic-scale SQLite database with 56 user tables and exactly 170,911 rows has been exercised.
- Enterprise Release Certification passes on the current certification branch for synthetic-scale evidence.
- PostgreSQL import, controlled business writes, SQLite rollback, dual application instances, and browser business flows have passed in the certification workflow.
- Cloud adversarial build, static gates, dynamic attack probes, load probes, and post-attack database reconciliation pass; the final release verdict remains blocked by production dependency advisories.
- The real 56-table / 170,911-row business snapshot has not yet been executed in GitHub Actions with the required private snapshot, manifest, backup, and SHA-256 inputs.
- Production eligibility is therefore false.

## Non-negotiable release blockers

A release must not be declared production-ready while any of the following is true:

- Critical or high-severity production dependency advisories remain without an approved, time-bounded exception and compensating control.
- Real snapshot import, comparison, rollback, and post-rollback business writes have not passed.
- Finance, inventory, cost, payment, and barter invariants have unresolved drift.
- Role and data-scope bypasses, stale-token privilege retention, direct URL/API ID tampering, or audit-log access violations remain.
- PostgreSQL, Redis, application-instance, object-storage, or search failure behavior lacks runtime evidence.
- Backup/PITR restore order and restored business fingerprints are unproven.
- Release rollback, migration failure recovery, disk-full behavior, secret rotation, and observability alert delivery are unproven.
- Critical human workflows cannot be completed by operators using keyboard, Chinese/Vietnamese IME, weak-network recovery, and readable feedback.

## Domain terms

- **BOM**: a versioned formula/recipe defining planned material consumption and process metadata.
- **Work order**: an executable production instruction that must preserve a BOM snapshot.
- **Material master**: the canonical identity, units, aliases, compliance, quality, supplier, and packaging data for a material.
- **Temporary material**: a fast-entry material identity permitted in drafts but subject to promotion rules before controlled use.
- **Batch genealogy**: the traceable relationship from input material batches through a work order to output batches and customer shipments.
- **Stock entry**: the immutable voucher header authorizing a real inventory change.
- **Stock movement**: the before/delta/after line recording a batch/location inventory change.
- **Verified payment**: a payment accepted by finance and included in order receivable state.
- **Barter settlement**: a controlled goods-value offset that may affect inventory, receivables/payables, cash difference, and reversal records.
- **Evidence class**: `synthetic-scale`, `real-snapshot`, or a future explicitly defined class. The class must be shown in every verdict.

## Architecture decision hierarchy

1. This context and accepted ADRs define the current boundaries.
2. Database transactions and server-side authorization are authoritative.
3. Frontend state machines and UI validation improve usability but cannot replace server enforcement.
4. Existing interfaces and data paths are preserved during migration through adapters, dual-write, feature flags, or compatibility fields.
5. New infrastructure is introduced only when measured load or business evidence shows the existing boundary is insufficient.

## Open-source policy

Preferred licenses for production code are MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, PostgreSQL, and similarly permissive licenses after review.

GPL, LGPL, MPL, EPL, AGPL, dual licenses, source-available licenses, and repositories containing mixed community/enterprise code require explicit legal and architectural review before use. BUSL/BSL, SSPL, Commons Clause, PolyForm, non-commercial, trial, unknown, or proprietary dependencies are blocked by default.

Every new production dependency requires:

- exact package and version;
- upstream repository and commit/tag;
- SPDX license and copyright notice;
- direct and transitive dependency review;
- maintenance and security review;
- React 19.2.4 / Node 22 compatibility evidence where applicable;
- SBOM and third-party notice inclusion;
- rollback/removal plan.

## Execution method

Every improvement follows this loop:

1. Establish the current fact from code, data, documents, and runtime evidence.
2. Identify the user/business risk and the invariant that must hold.
3. Define an acceptance test and evidence artifact before changing code.
4. Implement the smallest reversible change.
5. Run local isolated tests and GitHub Actions tests.
6. Compare data, logs, screenshots, metrics, and fingerprints.
7. Fix failures and repeat without weakening the gate.
8. Record the decision, residual risk, and rollback path.

## Release authority

Draft pull requests remain unmerged until all required gates for their scope pass. A green subset of checks cannot override a failed release verdict. Production readiness requires an explicit consolidated verdict referencing the exact commit, evidence class, environment, artifacts, unresolved risks, and rollback plan.
