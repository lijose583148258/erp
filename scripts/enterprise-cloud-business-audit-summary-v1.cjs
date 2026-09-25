const fs = require('node:fs');
const path = require('node:path');

const expectedAudits = [
  ['browser_fonts', 'Chinese font coverage for browser evidence'],
  ['search_readiness', 'Meilisearch initialization, rebuild and readiness'],
  ['human_workflows', 'Human ERP workflows'],
  ['staff_20', '20 distinct chemical trading and factory staff'],
  ['shared_session', 'Shared session across app instances'],
  ['telemetry_ingestion', 'Telemetry ingestion'],
  ['ai_isolation', 'AI isolation red team'],
  ['ai_runtime', 'Governed AI runtime'],
  ['order_import_governance', 'Order import scope and credit governance'],
  ['order_import_retention', 'Order import retention lifecycle'],
  ['order_write_scope', 'Core order and finance collection write boundaries'],
  ['ha_load', 'Dual-instance load gate'],
  ['warehouse_adjustment', 'Warehouse adjustment idempotency and optimistic concurrency'],
  ['ha_soak', 'Short HA soak gate'],
  ['redis_failover', 'Redis Sentinel controlled failover'],
  ['degradable_failover', 'Search and object storage failover'],
  ['concurrent_writes', 'Concurrent business write reconciliation'],
  ['postgres_backup_restore', 'PostgreSQL logical backup restore'],
  ['postgres_promotion', 'PostgreSQL streaming promotion'],
  ['postgres_cutover_verdict', 'PostgreSQL cutover same-window verdict'],
  ['enterprise_pilot_verdict', 'Enterprise pilot technical verdict'],
];
// An unfinished 12-chain run cannot masquerade as baseline success.
if (process.env.ROUND2_REQUESTED === 'true') {
  expectedAudits.push(['round2_business', 'Round 2 complete business-chain evidence']);
}

const outputPath = path.resolve(
  process.env.ENTERPRISE_CLOUD_BUSINESS_AUDIT_REPORT_PATH
    || 'cloud-evidence/business-audit-summary.json',
);

let steps = {};
try {
  steps = JSON.parse(String(process.env.BUSINESS_AUDIT_STEPS_JSON || '{}'));
} catch (error) {
  console.error(`Enterprise cloud business audit summary could not parse step outcomes: ${error.message}`);
}

const audits = expectedAudits.map(([id, name]) => {
  const step = steps[id] || {};
  const outcome = String(step.outcome || 'missing');
  const conclusion = String(step.conclusion || 'missing');
  return {
    id,
    name,
    status: outcome === 'success' ? 'passed' : 'failed',
    outcome,
    conclusion,
  };
});
const failedAudits = audits.filter((audit) => audit.status === 'failed');
const report = {
  name: 'Enterprise Cloud Business Audit Aggregate',
  version: '1.0',
  status: failedAudits.length === 0 ? 'passed' : 'failed',
  commit: process.env.GITHUB_SHA || null,
  runId: process.env.GITHUB_RUN_ID || null,
  runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
  checkedAt: new Date().toISOString(),
  summary: {
    expected: audits.length,
    passed: audits.length - failedAudits.length,
    failed: failedAudits.length,
  },
  audits,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(`Enterprise Cloud Business Audit Aggregate: ${report.status.toUpperCase()}`);
console.log(`Passed: ${report.summary.passed}/${report.summary.expected}`);
console.log(`Report: ${outputPath}`);
for (const audit of failedAudits) {
  console.error(`- ${audit.id}: outcome=${audit.outcome}, conclusion=${audit.conclusion}`);
}

if (failedAudits.length > 0) process.exit(1);
