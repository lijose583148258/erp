# Engineering Production Research: Mature Open-Source Baselines

Date: 2026-07-07

This note complements the production-readiness audit. It focuses on mature
open-source and official platform references, then maps them back to AilaoDa
ERP/CRM. It is intentionally research-first: the goal is to decide the
engineering direction before attempting large migrations.

## Scope

The current project already has broad ERP/CRM coverage and a strong browser/API
audit culture. The missing layer is the production engineering baseline:

- production database path
- typed frontend/backend contracts
- server-state and client-state discipline
- component/unit test foundation
- API documentation
- observable runtime
- storage/search/cache strategy
- security and collaboration governance

This document should not be mixed into PR2 commercial UI/UX audit. It belongs
to the engineering-readiness branch and informs future focused PRs.

## Mature References Reviewed

### GitLab Self-Managed Reference Architectures

Why it matters:

GitLab is a mature self-managed product with explicit production reference
architectures. Its documentation treats PostgreSQL, Redis, object storage,
monitoring, RPS sizing, backups, and HA as deployment decisions, not optional
cleanup work.

Pattern for AilaoDa:

- Keep SQLite only as a local/dev convenience, not the production artifact.
- Size production by measured workload rather than vague "should be enough"
  assumptions.
- Treat PostgreSQL, Redis, object storage, backups, and monitoring as one
  runtime architecture.
- Start with a non-HA but backup-validated deployment if the customer footprint
  is small; add HA only when usage and business impact justify it.

Sources:

- https://docs.gitlab.com/administration/reference_architectures/

### Discourse

Why it matters:

Discourse is a mature open-source Rails application that standardizes
production dependencies rather than relying on an embedded database for
multi-user operation. Its hosted install path makes PostgreSQL, Redis, SMTP,
DNS, and backups first-class deployment concerns.

Pattern for AilaoDa:

- Treat database, cache/queue, email, and backup as release prerequisites.
- Keep one documented install path for production instead of many implied
  combinations.
- Make restoration and upgrades part of the release checklist.

Sources:

- https://github.com/discourse/discourse/blob/main/docs/INSTALL-cloud.md

### Odoo

Why it matters:

Odoo is a mature ERP suite. Its deployment documentation is explicit about
using PostgreSQL, configuring workers, reverse proxy, TLS, and long-polling.
This is relevant because AilaoDa is also an ERP/CRM product where concurrent
business users and background work are normal.

Pattern for AilaoDa:

- PostgreSQL should be the production database target.
- Runtime configuration should distinguish development from production.
- Reverse proxy, TLS, worker/process model, and long-running channels should be
  documented as deployment architecture.

Sources:

- https://www.odoo.com/documentation/19.0/administration/on_premise/deploy.html

### Frappe / ERPNext

Why it matters:

ERPNext/Frappe is a mature open-source ERP stack with a production setup
workflow and strong separation between framework, app, background jobs, and
bench-managed operations.

Pattern for AilaoDa:

- Keep operations scripts repeatable and documented.
- Treat background jobs and scheduled tasks as part of the product runtime.
- Separate operational dashboards and business reports from transactional write
  paths.

Sources:

- https://docs.frappe.io/erpnext
- https://github.com/frappe/erpnext

### TanStack Query

Why it matters:

TanStack Query is a mature server-state library for React. Its official
documentation frames server state as remote, asynchronous, shared, cacheable,
and potentially stale.

Pattern for AilaoDa:

- Stop expanding ad hoc `axios + useState` data fetching for read-heavy
  modules.
- Use query keys that include route, filters, pagination, tenant/org scope, and
  permissions where relevant.
- Invalidate after writes instead of manually refreshing unrelated components.
- Migrate one read-heavy surface first, such as collections or warehouse
  balances.

Sources:

- https://tanstack.com/query/latest/docs/framework/react/overview

### TanStack Virtual

Why it matters:

TanStack Virtual is a headless virtualization primitive. It fits a custom ERP UI
better than importing a full visual grid.

Pattern for AilaoDa:

- Keep server pagination as the default for business data.
- Add virtualization only for dense local lists that are proven to render too
  many rows at once.
- Avoid replacing the custom table design until evidence shows the primitive
  cannot scale.

Sources:

- https://tanstack.com/virtual/latest/docs/introduction

