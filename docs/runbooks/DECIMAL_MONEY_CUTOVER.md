# Decimal money cutover runbook

## Scope

This runbook governs the first commercial Decimal slice:

| Table | Legacy fields | Shadow fields | Precision |
|---|---|---|---|
| `orders` | `final_amount`, `paid_amount`, `receivable_adjustment_amount` | matching `_decimal` fields | `NUMERIC(18,2)` |
| `payment_records` | `amount`, `exchange_rate`, `base_amount` | matching `_decimal` fields | money `18,2`; exchange rate `18,8` |
| `receivable_adjustments` | `amount`, `exchange_rate`, `base_amount` | matching `_decimal` fields | money `18,2`; exchange rate `18,8` |

The legacy fields remain the application read contract during the expand phase.

## Application calculation boundary

Before a database read cutover, every newly governed sales-order write must already
produce the same two-decimal value:

- interactive create and edit;
- bulk import;
- line amount (`quantity * unit price`);
- order total (sum of rounded line amounts);
- discount subtraction;
- paid/outstanding comparison.

These paths use `backend/src/utils/money.ts` and round each monetary line with
`ROUND_HALF_UP` before summing. Validation must run before Decimal conversion so
an invalid import remains a row-level rejection instead of aborting the whole
batch. `audit:db:decimal-shadow-contract` rejects a return to native JavaScript
money multiplication or accumulation in these governed write paths.

The same calculation boundary now governs legacy-field read models without
claiming a database read cutover:

- finance summary exchange-rate conversion and base-currency proration;
- finance totals, aging buckets, customer totals and monthly trends;
- deterministic collection and customer payment-rate ratios;
- collection milestone target, verified-payment sum and remaining amount.
- payment verification and order paid-state recalculation;
- per-customer overdue aggregation and collection-state synchronization;
- milestone paid-state transition after verified-payment aggregation.

These read models still receive legacy Prisma fields during the expand/observe
phase. Decimal calculation removes JavaScript binary-float drift from the API
result, but it does not prove that Prisma or the database is reading the shadow
`NUMERIC` columns.

Payment verification must continue to claim the pending payment and serialize
the related order inside one transaction. Decimal comparison replaces the old
integer-cent workaround; it does not replace the transaction lock or the
overpayment rejection.

## Release phases

### 1. Expand

1. Back up the database.
2. Apply the additive schema migration.
3. Backfill every shadow field.
4. Enable database triggers so old and new application versions both maintain shadows.
5. Reject the release if any shadow value is null or differs at its declared scale.

SQLite:

```powershell
npm --prefix backend run db:repair
npm run audit:db:decimal-shadow-contract
npm run audit:db:decimal-shadow
npm run audit:db:decimal-shadow-write
```

PostgreSQL:

```bash
POSTGRES_URL='postgresql://...' node scripts/postgres-schema-migrate-v1.cjs apply
POSTGRES_URL='postgresql://...' node scripts/postgres-schema-migrate-v1.cjs verify
AUDIT_DATABASE_URL='postgresql://...' npm run audit:db:decimal-shadow
```

Required result:

- 3 tables and 9 fields present;
- numeric precision and scale match the contract;
- null shadow rows = 0;
- mismatch rows = 0;
- rounded legacy sum equals shadow sum;
- all synchronization triggers present.

### 2. Observe

Keep application reads on legacy fields. Run reconciliation:

- after every deployment;
- after imports;
- after peak-hour payment verification;
- after receivable adjustment posting or reversal;
- before and after backup recovery;
- at least daily during the controlled pilot.

Any mismatch freezes the cutover. Preserve the database, report, application commit, migration ledger and affected row IDs before repair.

### 3. Switch read

Read cutover requires a separate change:

1. add Prisma Decimal mappings without removing legacy fields;
2. serialize Decimal values explicitly at the API boundary;
3. compare old/new API payloads for orders, collections, barter and finance reports;
4. use a reversible deployment flag with legacy as the immediate fallback;
5. repeat concurrent payment, reversal and adjustment invariants;
6. obtain human browser read-back evidence.

Do not switch write ownership and read ownership in the same release.

### 4. Contract

Legacy columns may be considered for removal only after:

- at least two stable releases read from Decimal;
- the full observation window has zero mismatches;
- rollback no longer requires an old application binary;
- all exports, SDKs, webhooks and reports consume the explicit Decimal API contract;
- a separate destructive-migration ADR is approved.

## Rollback

Before read cutover, rollback means deploying the previous application version. Database triggers keep shadow values synchronized and additive columns remain in place.

If a PostgreSQL migration fails, its migration transaction rolls back. Never manually mark the migration ledger as successful.

After read cutover:

1. switch the read flag back to legacy;
2. run the legacy business read/write smoke test;
3. reconcile all 9 shadow fields;
4. restore from the approved backup only when application rollback cannot preserve correctness;
5. record recovery time, fingerprint and first successful business write.

Dropping shadow or legacy columns is not a rollback action.

## Evidence

Generated evidence:

- `output/audit/decimal-shadow-reconcile-v1.json`
- `output/audit/decimal-shadow-reconcile-v1.md`
- `output/audit/decimal-shadow-write-path-v1.json`
- `output/audit/postgres-schema-migrate-v1.json`
- full release verification report under `output/audit/`

These reports prove only the provider and dataset named inside each report. SQLite evidence must never be presented as PostgreSQL production evidence.
