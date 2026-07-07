const { spawnSync } = require('child_process');
const path = require('path');

const backendRoot = process.cwd();
const artifactDir = path.resolve(
  backendRoot,
  process.env.POSTGRES_PRISMA_ARTIFACT_DIR || '.generated/prisma-postgresql',
);
const prismaCli = path.join(backendRoot, 'node_modules', 'prisma', 'build', 'index.js');

const prepare = spawnSync(process.execPath, [path.join('scripts', 'prepare-postgres-prisma-artifact.cjs')], {
  cwd: backendRoot,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
});

if (prepare.status !== 0) {
  process.exit(prepare.status ?? 1);
}

const env = {
  ...process.env,
  DATABASE_URL: process.env.POSTGRES_PRISMA_VALIDATE_URL ||
    'postgresql://ailaoda:ailaoda@127.0.0.1:5432/ailaoda?schema=public',
};

const result = spawnSync(process.execPath, [prismaCli, 'validate', `--schema=${artifactDir}`], {
  cwd: backendRoot,
  env,
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