### Vitest

Why it matters:

Vitest is aligned with Vite and provides the missing component/unit layer under
the existing Playwright-heavy evidence system.

Pattern for AilaoDa:

- Add Vitest, Testing Library, and jsdom for fast UI primitive coverage.
- Keep Playwright for full business chains and browser evidence.
- Test pure business UI logic first: status badge mapping, filter state,
  amount/date range behavior, and mobile card rendering.

Sources:

- https://vitest.dev/guide/

### OpenAPI

Why it matters:

OpenAPI 3.1 is the standard contract language for HTTP APIs. AilaoDa currently
depends heavily on implicit frontend/backend agreements.

Pattern for AilaoDa:

- Publish a generated or maintained API artifact.
- Use schemas for request/response contracts on high-value routes.
- Generate frontend types or a typed SDK after the contract is stable.
- Add route inventory and contract drift checks to CI.

Sources:

- https://swagger.io/specification/

### OpenTelemetry And Prometheus

Why it matters:

The repo already has `/metrics` evidence, but production diagnosis needs
structured metrics and traces. OpenTelemetry gives traces; Prometheus client
libraries provide scrapeable metrics.

Pattern for AilaoDa:

- Keep the existing metrics endpoint as a foothold.
- Add request duration, error rate, DB timing, queue timing, and audit-run
  metrics with stable labels.
- Add OpenTelemetry traces after route/service boundaries are clearer.
- Document dashboards and alerts, not just raw metric output.

Sources:

- https://opentelemetry.io/docs/languages/js/getting-started/nodejs/
- https://github.com/prometheus/client_js

### Meilisearch

Why it matters:

Search engines are useful once customer/order/product volume makes SQL `LIKE`
queries too slow or too limited.

Pattern for AilaoDa:

- Do not add a search engine before query profiling and PostgreSQL migration.
- Start with indexed read models for customers, orders, products/SKUs, and
  documents.
- Treat index updates as eventual consistency with reconciliation.

Sources:

- https://www.meilisearch.com/docs/getting_started/first_project

## Current AilaoDa Mapping

### Engineering Architecture

Recommended order:

1. Evidence/governance PR.
2. PostgreSQL runtime track with migration, seed, backup/restore, and rollback.
3. frontend `src/` boundary and path alias cleanup.
4. shared contracts through OpenAPI/Zod/generated types.
5. TanStack Query for one read-heavy module.
6. scoped client store only after the query layer is proven.
7. repository/service boundary migration module by module.

Key guard:

Do not enable `strict: true` and migrate directories in the same PR. First add
an opt-in strict config and a failing audit so the team can see the blast
radius.

### Performance And Experience

Recommended order:

1. Preserve the existing route lazy-loading and `PageErrorBoundary` evidence.
2. Add Web Vitals collection.
3. Add mobile card views and Smart Filters before virtualization.
4. Add TanStack Virtual only where a measured list actually needs it.
5. Use memoization based on React profiler or route-specific evidence, not
   broad mechanical wrapping.

### Production Readiness

Recommended order:

1. API versioning compatibility layer.
2. storage abstraction with local and S3/MinIO-compatible adapters.
3. one Redis client and documented key/TTL/invalidation strategy.
4. OpenTelemetry traces and Prometheus dashboard docs.
5. search/read-model strategy after PostgreSQL.
6. real-time notifications after event contracts and versioned API are stable.

### Security And Collaboration

Recommended order:

1. CSP and CSRF ADR with staged enforcement.
2. MFA design for privileged roles.
3. managed secret provider adapter for production.
4. ADRs for PostgreSQL, offline/PWA policy, cache, API versioning, storage, and
   observability.
5. CONTRIBUTING and CHANGELOG policy.
6. generated SDK and webhook envelope after OpenAPI exists.

## Decision

The correct next engineering move is not a single "big production rewrite".
It is a sequence of evidence-backed PRs:

1. keep the audit honest and repeatable;
2. make the first shared UI/data contract testable;
3. add frontend unit-test capability;
4. then tackle PostgreSQL and OpenAPI with enough validation to avoid breaking
   the existing ERP/CRM workflows.

This keeps the project moving toward production-grade engineering without
regressing the release branch or mixing unrelated PR2 UI/UX audit work.
