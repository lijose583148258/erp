# ADR 0033: Canonical material master before AI/vector search

- Status: Accepted
- Date: 2026-07-29

## Context

Sales, procurement, inventory, batches, and production BOMs currently preserve product or
material identity mainly as free text. Similar Chinese, English, Vietnamese, customer,
supplier, and legacy names can therefore split stock, cost, compliance documents, and
traceability across multiple identities.

Vector search can improve discovery, but it cannot be the source of truth for inventory,
price, cost, compliance, or accounting. Those values must come from permission-scoped,
transactional records.

## Decision

1. Introduce `Material` as the canonical relational identity and `MaterialAlias` as a
   multilingual, many-alias search surface.
2. Keep `ProductionBomItem.materialId` nullable during migration. Draft BOMs may retain
   legacy text, but any non-draft/controlled BOM must reference an active, non-temporary
   material.
3. Snapshot canonical material code and name into each BOM line for historical readability,
   while retaining `materialId` for governed joins.
4. Reject blocked/retired materials, unit mismatches, stale optimistic-concurrency writes,
   and activation of temporary records.
5. Expose the contract under both `/api/materials` and `/api/v1/materials`, guarded by
   separate read/write permissions and same-transaction audit events.
6. Apply the change additively in SQLite repair and versioned PostgreSQL migration paths.
7. Use exact/relational material search first. A future unified AI search may route to this
   API, but must not answer live business facts from embeddings or stale vectors.

## Consequences

- Duplicate display names remain legal because grade/specification can differ; codes remain
  unique and aliases are unique only within a material.
- Existing records are not silently relinked. A reviewed backfill must propose candidates,
  show ambiguity, and require confirmation before writing `materialId`.
- Unit conversion is deliberately not inferred. A separate governed unit-of-measure model
  is required before cross-unit BOM selection can be allowed.
- Material administration UI, bulk deduplication/backfill, quality specifications, SDS/COA,
  GHS/CAS compliance, batch genealogy, and Decimal conversion remain subsequent slices.

## Rollout and rollback

1. Create material records as temporary drafts.
2. Review code, aliases, unit, specification, and compliance identity.
3. Activate only after clearing `isTemporary`.
4. Link draft BOM lines through the canonical lookup.
5. Enforce canonical linkage when a BOM leaves draft.
6. Roll back application behavior by keeping BOMs in draft and omitting `materialId`; the
   additive tables and nullable column do not require destructive rollback.
