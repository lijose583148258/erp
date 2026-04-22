import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import {
  collectBusinessDataFingerprint,
  compareBusinessDataFingerprints,
  normalizeDatabasePath,
  withFingerprintPrisma,
} from './lib/business-data-fingerprint';

const ROOT = process.cwd();
const requireFromScript = createRequire(import.meta.url);
const { getSqliteDbPath } = requireFromScript('../backend/src/config/runtime.ts') as {
  getSqliteDbPath: () => string | null;
};

const APP_URL = (process.env.AILAODA_RUNTIME_URL || 'http://127.0.0.1:5001').replace(/\/+$/, '');
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const JSON_REPORT = path.join(OUTPUT_DIR, 'runtime-restart-persistence-audit-v1.json');
const MD_REPORT = path.join(OUTPUT_DIR, 'runtime-restart-persistence-audit-v1.md');
const START_TIMEOUT_MS = Number(process.env.AUDIT_RESTART_TIMEOUT_MS || 240_000);
const REQUEST_TIMEOUT_MS = Number(process.env.AUDIT_REQUEST_TIMEOUT_MS || 10_000);
const RUNTIME_READY_TIMEOUT_MS = Number(process.env.AUDIT_RUNTIME_READY_TIMEOUT_MS || 20_000);

type RuntimeCheck = {
  name: string;
  url: string;
  status: number | string;
  bytes: number;
  ok: boolean;
  error?: string;
  text?: string;
};

type DbSnapshot = {
  path: string;
  exists: boolean;
  size: number;
  mtimeMs: number;
};

type CommandResult = {
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
};

function truncate(text: string, max = 6000) {
  return text.length > max ? `${text.slice(0, max)}\n...[truncated ${text.length - max} chars]` : text;
}

function readDbSnapshot(databasePath: string): DbSnapshot {
  const exists = fs.existsSync(databasePath);
  const stat = exists ? fs.statSync(databasePath) : null;
  return {
    path: normalizeDatabasePath(databasePath),
    exists,
    size: stat?.size || 0,
    mtimeMs: stat?.mtimeMs || 0,
  };
}

