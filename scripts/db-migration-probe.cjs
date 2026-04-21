const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPORT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(REPORT_DIR, 'db-migration-probe-report.json');
const SCHEMA_DIR = path.join(process.cwd(), 'backend', 'prisma');
const SCHEMA_PATH = path.join(SCHEMA_DIR, 'schema.prisma');
const TEMP_SCHEMA_DIR = path.join(process.cwd(), 'output', 'prisma-postgres-probe', 'prisma');
const TEMP_SCHEMA_PATH = path.join(TEMP_SCHEMA_DIR, 'schema.prisma');
const PRISMA_CLI_PATH = path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
const TIMEOUT_MS = Number(process.env.MIGRATION_PROBE_TIMEOUT_MS || 60000);

const report = {
  name: 'Offline Database Migration Probe',
  version: '2.0',
  engine: 'postgresql',
  startedAt: new Date().toISOString(),
  timeoutMs: TIMEOUT_MS,
  status: 'running',
  steps: [],
};

function writeReport() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function recordStep(name, status, details = {}) {
  const step = { name, status, at: new Date().toISOString(), ...details };
  report.steps.push(step);
  writeReport();
  console.log(`[${status}] ${name}`);
}

function copySchemaDirectoryForProbe() {
  fs.rmSync(path.dirname(TEMP_SCHEMA_DIR), { recursive: true, force: true });

  const copyPrismaFiles = (sourceDir) => {
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
      const sourcePath = path.join(sourceDir, entry.name);
      const relative = path.relative(SCHEMA_DIR, sourcePath).replace(/\\/g, '/');
      if (relative.startsWith('migrations/')) continue;
      if (entry.isDirectory()) {
        copyPrismaFiles(sourcePath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.prisma')) continue;

      const targetPath = path.join(TEMP_SCHEMA_DIR, relative);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(sourcePath, targetPath);
    }
  };

  copyPrismaFiles(SCHEMA_DIR);
}

function runProbe() {
  writeReport();

  try {
    if (!fs.existsSync(SCHEMA_PATH)) {
      throw new Error(`Prisma schema not found: ${SCHEMA_PATH}`);
    }

    if (!fs.existsSync(PRISMA_CLI_PATH)) {
      throw new Error(`Local Prisma CLI not found: ${PRISMA_CLI_PATH}`);
    }

    copySchemaDirectoryForProbe();

    const originalSchema = fs.readFileSync(TEMP_SCHEMA_PATH, 'utf8');
    const postgresSchema = originalSchema.replace(/provider\s*=\s*"sqlite"/g, 'provider = "postgresql"');

    if (postgresSchema === originalSchema) {
      throw new Error('SQLite provider declaration was not found in schema.prisma');
    }

    fs.writeFileSync(TEMP_SCHEMA_PATH, postgresSchema, 'utf8');
    recordStep('write-temp-postgres-schema', 'passed', {
      tempSchema: path.relative(process.cwd(), TEMP_SCHEMA_DIR),
      note: 'Temporary probe schema directory only; original schema.prisma is unchanged.',
    });

    execFileSync(process.execPath, [PRISMA_CLI_PATH, 'validate', `--schema=${TEMP_SCHEMA_DIR}`], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: 'postgresql://probe_user:probe_password@127.0.0.1:5432/ailaoda_probe?schema=public',
      },
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: TIMEOUT_MS,
    });

    recordStep('prisma-validate-postgres-schema', 'passed', {
      meaning: 'Schema is syntactically valid for PostgreSQL provider. This does not prove data migration or server connectivity.',
    });
    report.status = 'passed';
  } catch (error) {
    const stdout = typeof error.stdout === 'string' ? error.stdout : '';
    const stderr = typeof error.stderr === 'string' ? error.stderr : '';
    report.status = 'failed';
    report.error = String(error.message || error);
    report.output = `${stdout}\n${stderr}`.trim().slice(0, 4000);
    recordStep('migration-probe-failed', 'failed', {
      reason: report.error,
      output: report.output,
    });
    process.exitCode = 1;
  } finally {
    fs.rmSync(TEMP_SCHEMA_DIR, { recursive: true, force: true });
    report.finishedAt = new Date().toISOString();
    writeReport();
  }

  if (report.status === 'passed') {
    console.log(`DB migration probe passed. Report: ${REPORT_PATH}`);
  } else {
    console.error(`DB migration probe failed. Report: ${REPORT_PATH}`);
  }
}

runProbe();
