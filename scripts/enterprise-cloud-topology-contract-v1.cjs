const assert = require('node:assert/strict');
const fs = require('node:fs');

const workflow = fs.readFileSync('.github/workflows/enterprise-cloud-sandbox.yml', 'utf8');
const releaseWorkflow = fs.readFileSync('.github/workflows/enterprise-release-certification.yml', 'utf8');
const compose = fs.readFileSync('ops/cloud-sandbox/docker-compose.yml', 'utf8');
const aggregateScript = fs.readFileSync('scripts/enterprise-cloud-business-audit-summary-v1.cjs', 'utf8');
const staffAudit = fs.readFileSync('scripts/enterprise-20-staff-audit-v1.cjs', 'utf8');
const minioSource = fs.readFileSync('ops/cloud-sandbox/minio-source/Dockerfile', 'utf8');

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
  /image:\s+&minio-source-image ailaoda\/minio-sandbox:source-2025-04-v1/,
  'Cloud MinIO must be built locally from pinned official source, not withdrawn binary images.',
);
assert.match(
  compose,
  /minio-init:[\s\S]{0,120}image: \*minio-source-image[\s\S]{0,120}build: \*minio-source-build/,
  'MinIO initialization must use the same verified source-built fixture containing mc.',
);
assert.doesNotMatch(
  compose,
  /image:\s+(?:quay\.io\/)?minio\/(?:minio|mc):/,
  'Cloud sandbox must not fall back to unavailable MinIO binary registries.',
);
assert.equal((compose.match(/pull_policy: never/g) || []).length, 3, 'All three MinIO services must use the locally built image');
for (const sha of ['0d7408fc9969caf07de6a8c3a84f9fbb10a6739e', 'b00526b153a31b36767991a4f5ce2cced435ee8e']) {
  assert(minioSource.includes(`git fetch --depth=1 origin ${sha}`));
  assert(minioSource.includes(`test "$(git rev-parse HEAD)" = ${sha}`));
}
assert.match(minioSource, /https:\/\/github\.com\/minio\/minio\.git/);
assert.match(minioSource, /https:\/\/github\.com\/minio\/mc\.git/);
assert.equal((minioSource.match(/^FROM .+@sha256:[a-f0-9]{64}/gm) || []).length, 2, 'Both base images must use verified immutable digests');
assert.equal((minioSource.match(/go mod verify/g) || []).length, 2, 'Both Go dependency graphs must be verified');
assert.doesNotMatch(minioSource, /GOSUMDB=off|GOINSECURE|curl\s+.*--insecure|git config.*sslVerify.*false/);
assert.equal((workflow.match(/docker compose build minio-primary/g) || []).length, 2, 'Both cloud jobs must build MinIO before starting dependencies');
assert.match(releaseWorkflow, /docker compose build minio-primary[\s\S]{0,100}docker compose up/);
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
console.log('- MinIO server and client are built from verified upstream commits and pinned base images, with no binary registry fallback.');
console.log('- Business audits continue after individual failures and emit one aggregate verdict at the end.');
