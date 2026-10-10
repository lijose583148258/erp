const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const contract = JSON.parse(read('backend/src/database/decimal-shadow-v1.json'));
const repairSource = read('backend/src/database/runtime-schema-decimal-repair.ts');
const repairOrchestrator = read('backend/src/database/runtime-schema-repair.ts');
const migration = read('backend/prisma/postgres-migrations/202608010004_receivables-decimal-shadow/migration.sql');
const reconcileAudit = read('scripts/decimal-shadow-reconcile-audit-v1.cjs');
const writePathAudit = read('scripts/decimal-shadow-write-path-audit-v1.cjs');
const releaseGate = read('scripts/run-release-verification-v1.cjs');
const enterpriseVerdict = read('scripts/enterprise-release-verdict-v1.cjs');
const enterpriseReleaseWorkflow = read('.github/workflows/enterprise-release-certification.yml');
const enterpriseCloudWorkflow = read('.github/workflows/enterprise-cloud-sandbox.yml');
const orderItemNormalization = read('backend/src/services/order-item-normalization.ts');
const orderImportService = read('backend/src/services/order-import.service.ts');
const orderUpdateService = read('backend/src/services/order-update.service.ts');
const orderController = read('backend/src/controllers/order.controller.ts');
const moneyBoundary = read('backend/src/utils/money.ts');
const financeSummaryService = read('backend/src/services/finance-summary.service.ts');
const collectionHelpers = read('backend/src/services/collection/collection.helpers.ts');
const collectionQueryService = read('backend/src/services/collection-query.service.ts');
const collectionStateService = read('backend/src/services/collection-state.service.ts');
const barterCalculations = read('backend/src/services/barter/barter.calculations.ts');
const barterAgreementService = read('backend/src/services/barter/barter-agreement.service.ts');
const barterQueryService = read('backend/src/services/barter/barter-query.service.ts');
const barterService = read('backend/src/services/barter.service.ts');
const procurementDomainService = read('backend/src/services/procurement-domain.service.ts');
const stockMovementService = read('backend/src/services/stock-movement.service.ts');
const productionCostLedgerService = read('backend/src/services/production-cost-ledger.service.ts');

assert.equal(contract.version, '2026-08-01-receivables-decimal-shadow-v1');
assert.deepEqual(contract.tables.map(table => table.table), [
  'orders',
  'payment_records',
  'receivable_adjustments',
]);

const fields = contract.tables.flatMap(table => table.fields.map(field => ({ table: table.table, ...field })));
assert.equal(fields.length, 9);
assert.equal(fields.filter(field => field.kind === 'money' && field.precision === 18 && field.scale === 2).length, 7);
assert.equal(fields.filter(field => field.kind === 'exchange_rate' && field.precision === 18 && field.scale === 8).length, 2);
assert.equal(new Set(fields.map(field => `${field.table}.${field.shadowColumn}`)).size, fields.length);

for (const table of contract.tables) {
  for (const field of table.fields) {
    assert.match(migration, new RegExp(`"${field.shadowColumn}" NUMERIC\\(${field.precision},${field.scale}\\)`));
    assert.match(migration, new RegExp(`ROUND\\("${field.legacyColumn}"::numeric, ${field.scale}\\)`));
  }
  assert.ok(migration.includes(`CREATE TRIGGER "${table.postgresTrigger}"`));
  assert.ok(repairSource.includes('ensureTriggerDefinition'));
}

