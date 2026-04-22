import { spawn } from 'child_process';
import { Buffer } from 'buffer';

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
  checks.push(await fetchRuntimeText(appUrl, '/sw.js', requestTimeoutMs));

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
      cwd: root,
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
    }, startTimeoutMs);

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
