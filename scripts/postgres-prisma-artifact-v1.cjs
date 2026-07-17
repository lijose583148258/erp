const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SOURCE_SCHEMA_DIR = path.join(ROOT, 'backend', 'prisma');
const SOURCE_SCHEMA_PATH = path.join(SOURCE_SCHEMA_DIR, 'schema.prisma');
const ARTIFACT_ROOT = path.join(ROOT, 'output', 'postgres-prisma-artifact');
const ARTIFACT_SCHEMA_DIR = path.join(ARTIFACT_ROOT, 'prisma');
const ARTIFACT_SCHEMA_PATH = path.join(ARTIFACT_SCHEMA_DIR, 'schema.prisma');
const GENERATED_CLIENT_DIR = path.join(ARTIFACT_ROOT, 'generated-client');
const REPORT_PATH = path.join(ROOT, 'output', 'audit', 'postgres-prisma-artifact-v1.json');
const PRISMA_CLI_PATH = path.join(ROOT, 'node_modules', 'prisma', 'build', 'index.js');
const TIMEOUT_MS = Number(process.env.POSTGRES_ARTIFACT_TIMEOUT_MS || 120000);

const report = {
  name: 'PostgreSQL Prisma Artifact Probe',
  version: '1.0',
  status: 'running',
  startedAt: new Date().toISOString(),
  artifactRoot: path.relative(ROOT, ARTIFACT_ROOT).replace(/\\/g, '/'),
  generatedClientDir: path.relative(ROOT, GENERATED_CLIENT_DIR).replace(/\\/g, '/'),
  steps: [],
};

function writeReport() {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function step(name, status, details = {}) {
  report.steps.push({ name, status, at: new Date().toISOString(), ...details });
  writeReport();
  console.log(`[${status}] ${name}`);
}

function copyPrismaSchemaFolder() {
  fs.rmSync(ARTIFACT_ROOT, { recursive: true, force: true });

  const copyPrismaFiles = (sourceDir) => {
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
      const sourcePath = path.join(sourceDir, entry.name);
      const relative = path.relative(SOURCE_SCHEMA_DIR, sourcePath).replace(/\\/g, '/');
      if (relative.startsWith('migrations/')) continue;
      if (entry.isDirectory()) {
        copyPrismaFiles(sourcePath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.prisma')) continue;
      const targetPath = path.join(ARTIFACT_SCHEMA_DIR, relative);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(sourcePath, targetPath);
    }
  };

  copyPrismaFiles(SOURCE_SCHEMA_DIR);
}

function rewriteEntrypointForPostgresArtifact() {
  const original = fs.readFileSync(ARTIFACT_SCHEMA_PATH, 'utf8');
  let next = original.replace(/provider\s*=\s*"sqlite"/g, 'provider = "postgresql"');
  if (next === original) throw new Error('SQLite provider declaration was not found in copied schema.prisma');

  if (!/^\s*output\s*=/m.test(next)) {
    next = next.replace(
      /(generator\s+client\s+\{[\s\S]*?provider\s*=\s*"prisma-client-js"[^\n]*\n)/,
      `$1  output          = "../generated-client"\n`,
    );
  }

  fs.writeFileSync(ARTIFACT_SCHEMA_PATH, next, 'utf8');
}

function runPrisma(args, stepName) {
  const stdout = execFileSync(process.execPath, [PRISMA_CLI_PATH, ...args], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL: 'postgresql://probe_user:probe_password@127.0.0.1:5432/ailaoda_probe?schema=public',
    },
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: TIMEOUT_MS,
  });
  step(stepName, 'passed', { output: stdout.trim().slice(0, 2000) });
}

function main() {
  writeReport();
  try {
    if (!fs.existsSync(SOURCE_SCHEMA_PATH)) throw new Error(`Prisma schema not found: ${SOURCE_SCHEMA_PATH}`);
    if (!fs.existsSync(PRISMA_CLI_PATH)) throw new Error(`Local Prisma CLI not found: ${PRISMA_CLI_PATH}`);

    copyPrismaSchemaFolder();
    rewriteEntrypointForPostgresArtifact();
    step('write-postgres-artifact-schema', 'passed', {
      schemaPath: path.relative(ROOT, ARTIFACT_SCHEMA_PATH).replace(/\\/g, '/'),
      meaning: 'Copied full Prisma schema folder, switched datasource provider to PostgreSQL, and isolated generator output.',
    });

    runPrisma(['validate', `--schema=${ARTIFACT_SCHEMA_DIR}`], 'validate-postgres-artifact-schema');
    runPrisma(['generate', `--schema=${ARTIFACT_SCHEMA_DIR}`], 'generate-postgres-prisma-client');

    if (!fs.existsSync(path.join(GENERATED_CLIENT_DIR, 'index.js'))) {
      throw new Error('Generated PostgreSQL Prisma client index.js was not found');
    }

    step('verify-generated-client', 'passed', {
      index: path.relative(ROOT, path.join(GENERATED_CLIENT_DIR, 'index.js')).replace(/\\/g, '/'),
    });
    report.status = 'passed';
  } catch (error) {
    const stdout = typeof error.stdout === 'string' ? error.stdout : '';
    const stderr = typeof error.stderr === 'string' ? error.stderr : '';
    report.status = 'failed';
    report.error = String(error.message || error);
    report.output = `${stdout}\n${stderr}`.trim().slice(0, 4000);
    step('postgres-artifact-failed', 'failed', { reason: report.error, output: report.output });
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    writeReport();
  }

  if (report.status === 'passed') {
    console.log(`PostgreSQL Prisma artifact probe passed. Report: ${REPORT_PATH}`);
  } else {
    console.error(`PostgreSQL Prisma artifact probe failed. Report: ${REPORT_PATH}`);
  }
}

main();