assert.match(repairSource, /decimalShadowContract\.tables/);
assert.match(repairSource, /printf\('\$\{format\}'/);
assert.match(repairSource, /verifyDecimalShadowState/);
assert.match(repairSource, /Decimal shadow repair verification failed/);
assert.match(repairOrchestrator, /repairDecimalShadowSchema\(report\)/);
assert.match(migration, /ALTER COLUMN "final_amount_decimal" SET NOT NULL/);
assert.match(migration, /BEFORE INSERT OR UPDATE OF/);
assert.doesNotMatch(migration, /^\s*(DROP|TRUNCATE|DELETE)\b/im);
assert.match(reconcileAudit, /nullShadowRows/);
assert.match(reconcileAudit, /decimal-shadow-v1\.json/);
assert.match(reconcileAudit, /DECIMAL_SHADOW_AUDIT_LABEL/);
assert.match(reconcileAudit, /mismatchRows/);
assert.match(reconcileAudit, /legacyRoundedSum/);
assert.match(reconcileAudit, /shadowSum/);
assert.match(writePathAudit, /mode: 'forced-rollback'/);
assert.match(writePathAudit, /shadowColumnsOmittedFromInsert/);
assert.match(writePathAudit, /corruptedShadowThenLegacyWrite/);
assert.match(writePathAudit, /DECIMAL_SHADOW_AUDIT_ROLLBACK/);
assert.match(releaseGate, /decimal-shadow-contract/);
assert.match(releaseGate, /decimal-shadow-reconcile/);
assert.match(releaseGate, /decimal-shadow-write-path/);
assert.equal((releaseGate.match(/decimal-shadow-reconcile-audit-v1\.cjs/g) || []).length, 2);
assert.match(enterpriseVerdict, /decimal-shadow-reconcile-v1-sqlite-source\.json/);
assert.match(enterpriseVerdict, /decimal-shadow-reconcile-v1-postgres-import\.json/);
assert.match(enterpriseVerdict, /decimal-shadow-reconcile-v1-sqlite-rollback\.json/);
assert.match(enterpriseVerdict, /decimal-shadow-contract-version/);
assert.match(
  enterpriseReleaseWorkflow,
  /DATABASE_URL="\$sqlite_url" AUDIT_DATABASE_URL="\$sqlite_url" AUDIT_PRISMA_PROVIDER=sqlite DECIMAL_SHADOW_AUDIT_LABEL=sqlite-source/,
);
assert.match(
  enterpriseReleaseWorkflow,
  /DATABASE_URL="\$ENTERPRISE_SQLITE_URL" AUDIT_DATABASE_URL="\$ENTERPRISE_SQLITE_URL" AUDIT_PRISMA_PROVIDER=sqlite DECIMAL_SHADOW_AUDIT_LABEL=sqlite-rollback/,
);
assert.match(
  enterpriseCloudWorkflow,
  /DATABASE_URL="\$\{sqlite_url\}" AUDIT_DATABASE_URL="\$\{sqlite_url\}" AUDIT_PRISMA_PROVIDER=sqlite DECIMAL_SHADOW_AUDIT_LABEL=cloud-sqlite-rollback/,
);
assert.match(orderItemNormalization, /multiplyMoney\(quantity, unitPrice\)/);
assert.match(orderItemNormalization, /totalAmount = addMoney\(totalAmount, totalPrice\)/);
assert.match(orderImportService, /multiplyMoney\(quantity, unitPrice\)/);
assert.match(orderImportService, /totalAmount = addMoney\(totalAmount, totalPrice\)/);
assert.match(orderUpdateService, /calculateOrderFinalAmount/);
assert.match(orderUpdateService, /calculateOrderOutstanding/);
assert.match(orderController, /calculateOrderFinalAmount/);
assert.doesNotMatch(orderItemNormalization, /quantity\s*\*\s*unitPrice|totalAmount\s*\+=/);
assert.doesNotMatch(orderImportService, /quantity\s*\*\s*unitPrice|totalAmount\s*\+=/);
assert.match(moneyBoundary, /prorateMoney/);
assert.match(moneyBoundary, /calculateRatio/);
assert.match(financeSummaryService, /multiplyMoney\(amount, exchangeRate\)/);
assert.match(financeSummaryService, /prorateMoney\(totalBaseAmount, portionAmount, totalAmount\)/);
assert.match(financeSummaryService, /calculateRatio\(totalReceived, totalRevenue\)/);
assert.doesNotMatch(financeSummaryService, /amount\s*\*\s*exchangeRate|totalBaseAmount\s*\*\s*\(portionAmount\s*\/\s*totalAmount\)/);
assert.match(collectionQueryService, /calculateMilestoneAmounts/);
assert.match(collectionHelpers, /prorateMoney\(input\.contractTotalAmount, input\.percentage, 100\)/);
assert.doesNotMatch(collectionQueryService, /Number\(milestone\.contract\.totalAmount\)\s*\*\s*Number\(milestone\.percentage\)/);
assert.match(collectionStateService, /calculateVerifiedPaymentState/);
assert.match(collectionStateService, /addMoney\(\.\.\.input\.verifiedPayments\.map/);
assert.match(collectionStateService, /compareMoney\(paidAmount, effectiveReceivableAmount\)/);
assert.match(collectionStateService, /calculateMilestoneAmounts/);
assert.doesNotMatch(collectionStateService, /toCents|payments\.reduce\(\(sum, payment\) => sum \+|allVerifiedPayments\.reduce\(\(sum, record\) => sum \+/);
assert.doesNotMatch(collectionStateService, /Number\(milestone\.contract\.totalAmount\)\s*\*\s*Number\(milestone\.percentage\)/);
assert.match(barterCalculations, /calculatePostedBarterTotals/);
assert.match(barterCalculations, /calculateBarterAgreementProgress/);
assert.match(barterCalculations, /settlement\.status !== 'posted'/);
assert.match(barterAgreementService, /calculateBarterAgreementProgress/);
assert.match(barterQueryService, /calculatePostedBarterTotals/);
assert.match(barterService, /compareMoney\(offsetAmount, liveRemainingAmount\)/);
assert.match(barterService, /getOutstandingAmount\(\s*linkedOrder\.finalAmount/);
assert.doesNotMatch(barterAgreementService, /postingTotal \+ Number\(posting\.offsetAmount\)|agreedOffsetAmount - executedOffsetAmount/);
assert.doesNotMatch(barterQueryService, /postingTotal \+ Number\(posting\.offsetAmount\)|sum \+ Number\(settlement\.cashDifference\)/);
assert.doesNotMatch(barterService, /postingTotal \+ Number\(posting\.offsetAmount\)|offsetAmount > liveRemainingAmount/);
assert.match(procurementDomainService, /multiplyMoney\(price, quantity\)/);
assert.match(procurementDomainService, /prorateMoney\(landedCostAmount, 1, quantity\)/);
assert.match(procurementDomainService, /subtractMoney\(landedCostAmount, multiplyMoney\(unitCost, acceptedQuantityBefore\)\)/);
assert.doesNotMatch(procurementDomainService, /price\s*\*\s*quantity|landedCostAmount\s*\/\s*quantity/);
assert.match(stockMovementService, /multiplyMoney\(line\.quantityDelta, line\.unitCost\)/);
assert.doesNotMatch(stockMovementService, /line\.quantityDelta\s*\*\s*line\.unitCost/);
assert.match(productionCostLedgerService, /calculateInventoryCostDelta/);
assert.match(productionCostLedgerService, /calculateInventoryUnitCost/);
assert.match(productionCostLedgerService, /addMoney\(costBefore, costAmountDelta\)/);
assert.doesNotMatch(
  productionCostLedgerService,
  /quantityDelta\s*\*\s*currentUnitCost|costBefore\s*\+\s*costAmountDelta|costAmountDelta\s*\/\s*quantityDelta/,
);

console.log('Decimal Shadow Contract Audit: PASS');
console.log('- 7 money and 2 exchange-rate shadow fields have additive SQLite/PostgreSQL migration contracts.');
console.log('- Backfill, write synchronization, precision metadata, provider-isolated reconciliation, and non-cutover claims are gated.');
console.log('- Sales order create, import, and edit paths share decimal line, discount, and outstanding calculations.');
console.log('- Finance summaries and collection milestones use decimal exchange, proration, aggregation, and ratio boundaries.');
console.log('- Payment verification, order-state recalculation, overdue aggregation, and milestone settlement share the decimal boundary.');
console.log('- Barter preview, posted-only summaries, agreement progress, order offsets, and reversal-aware totals share the decimal boundary.');
console.log('- Procurement valuation, split-receipt residuals, stock movements, and inventory cost ledgers share the decimal boundary.');
