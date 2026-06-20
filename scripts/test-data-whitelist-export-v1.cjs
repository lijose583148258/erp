const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const INVENTORY_JSON = path.join(OUTPUT_DIR, 'test-data-retention-inventory-audit-v1.json');
const DEPENDENCY_JSON = path.join(OUTPUT_DIR, 'test-data-retention-dependency-graph-audit-v1.json');
const JSON_REPORT = path.join(OUTPUT_DIR, 'test-data-whitelist-export-v1.json');
const CSV_REPORT = path.join(OUTPUT_DIR, 'test-data-whitelist-export-v1.csv');
const MD_REPORT = path.join(OUTPUT_DIR, 'test-data-whitelist-export-v1.md');

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required report is missing: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function safeSampleId(sample) {
  if (!sample || typeof sample !== 'object') return '';
  return sample.id ?? sample.orderNo ?? sample.batchNo ?? sample.sourceRef ?? sample.name ?? '';
}

function main() {
  const inventory = readJson(INVENTORY_JSON);
  const dependency = readJson(DEPENDENCY_JSON);
  const planByTable = new Map((dependency.tablePlans || []).map((plan) => [plan.table, plan]));
  const generatedAt = new Date().toISOString();

  if (dependency.cleanupApproved !== false) {
    throw new Error('Whitelist export expects cleanupApproved=false. Refusing to export from an unsafe dependency report.');
  }

  const whitelistRows = [];
  for (const hit of inventory.hits || []) {
    const plan = planByTable.get(hit.table) || {};
    for (const sample of hit.samples || []) {
      whitelistRows.push({
        table: hit.table,
        column: hit.column,
        markerId: hit.markerId,
        classification: hit.classification,
        cleanupRisk: hit.cleanupRisk,
        dependencyAction: plan.action || 'unknown',
        sampleId: safeSampleId(sample),
        sample,
      });
    }
  }

  const report = {
    name: 'test-data-whitelist-export-v1',
    generatedAt,
    status: 'passed',
    mode: 'report-only',
    cleanupApproved: false,
    sqlitePath: inventory.sqlitePath || dependency.sqlitePath || null,
    summary: {
      sourceColumnHitGroups: (inventory.hits || []).length,
      exportedSampleRows: whitelistRows.length,
      destructiveActionsPerformed: 0,
      retainOnlyRows: whitelistRows.filter((row) => row.dependencyAction === 'retain-only').length,
      manualWhitelistPlusReconcileRows: whitelistRows.filter((row) => row.dependencyAction === 'manual-whitelist-plus-reconcile').length,
      manualWhitelistRequiredRows: whitelistRows.filter((row) => row.dependencyAction === 'manual-whitelist-required').length,
    },
    requiredBeforeCleanup: dependency.cleanupRules?.requiredBeforeCleanup || [],
    forbidden: dependency.cleanupRules?.forbidden || [],
    whitelistRows,
    outputs: {
      json: JSON_REPORT,
      csv: CSV_REPORT,
      markdown: MD_REPORT,
    },
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const csvLines = [
    ['table', 'column', 'markerId', 'classification', 'cleanupRisk', 'dependencyAction', 'sampleId', 'sampleJson'].map(csvCell).join(','),
    ...whitelistRows.map((row) => [
      row.table,
      row.column,
      row.markerId,
      row.classification,
      row.cleanupRisk,
      row.dependencyAction,
      row.sampleId,
      JSON.stringify(row.sample),
    ].map(csvCell).join(',')),
  ];
  fs.writeFileSync(CSV_REPORT, `${csvLines.join('\n')}\n`, 'utf8');

  const md = [
    '# Test Data Whitelist Export v1',
    '',
    `- status: ${report.status}`,
    `- mode: ${report.mode}`,
    `- sqlite path: ${report.sqlitePath || 'unknown'}`,
    `- exported sample rows: ${report.summary.exportedSampleRows}`,
    `- destructive actions performed: ${report.summary.destructiveActionsPerformed}`,
    '',
    '## Safety Decision',
    '',
    '- Cleanup is not approved by this script.',
    '- This file is a candidate evidence export only.',
    '- Any cleanup still requires backup, manual whitelist approval, fingerprint before/after, DB integrity audit, and targeted Phase 3 rerun.',
    '',
    '## Row Counts By Action',
    '',
    `- retain-only: ${report.summary.retainOnlyRows}`,
    `- manual-whitelist-plus-reconcile: ${report.summary.manualWhitelistPlusReconcileRows}`,
    `- manual-whitelist-required: ${report.summary.manualWhitelistRequiredRows}`,
  ];
  fs.writeFileSync(MD_REPORT, `${md.join('\n')}\n`, 'utf8');

  console.log(JSON.stringify({
    status: report.status,
    mode: report.mode,
    cleanupApproved: report.cleanupApproved,
    summary: report.summary,
    outputs: report.outputs,
  }, null, 2));
}

main();