async function fetchText(pathname: string): Promise<RuntimeCheck & { text: string }> {
  const url = `${APP_URL}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    return {
      name: pathname,
      url,
      status: response.status,
      bytes: Buffer.byteLength(text, 'utf8'),
      ok: response.ok,
      text,
    };
  } catch (error) {
    return {
      name: pathname,
      url,
      status: 'request-failed',
      bytes: 0,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      text: '',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function waitForRuntime() {
  const startedAt = Date.now();
  let lastCheck: RuntimeCheck | null = null;

  while (Date.now() - startedAt < RUNTIME_READY_TIMEOUT_MS) {
    const check = await fetchText('/health');
    lastCheck = check;
    if (check.ok) return check;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  throw new Error(`Runtime did not become healthy within ${RUNTIME_READY_TIMEOUT_MS}ms. Last status: ${lastCheck?.status || 'none'}`);
}

async function collectRuntimeChecks() {
  const checks: RuntimeCheck[] = [];
  const health = await fetchText('/health');
  const home = await fetchText('/');
  checks.push(health, home);
  checks.push(await fetchText('/manifest.json'));
  checks.push(await fetchText('/icon.svg'));
  checks.push(await fetchText('/sw.js'));

  const assetPaths = Array.from(home.text.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g))
    .map(match => match[1])
    .filter((item, index, list) => list.indexOf(item) === index)
    .slice(0, 6);

  for (const assetPath of assetPaths) {
    if (/^https?:\/\//i.test(assetPath)) {
      checks.push({
        name: `asset:${assetPath}`,
        url: assetPath,
        status: 'external asset is not allowed for local EXE runtime',
        bytes: 0,
        ok: false,
      });
      continue;
    }
    checks.push(await fetchText(assetPath.startsWith('/') ? assetPath : `/${assetPath}`));
  }

  return checks.map(({ text: _text, ...check }) => check);
}

function runStartStable(): Promise<CommandResult> {
  return new Promise(resolve => {
    const startedAt = Date.now();
    const command = 'powershell.exe';
    const args = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      'scripts/start-stable-v2.ps1',
    ];
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = spawn(command, args, {
      cwd: ROOT,
      env: {
        ...process.env,
        CI: '1',
      },
      windowsHide: true,
      shell: false,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch (error) {
        stderr += `\nFailed to terminate restart process: ${error instanceof Error ? error.message : String(error)}`;
      }
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch (error) {
          stderr += `\nFailed to force-kill restart process: ${error instanceof Error ? error.message : String(error)}`;
        }
      }, 3000).unref();
    }, START_TIMEOUT_MS);

    child.stdout.on('data', chunk => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', error => {
      clearTimeout(timer);
      resolve({
        command: [command, ...args].join(' '),
        exitCode: null,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout: truncate(stdout),
        stderr: truncate(`${stderr}\n${error.message}`.trim()),
      });
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({
        command: [command, ...args].join(' '),
        exitCode: code,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout: truncate(stdout),
        stderr: truncate(stderr),
      });
    });
  });
}

function writeReports(report: Record<string, unknown>) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const summary = report.summary as Record<string, unknown>;
  const failedChecks = report.failedRuntimeChecks as RuntimeCheck[];
  const mismatches = report.fingerprintMismatches as Array<Record<string, unknown>>;
  const md = [
    '# Runtime Restart Persistence Audit v1',
    '',
    `- status: ${report.status}`,
    `- generated: ${report.generatedAt}`,
    `- app url: ${APP_URL}`,
    `- runtime db before: ${summary.databasePathBefore}`,
    `- runtime db after: ${summary.databasePathAfter}`,
    `- compared tables: ${summary.comparedTables}`,
    `- fingerprint mismatches: ${summary.fingerprintMismatches}`,
    `- failed runtime checks: ${summary.failedRuntimeChecks}`,
    `- restart timed out: ${summary.restartTimedOut}`,
    '',
    '## Failed Runtime Checks',
  ];

  if (failedChecks.length === 0) md.push('- none');
  for (const check of failedChecks) {
    md.push(`- ${check.name}: ${check.status} ${check.error || ''}`.trim());
  }

  md.push('');
  md.push('## Fingerprint Mismatches');
  if (mismatches.length === 0) md.push('- none');
  for (const mismatch of mismatches) {
    md.push(`- ${JSON.stringify(mismatch)}`);
  }

  fs.writeFileSync(MD_REPORT, `${md.join('\n')}\n`, 'utf8');
}

async function main() {
  const generatedAt = new Date().toISOString();
  const beforeDbPath = getSqliteDbPath();
  if (!beforeDbPath || !fs.existsSync(beforeDbPath)) {
    throw new Error(`Runtime SQLite database is not available before restart: ${beforeDbPath || 'not configured'}`);
  }

  const beforeSnapshot = readDbSnapshot(beforeDbPath);
  const beforeFingerprint = await withFingerprintPrisma(
    beforeDbPath,
    client => collectBusinessDataFingerprint(client, 'before-runtime-restart'),
  );

  const restart = await runStartStable();
  if (restart.exitCode !== 0 || restart.timedOut) {
    const report = {
      name: 'Runtime Restart Persistence Audit',
      version: '1.0',
      generatedAt,
      status: 'failed',
      appUrl: APP_URL,
      beforeSnapshot,
      afterSnapshot: null,
      restart,
      summary: {
        databasePathBefore: beforeSnapshot.path,
        databasePathAfter: null,
        comparedTables: beforeFingerprint.tableCount,
        fingerprintMismatches: 'not-run',
        failedRuntimeChecks: 'not-run',
        restartTimedOut: restart.timedOut,
      },
      failedRuntimeChecks: [],
      fingerprintMismatches: [],
      reports: {
        json: JSON_REPORT,
        markdown: MD_REPORT,
      },
    };
    writeReports(report);
    console.log(JSON.stringify({ status: report.status, summary: report.summary, jsonReport: JSON_REPORT, markdownReport: MD_REPORT }, null, 2));
    process.exitCode = 1;
    return;
  }

  await waitForRuntime();
  const runtimeChecks = await collectRuntimeChecks();
  const failedRuntimeChecks = runtimeChecks.filter(check => !check.ok);

  const afterDbPath = getSqliteDbPath();
  if (!afterDbPath || !fs.existsSync(afterDbPath)) {
    throw new Error(`Runtime SQLite database is not available after restart: ${afterDbPath || 'not configured'}`);
  }

  const afterSnapshot = readDbSnapshot(afterDbPath);
  const afterFingerprint = await withFingerprintPrisma(
    afterDbPath,
    client => collectBusinessDataFingerprint(client, 'after-runtime-restart'),
  );
  const fingerprintMismatches = compareBusinessDataFingerprints(beforeFingerprint, afterFingerprint);
  const pathChanged = beforeSnapshot.path !== afterSnapshot.path;
  const failed = pathChanged || failedRuntimeChecks.length > 0 || fingerprintMismatches.length > 0;

  const report = {
    name: 'Runtime Restart Persistence Audit',
    version: '1.0',
    generatedAt,
    status: failed ? 'failed' : 'passed',
    appUrl: APP_URL,
    beforeSnapshot,
    afterSnapshot,
    restart,
    runtimeChecks,
    failedRuntimeChecks,
    pathChanged,
    beforeFingerprint,
    afterFingerprint,
    fingerprintMismatches,
    summary: {
      databasePathBefore: beforeSnapshot.path,
      databasePathAfter: afterSnapshot.path,
      databasePathChanged: pathChanged,
      comparedTables: beforeFingerprint.tableCount,
      beforeHash: beforeFingerprint.hash,
      afterHash: afterFingerprint.hash,
      fingerprintMismatches: fingerprintMismatches.length,
      failedRuntimeChecks: failedRuntimeChecks.length,
      restartTimedOut: restart.timedOut,
      restartDurationMs: restart.durationMs,
    },
    reports: {
      json: JSON_REPORT,
      markdown: MD_REPORT,
    },
  };

  writeReports(report);
  console.log(JSON.stringify({
    status: report.status,
    summary: report.summary,
    jsonReport: JSON_REPORT,
    markdownReport: MD_REPORT,
  }, null, 2));

  if (failed) process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
