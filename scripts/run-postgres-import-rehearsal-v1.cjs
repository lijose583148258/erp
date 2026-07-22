const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'postgres-import-rehearsal-run-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'postgres-import-rehearsal-run-v1.md');
const TIMEOUT_MS = Number(process.env.POSTGRES_IMPORT_REHEARSAL_TIMEOUT_MS || 20 * 60 * 1000);
const REQUIRED_POSTGRES_URL_MESSAGE = 'POSTGRES_URL is required for PostgreSQL import rehearsal.';
const PRISMA_DB_PUSH_ARGS = [
  'db',
  'push',
  '--schema',
  'output/postgres-prisma-artifact/prisma',
  '--skip-generate',
];

const report = {
  name: 'PostgreSQL Import Rehearsal Run',
  version: 1,
  status: 'running',
  startedAt: new Date().toISOString(),
  steps: [],
  reports: {
    json: JSON_REPORT,
    markdown: MD_REPORT,
  },
};

function writeReport() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const md = [
    '# PostgreSQL Import Rehearsal Run v1',
    '',
    `- status: ${report.status}`,
    `- started: ${report.startedAt}`,
    `- finished: ${report.finishedAt || 'running'}`,
    '',
    '## Steps',
    ...report.steps.map((step) => `- ${step.status} ${step.name}${step.command ? `: ${step.command}` : ''}`),
  ];
  fs.writeFileSync(MD_REPORT, `${md.join('\n')}\n`, 'utf8');
}

function step(name, status, details = {}) {
  report.steps.push({
    name,
    status,
    at: new Date().toISOString(),
    ...details,
  });
  writeReport();
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    if (name === 'POSTGRES_URL') {
      throw new Error(REQUIRED_POSTGRES_URL_MESSAGE);
    }
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}

function run(command, args, name, extraEnv = {}) {
  const rendered = [command, ...args].join(' ');
  const output = execFileSync(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: TIMEOUT_MS,
  });
  step(name, 'passed', {
    command: rendered,
    output: output.trim().slice(0, 4000),
  });
  return output;
}

function main() {
  writeReport();
  try {
    const postgresUrl = requireEnv('POSTGRES_URL');
    step('validate-environment', 'passed', {
      requiredEnv: ['POSTGRES_URL'],
      importMode: process.env.POSTGRES_IMPORT_MODE || 'empty-only',
    });

    run(process.execPath,
      [path.join(ROOT, 'node_modules', 'prisma', 'build', 'index.js'), ...PRISMA_DB_PUSH_ARGS],
      'push-postgres-schema',
      { DATABASE_URL: postgresUrl });

    run(process.platform === 'win32' ? 'cmd.exe' : 'npm',
      process.platform === 'win32'
        ? ['/d', '/s', '/c', 'npm run db:pg -- import']
        : ['run', 'db:pg', '--', 'import'],
      'import-postgres-snapshot');

    run(process.platform === 'win32' ? 'cmd.exe' : 'npm',
      process.platform === 'win32'
        ? ['/d', '/s', '/c', 'npm run audit:db:postgres-import-rehearsal']
        : ['run', 'audit:db:postgres-import-rehearsal'],
      'audit-postgres-import-rehearsal');

    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error.message || error);
    step('postgres-import-rehearsal-failed', 'failed', { reason: report.error });
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    writeReport();
  }

  if (report.status === 'passed') {
    console.log(`PostgreSQL import rehearsal run passed. Report: ${JSON_REPORT}`);
  } else {
    console.error(`PostgreSQL import rehearsal run failed. Report: ${JSON_REPORT}`);
  }
}

main();
