const assert = require('node:assert/strict');
const fs = require('node:fs');

const workflow = fs.readFileSync('.github/workflows/enterprise-cloud-sandbox.yml', 'utf8');
const releaseWorkflow = fs.readFileSync('.github/workflows/enterprise-release-certification.yml', 'utf8');
const compose = fs.readFileSync('ops/cloud-sandbox/docker-compose.yml', 'utf8');
const aggregateScript = fs.readFileSync('scripts/enterprise-cloud-business-audit-summary-v1.cjs', 'utf8');
const staffAudit = fs.readFileSync('scripts/enterprise-20-staff-audit-v1.cjs', 'utf8');

assert.match(
  compose,
  /\$\{POSTGRES_HOST_PORT:-55432\}:5432/,
  'Cloud sandbox PostgreSQL must support a caller-selected host port.',
);
assert.match(
  workflow,
  /sock\.bind\(\("127\.0\.0\.1", 0\)\)/,
  'Cloud workflow must reserve an available loopback port instead of assuming 55432 is free.',
);
assert.match(
  workflow,
  /printf 'POSTGRES_HOST_PORT=%s\\n' "\$\{postgres_host_port\}"/,
  'Selected PostgreSQL host port must be exported for Docker Compose.',
);
assert.match(
  workflow,
  /127\.0\.0\.1:%s\/ailaoda\?schema=public\\n' "\$\{postgres_password\}" "\$\{postgres_host_port\}"/,
  'Database URLs must use the same selected PostgreSQL host port.',
);
assert.doesNotMatch(
  workflow,
  /127\.0\.0\.1:55432\/ailaoda/,
  'Enterprise cloud workflow must not retain a fixed PostgreSQL host port.',
);
assert.match(
  compose,
  /image:\s+quay\.io\/minio\/minio:RELEASE\.2025-04-22T22-12-26Z/,
  'Cloud sandbox MinIO server image must use the pinned official Quay registry image; Docker Hub minio/minio is not reliable in GitHub runners.',
);
assert.match(
  compose,
  /image:\s+quay\.io\/minio\/mc:RELEASE\.2025-04-16T18-13-26Z/,
  'Cloud sandbox MinIO client image must use the pinned official Quay registry image; Docker Hub minio/mc is not reliable in GitHub runners.',
);
assert.doesNotMatch(
  compose,
  /image:\s+minio\/(?:minio|mc):/,
  'Cloud sandbox must not pull MinIO images from Docker Hub.',
);
assert.match(
  releaseWorkflow,
  /-\s+'ops\/cloud-sandbox\/\*\*'/,
  'Enterprise release certification must rerun when cloud sandbox topology changes.',
);
assert.match(
  releaseWorkflow,
  /mkdir -p output\/audit output\/playwright[\s\S]+docker compose pull --ignore-buildable/,
  'Enterprise release certification must create evidence directories before pulling the dependency topology.',
);
assert.match(
  releaseWorkflow,
  /Capture certification diagnostics[\s\S]+mkdir -p output\/audit output\/playwright/,
  'Enterprise release certification diagnostics must create evidence directories even when topology startup fails early.',
);

const businessAuditIds = [
  'search_readiness',
  'human_workflows',
  'staff_20',
  'shared_session',
  'telemetry_ingestion',
  'ai_isolation',
  'ai_runtime',
  'order_import_governance',
  'order_import_retention',
  'order_write_scope',
  'ha_load',
  'warehouse_adjustment',
  'ha_soak',
  'redis_failover',
  'degradable_failover',
  'concurrent_writes',
  'postgres_backup_restore',
  'postgres_promotion',
  'postgres_cutover_verdict',
  'enterprise_pilot_verdict',
];
for (const id of businessAuditIds) {
  assert.match(
    workflow,
    new RegExp(`id: ${id}\\n[\\s\\S]{0,180}if: \\\$\\{\\{ always\\(\\) && steps\\.app_readiness\\.outcome == 'success' \\}\\}[\\s\\S]{0,120}continue-on-error: true`),
    `${id} must execute after a ready application without fail-fast truncating later audits.`,
  );
  assert.match(aggregateScript, new RegExp(`\\['${id}',`), `${id} must be included in the aggregate verdict.`);
}
assert.match(
  workflow,
  /id: business_audit_verdict[\s\S]{0,160}if: always\(\)[\s\S]{0,160}BUSINESS_AUDIT_STEPS_JSON: \$\{\{ toJSON\(steps\) \}\}[\s\S]{0,120}enterprise-cloud-business-audit-summary-v1\.cjs/,
  'Cloud workflow must issue one final business-audit verdict after all audit steps have executed.',
);
assert.match(
  workflow,
  /Verify Meilisearch initialization, rebuild and readiness[\s\S]+internal\/ready[\s\S]+search\?\.ready === true[\s\S]+lastReindex\?\.readiness\?\.readyProviders/,
  'Cloud readiness must wait for both initialized Meilisearch replicas and the primary startup rebuild.',
);
assert.match(
  compose,
  /SEARCH_MIN_READY_SUCCESSES:\s+"2"[\s\S]+SEARCH_REINDEX_ON_STARTUP:\s+"true"[\s\S]+app-secondary:[\s\S]+SEARCH_REINDEX_ON_STARTUP:\s+"false"/,
  'One app must own startup reindex while both apps require both Meilisearch endpoints to become ready.',
);
assert.match(
  workflow,
  /run_audit unsaved-changes[\s\S]+run_audit decimal-shadow[\s\S]+Human ERP workflow failures/,
  'The grouped human-flow step must execute every nested audit before returning failure.',
);
assert.match(
  staffAudit,
  /materialId:\s*Number\(releasedProduct\.id\)[\s\S]{0,260}batchNo:\s*productionOutcome\.batchNo/,
  'The 20-staff logistics chain must bind the approved finished-good material before issuing its production batch.',
);

console.log('Enterprise Cloud Topology Contract: PASS');
console.log('- PostgreSQL host binding is collision-resistant and shared consistently by Compose and audit URLs.');
console.log('- MinIO server and client images are pinned to quay.io so cloud runners can pull the enterprise object-storage topology.');
console.log('- Business audits continue after individual failures and emit one aggregate verdict at the end.');
