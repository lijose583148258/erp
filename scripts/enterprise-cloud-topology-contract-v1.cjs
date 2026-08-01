const assert = require('node:assert/strict');
const fs = require('node:fs');

const workflow = fs.readFileSync('.github/workflows/enterprise-cloud-sandbox.yml', 'utf8');
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

console.log('Enterprise Cloud Topology Contract: PASS');
console.log('- PostgreSQL host binding is collision-resistant and shared consistently by Compose and audit URLs.');
