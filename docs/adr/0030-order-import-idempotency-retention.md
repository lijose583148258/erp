# ADR 0030: Order Import Idempotency Retention

## Status

Accepted

## Context

Persistent idempotency is required for safe bulk order imports, but retaining every replay response indefinitely would create unbounded JSON growth. Deleting a batch that still identifies imported orders would also destroy useful audit lineage.

## Decision

- Keep completed replay results for 30 days by default.
- After the replay window, mark the batch `expired` and remove only `result_json` and the obsolete lease token.
- Reject reuse of an expired idempotency key so an old request cannot silently execute again.
- Keep expired batches that remain linked to orders as compact lineage records.
- Permit deletion only when an expired batch is older than 365 days and has no linked orders.
- Expire abandoned processing batches only when both their lease and stale-processing window have elapsed.
- Limit every maintenance mutation to a configurable batch of at most 5,000 rows.
- Default to `report-only`; switch to `enforce` only in an operator-scheduled singleton job such as a Kubernetes CronJob.
- Do not run a cleanup timer in every application replica.

## Consequences

Replay payload storage is bounded while order lineage remains queryable. Maintenance is idempotent and safe under repeated scheduling, but operators must observe report-only counts before enabling enforcement and retain database backups according to the deployment policy.
