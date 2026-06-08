/**
 * Casbin fallback policy audit.
 *
 * Proves production/stable authorization fails closed when dynamic RBAC tables
 * are unavailable, and that built-in ROLE_POLICIES fallback only works through
 * an explicit emergency flag.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const OUTPUT_DIR = path.join(process.cwd(), 'output', 'audit');
const REPORT_PATH = path.join(OUTPUT_DIR, 'casbin-fallback-policy-audit-v1.json');
const WORKER = path.join(process.cwd(), 'scripts', 'lib', 'casbin-fallback-probe-worker.ts');
const WORKER_REL = path.join('scripts', 'lib', 'casbin-fallback-probe-worker.ts');
const PROBE_DIR = path.join(OUTPUT_DIR, 'casbin-fallback-probe');

function normalizeDbUrl(filePath) {
  return `file:${filePath.replace(/\\/g, '/')}`;
}

function runProbe(mode, options = {}) {
  const dbPath = path.join(PROBE_DIR, `${mode}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  const isolatedRuntimeDir = path.join(PROBE_DIR, 'runtime', mode);
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    AILAODA_RUNTIME_DB_PATH: dbPath,
    DATABASE_URL: normalizeDbUrl(dbPath),
    LOG_DIR: path.join(isolatedRuntimeDir, 'logs'),
    BACKUP_DIR: path.join(isolatedRuntimeDir, 'backups'),
    UPLOAD_DIR: path.join(isolatedRuntimeDir, 'uploads'),
    AILAODA_CASBIN_FALLBACK_PROBE_MODE: mode,
    AILAODA_ALLOW_RBAC_FALLBACK: options.allowFallback ? '1' : '',
  };

  const command = process.platform === 'win32' ? 'cmd.exe' : 'npx';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', `npx tsx ${WORKER_REL}`]
    : ['tsx', WORKER];

  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    timeout: 60_000,
  });

  let parsed = null;
  try {
    const jsonStart = result.stdout.indexOf('{');
    const jsonEnd = result.stdout.lastIndexOf('}');
    parsed = jsonStart >= 0 && jsonEnd >= jsonStart
      ? JSON.parse(result.stdout.slice(jsonStart, jsonEnd + 1))
      : null;
  } catch {
    parsed = null;
  }

  return {
    mode,
    allowFallback: Boolean(options.allowFallback),
    dbPath,
    status: result.status,
    signal: result.signal,
    timedOut: Boolean(result.error && result.error.code === 'ETIMEDOUT'),
    durationMs: Date.now() - startedAt,
    stdout: result.stdout,
    stderr: result.stderr,
    parsed,
  };
}

function main() {
  fs.mkdirSync(PROBE_DIR, { recursive: true });

  const strictProbe = runProbe('strict', { allowFallback: false });
  const fallbackProbe = runProbe('fallback', { allowFallback: true });

  const findings = [];
  if (strictProbe.status !== 0) {
    findings.push({
      level: 'P0',
      area: 'strict',
      message: 'Strict production RBAC probe failed to prove fail-closed behavior.',
      probe: strictProbe,
    });
  }
  if (fallbackProbe.status !== 0) {
    findings.push({
      level: 'P0',
      area: 'fallback',
      message: 'Explicit RBAC fallback probe failed.',
      probe: fallbackProbe,
    });
  }

  const report = {
    status: findings.length === 0 ? 'passed' : 'failed',
    generatedAt: new Date().toISOString(),
    worker: WORKER,
    probes: [strictProbe, fallbackProbe].map((probe) => ({
      mode: probe.mode,
      allowFallback: probe.allowFallback,
      status: probe.status,
      signal: probe.signal,
      timedOut: probe.timedOut,
      durationMs: probe.durationMs,
      parsed: probe.parsed,
      stderrTail: (probe.stderr || '').slice(-1000),
    })),
    findings,
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({
    status: report.status,
    probes: report.probes,
    findings: findings.length,
    jsonReport: REPORT_PATH,
  }, null, 2));

  if (report.status !== 'passed') {
    process.exitCode = 1;
  }
}

main();
