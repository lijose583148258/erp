const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'security-production-readiness-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'security-production-readiness-v1.md');

const STEPS = [
  { id: 'csp', args: ['run', 'audit:security:csp'] },
  { id: 'csrf-boundary', args: ['run', 'audit:security:csrf-boundary'] },
  { id: 'mfa', args: ['run', 'audit:security:mfa'] },
  { id: 'secrets', args: ['run', 'audit:security:secrets'] },
  { id: 'distributed-auth', args: ['run', 'audit:security:distributed-auth'] },
  { id: 'dependencies', args: ['run', 'audit:security:dependencies'] },
];

function runStep(step) {
  const startedAt = new Date().toISOString();
  const commandText = ['npm', ...step.args].join(' ');
  const spawnArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', commandText]
    : step.args;
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
  const result = spawnSync(command, spawnArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
  });

  const stdout = (result.stdout || '').trim();
  const stderr = (result.stderr || '').trim();
  const exitCode = typeof result.status === 'number' ? result.status : 1;

  return {
    id: step.id,
    command: commandText,
    startedAt,
    finishedAt: new Date().toISOString(),
    status: exitCode === 0 ? 'passed' : 'failed',
    exitCode,
    stdout,
    stderr,
  };
}

function writeReport(report) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const lines = [
    '# Security Production Readiness Audit v1',
    '',
    `- status: ${report.status}`,
    `- generated: ${report.generatedAt}`,
    `- steps: ${report.steps.length}`,
    '',
    '## Steps',
  ];

  for (const step of report.steps) {
    lines.push(`- ${step.status.toUpperCase()} ${step.id}: \`${step.command}\``);
    if (step.stdout) lines.push('  - stdout captured');
    if (step.stderr) lines.push('  - stderr captured');
  }

  fs.writeFileSync(MD_REPORT, `${lines.join('\n')}\n`, 'utf8');
}

function main() {
  const steps = [];

  for (const step of STEPS) {
    const outcome = runStep(step);
    steps.push(outcome);

    if (outcome.stdout) process.stdout.write(`${outcome.stdout}\n`);
    if (outcome.stderr) process.stderr.write(`${outcome.stderr}\n`);

    if (outcome.exitCode !== 0) break;
  }

  const failedStep = steps.find((step) => step.status === 'failed');
  const report = {
    generatedAt: new Date().toISOString(),
    status: failedStep ? 'failed' : 'passed',
    scope: 'security-production-readiness',
    steps,
    failedStep: failedStep ? failedStep.id : null,
    jsonReport: JSON_REPORT,
    markdownReport: MD_REPORT,
  };

  writeReport(report);

  console.log(
    JSON.stringify(
      {
        status: report.status,
        steps: report.steps.length,
        failedStep: report.failedStep,
        jsonReport: JSON_REPORT,
        markdownReport: MD_REPORT,
      },
      null,
      2,
    ),
  );

  if (failedStep) process.exitCode = 1;
}

main();
