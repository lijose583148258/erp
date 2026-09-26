# Chemical ERP enterprise foundation plan

## Verified baseline

The current system has connected sales, procurement, batch stock, production consumption/output, cost ledger, receivables, barter posting, reversal, RBAC, audit, idempotency, and concurrency controls. It is suitable for a controlled internal pilot, not an unrestricted enterprise or regulated-chemical launch.

Verified structural gaps:

- business documents identify materials mainly by free-text names;
- 107 Prisma `Float` fields remain; 5 existing `Decimal` fields are confined to structured production-quality measurements and do not yet make commercial ledgers Decimal-native;
- legacy BOM rows may still lack a reviewed shelf-life policy; new BOM creation and automatic batch creation now fail closed instead of silently defaulting to 365 days;
- quality checks do not persist individual specifications and results;
- batch genealogy and recall are reconstructed indirectly rather than persisted;
- barter posting primarily offsets customer receivables;
- no accounts-payable, journal-entry, general-ledger, or tax-posting model;
- chemical compliance data is not a governed master-data domain.

## Workstreams and release order

### P0 — prevent incorrect legal or financial facts

1. Remove silent 365-day shelf-life behavior.
   - **Implemented in code:** governed `shelfLifeDays` on BOM, required by UI/API/OpenAPI, and required again inside the completion transaction before automatic finished-batch creation.
   - **Verified locally:** a 365-day audit BOM produced a batch whose persisted production/expiry timestamps differ by exactly 365 days; missing or invalid policies are rejected by focused service tests.
   - Migrate existing batches with evidence and exception status, never by guessing.
2. Freeze creation of new free-text variants.
   - Introduce material matching/temporary-material workflow before full migration.
   - Log unresolved aliases and prevent silent duplicate creation.
3. Define Decimal migration contract.
   - Money `NUMERIC(18,2)`.
   - Quantity/percentage/density `NUMERIC(18,6)`.
   - Exchange rate and unit cost `NUMERIC(18,8)`.
   - Dual-write, reconcile, switch-read, rollback; no in-place blind conversion.
   - **Expand/backfill implemented for the first receivables slice:** 9 shadow fields across orders, payment records, and receivable adjustments, with SQLite/PostgreSQL write triggers and reconciliation evidence.
   - **Still blocked from read cutover:** real 170,911-row PostgreSQL reconciliation, same-window business/API proof, backup rollback, and Decimal API serialization remain required.

Exit gates:

- no automatic expiry without a governed source;
- every new commercial or stock line has a stable material reference or explicit temporary-material state;
- Float/Decimal shadow values reconcile on historical production-scale data.

### P1 — material and chemical compliance master data

Core entities:

```text
Material
MaterialAlias
MaterialLocalizedName
MaterialPackaging
MaterialUnitConversion
MaterialComplianceDocument
MaterialJurisdictionRule
MaterialLicenseRequirement
```

Minimum controlled fields:

- internal material code and lifecycle state;
- Chinese, English, and Vietnamese names;
- CAS, UN, HS, GHS classification and pictograms;
- transport class, restricted/precursor/explosive flags;
- packaging, net/gross conversion, storage conditions, shelf life;
- SDS version/language/effective dates;
- COA template assignment;
- country-specific sale/transport/license restrictions.

Migration:

1. inventory names;
2. BOM material names/codes;
3. sales order items;
4. purchase order items;
5. product batches and stock balances;
6. shipment/RMA/discrepancy records.

Every migration mapping is reviewable, reversible, and fingerprinted.

### P1 — quality, release, genealogy, and recall

Entities:

```text
QualityTemplate
QualityTemplateItem
QualityInspection
QualityInspectionResult
QualityDisposition
RetentionSample
BatchConsumption
BatchGenealogyEdge
BatchRecallCase
BatchRecallImpact
```

Required behavior:

- measured value, unit, lower/upper limits, method, instrument, analyst and timestamp;
- pass, fail, retest, release, hold, rework, downgrade and scrap;
- electronic release separated from data entry;
- raw batch → actual quantity → work order → finished batch → shipment → customer;
- forward and backward trace;
- recall scope, affected stock/customers, disposition and closure evidence.

Exit gates:

- one-click trace in both directions;
- no shipment of held/unreleased batch;
- recall result reconciles with inventory and shipment ledgers.

### P2 — payable, accounting, tax, and barter finance

Entities:

```text
SupplierInvoice
AccountsPayableOpenItem
SupplierSettlement
ChartOfAccount
JournalEntry
JournalLine
TaxCode
PostingRule
AccountingPeriod
```

Controls:

- debit equals credit for every posted journal;
- posted documents are immutable and corrected by reversal/adjustment;
- closed-period writes are rejected;
- customer barter and supplier barter use symmetric open-item clearing;
- valuation, approval and posting duties are segregated;
- valuation expiry, evidence, ownership and tax documents are enforced.

### P2 — production process depth

- equipment/reactor master;
- batch instruction and actual operation log;
- charge sequence/time, temperature, pressure, agitation, feed rate, hold/cool time;
- cleaning status, shift/team, deviation and CAPA;
- work-order BOM snapshot so later formula changes cannot alter historical truth.

## Parallel engineering workstream

The governed grid PoC may proceed in parallel because it is isolated, reversible, and does not change the production transaction chain. It cannot be used as evidence that the material, Decimal, quality, genealogy, compliance, or accounting gaps are solved.

## Data migration invariants

Every schema migration must publish:

- source and target row counts;
- per-table content hashes;
- material mapping conflicts;
- money, quantity, inventory and cost reconciliations;
- sequence and foreign-key validation;
- rollback fingerprint;
- post-rollback business write/read proof.

## Rollout stages

1. developer accounts;
2. isolated QA and synthetic production-scale data;
3. one trained high-frequency operator;
4. limited department with daily reconciliation;
5. controlled pilot with rollback window;
6. production default-on only after observation and disaster-recovery gates;
7. old-path retirement only after a separate ADR.

## Non-goals for the current PoC

- no Meilisearch, BullMQ, Valkey, Temporal, PaddleOCR or Flowable;
- no additional state or virtualization library;
- no complete spreadsheet engine;
- no copying GPL/AGPL ERP source;
- no removal of the current BOM page, ExcelJS, paste parser, production transaction, Zustand or TanStack Virtual.
