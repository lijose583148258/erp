import { spawn } from 'child_process';
import { Buffer } from 'buffer';
import fs from 'fs';
import path from 'path';

export type RuntimeCheck = {
  name: string;
  url: string;
  status: number | string;
  bytes: number;
  ok: boolean;
  error?: string;
  text?: string;
};

export type CommandResult = {
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
};

export function truncate(text: string, max = 6000) {
  return text.length > max ? `${text.slice(0, max)}\n...[truncated ${text.length - max} chars]` : text;
}

export function resolveRuntimeAppUrl() {
  return (process.env.AILAODA_RUNTIME_URL || 'http://127.0.0.1:5001').replace(/\/+$/, '');
}

export async function fetchRuntimeText(
  appUrl: string,
  pathname: string,
  requestTimeoutMs = 10_000,
): Promise<RuntimeCheck & { text: string }> {
  const url = `${appUrl}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);

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

export async function waitForRuntime(
  appUrl: string,
  readyTimeoutMs = 20_000,
  requestTimeoutMs = 10_000,
) {
  const startedAt = Date.now();
  let lastCheck: RuntimeCheck | null = null;

  while (Date.now() - startedAt < readyTimeoutMs) {
    const check = await fetchRuntimeText(appUrl, '/health', requestTimeoutMs);
    lastCheck = check;
    if (check.ok) return check;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  throw new Error(`Runtime did not become healthy within ${readyTimeoutMs}ms. Last status: ${lastCheck?.status || 'none'}`);
}

export async function collectRuntimeResourceChecks(
  appUrl: string,
  requestTimeoutMs = 10_000,
) {
  const checks: RuntimeCheck[] = [];
  const health = await fetchRuntimeText(appUrl, '/health', requestTimeoutMs);
  const home = await fetchRuntimeText(appUrl, '/', requestTimeoutMs);
  checks.push(health, home);
  checks.push(await fetchRuntimeText(appUrl, '/manifest.json', requestTimeoutMs));
  checks.push(await fetchRuntimeText(appUrl, '/icon.svg', requestTimeoutMs));
  const serviceWorker = await fetchRuntimeText(appUrl, '/sw.js', requestTimeoutMs);
  checks.push({
    ...serviceWorker,
    name: 'service-worker-disabled',
    ok: serviceWorker.status === 404,
  });

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
    checks.push(await fetchRuntimeText(appUrl, assetPath.startsWith('/') ? assetPath : `/${assetPath}`, requestTimeoutMs));
  }

  return checks.map(({ text: _text, ...check }) => check);
}

export function runStartStable(root: string, startTimeoutMs = 240_000): Promise<CommandResult> {
  return new Promise(resolve => {
    const startedAt = Date.now();
    const command = 'powershell.exe';
    const defaultCleanRoot = Buffer.from('RTpc54ix5Yqz6L6+57qv5YeA57O757uf', 'base64').toString('utf8');
    const cleanRuntimeRoot = process.env.AILAODA_CLEAN_RUNTIME_ROOT || defaultCleanRoot;
    const cleanRuntimeLauncher = path.join(cleanRuntimeRoot, 'scripts', 'start-stable-v2.ps1');
    const packageLauncher = path.join(root, 'AilaoDa_Stable_Package', 'scripts', 'start-stable-v2.ps1');
    const usePackageLauncher = ['1', 'true', 'yes', 'on'].includes(String(process.env.AILAODA_RESTART_FROM_PACKAGE || '').toLowerCase());
    const launcherPath = usePackageLauncher && fs.existsSync(cleanRuntimeLauncher)
      ? cleanRuntimeLauncher
      : usePackageLauncher && fs.existsSync(packageLauncher)
        ? packageLauncher
        : 'scripts/start-stable-v2.ps1';
    const args = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      launcherPath,
    ];
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let doneMarkerTimer: NodeJS.Timeout | null = null;
    const unrefStream = (stream?: NodeJS.ReadableStream | null) => {
      const maybeUnref = stream as (NodeJS.ReadableStream & { unref?: () => void }) | undefined | null;
      if (typeof maybeUnref?.unref === 'function') maybeUnref.unref();
    };
    const child = spawn(command, args, {
      cwd: root,
      env: {
        ...process.env,
        CI: '1',
      },
      windowsHide: true,
      shell: false,
    });

    const settle = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (doneMarkerTimer) clearTimeout(doneMarkerTimer);
      child.stdout?.removeAllListeners();
      child.stderr?.removeAllListeners();
      child.removeAllListeners();
      unrefStream(child.stdout);
      unrefStream(child.stderr);
      if (typeof child.unref === 'function') child.unref();
      resolve(result);
    };

    const maybeResolveOnDoneMarker = () => {
      if (settled) return;
      if (!/\[7\/7\]\s+Done/.test(stdout) || !/System URL:\s*http:\/\/127\.0\.0\.1:5001/i.test(stdout)) {
        return;
      }

      doneMarkerTimer = setTimeout(() => {
        if (settled) return;
        try {
          if (!child.killed) child.kill('SIGTERM');
        } catch (error) {
          stderr += `\nFailed to terminate completed launcher process: ${error instanceof Error ? error.message : String(error)}`;
        }
        try { child.stdout?.destroy(); } catch {
          // Stream may already be closed after the launcher exits.
        }
        try { child.stderr?.destroy(); } catch {
          // Stream may already be closed after the launcher exits.
        }
        settle({
          command: [command, ...args].join(' '),
          exitCode: 0,
          timedOut: false,
          durationMs: Date.now() - startedAt,
          stdout: truncate(stdout),
          stderr: truncate(stderr),
        });
      }, 500);
    };

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
    }, startTimeoutMs);

    child.stdout.on('data', chunk => {
      stdout += chunk.toString('utf8');
      maybeResolveOnDoneMarker();
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', error => {
      settle({
        command: [command, ...args].join(' '),
        exitCode: null,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout: truncate(stdout),
        stderr: truncate(`${stderr}\n${error.message}`.trim()),
      });
    });
    child.on('close', code => {
      settle({
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
