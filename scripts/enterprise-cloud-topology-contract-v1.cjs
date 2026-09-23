const assert = require('node:assert/strict');
const fs = require('node:fs');

const workflow = fs.readFileSync('.github/workflows/enterprise-cloud-sandbox.yml', 'utf8');
const releaseWorkflow = fs.readFileSync('.github/workflows/enterprise-release-certification.yml', 'utf8');
const compose = fs.readFileSync('ops/cloud-sandbox/docker-compose.yml', 'utf8');

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

console.log('Enterprise Cloud Topology Contract: PASS');
console.log('- PostgreSQL host binding is collision-resistant and shared consistently by Compose and audit URLs.');
console.log('- MinIO server and client images are pinned to quay.io so cloud runners can pull the enterprise object-storage topology.');
