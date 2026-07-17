const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CHROME_PATH = process.env.BROWSER_AUDIT_EXECUTABLE_PATH
  || [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
  ].find((candidate) => fs.existsSync(candidate))
  || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function normalizeProbeText(value, limit = 320) {
  if (!value) return '';
  return String(value)
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '?')
    .trim()
    .slice(0, limit);
}

function buildLaunchStrategies() {
  const visibleMode = process.env.BROWSER_AUDIT_VISIBLE === '1';
  const slowMo = Number(process.env.BROWSER_AUDIT_SLOWMO_MS || (visibleMode ? 250 : 0));
  const browserOptions = { headless: !visibleMode, ...(slowMo > 0 ? { slowMo } : {}) };

  if (visibleMode) {
    const preferredExecutable = process.env.BROWSER_AUDIT_EXECUTABLE === 'chrome'
      ? CHROME_PATH
      : process.env.BROWSER_AUDIT_EXECUTABLE === 'playwright'
        ? null
        : fs.existsSync(EDGE_PATH)
          ? EDGE_PATH
          : fs.existsSync(CHROME_PATH)
            ? CHROME_PATH
            : null;

    if (preferredExecutable) {
      return [
        {
          name: path.basename(preferredExecutable, path.extname(preferredExecutable)),
          options: { ...browserOptions, executablePath: preferredExecutable },
        },
      ];
    }

    return [
      {
        name: 'playwright-chromium',
        options: browserOptions,
      },
    ];
  }

  const strategies = [];

  if (fs.existsSync(EDGE_PATH)) {
    strategies.push({
      name: 'system-edge',
      options: { headless: true, executablePath: EDGE_PATH },
    });
  }

  if (fs.existsSync(CHROME_PATH)) {
    strategies.push({
      name: 'system-chrome',
      options: { headless: true, executablePath: CHROME_PATH },
    });
  }

  if (process.env.BROWSER_GUARD_SKIP_PROBE === '1') {
    strategies.push({
      name: 'playwright-chromium',
      options: browserOptions,
    });
    return strategies;
  }

  strategies.push({
    name: 'playwright-chromium',
    options: browserOptions,
  });

  return strategies;
}

function classifyLaunchFailure(failures, spawnPolicyProbe = null) {
  if (!Array.isArray(failures) || !failures.length) {
    return {
      kind: 'browser_launch_unknown',
      code: 'PLAYWRIGHT_BROWSER_UNKNOWN',
      verdict: 'browser_launch_unknown',
      message: 'No browser launch attempts were recorded.',
    };
  }

  const allSpawnEperm = failures.every((failure) => String(failure.error || '').includes('spawn EPERM'));
  if (allSpawnEperm) {
    const blockedTargets = Array.isArray(spawnPolicyProbe?.targets)
      ? spawnPolicyProbe.targets
          .filter((target) => target.status === 'blocked_eperm')
          .map((target) => target.name)
      : [];

    const runtimeSpawnBlocked = spawnPolicyProbe?.verdict === 'runtime_spawn_blocked';

    return {
      kind: 'environment_blocker',
      code: 'PLAYWRIGHT_SPAWN_EPERM',
      verdict: 'browser_runtime_blocked',
      message: 'All browser launch strategies were blocked by spawn EPERM.',
      remediations: [
        runtimeSpawnBlocked ? 'Current runtime blocks Node child_process.spawn globally; browser audits cannot run in this environment.' : 'Windows runtime blocker detected. Add allow-list entries for browser executables and Playwright browser cache.',
        `Recommended allow-list paths: ${EDGE_PATH}, ${CHROME_PATH}, %LOCALAPPDATA%\\\\ms-playwright\\\\**`,
        'If Controlled Folder Access is enabled, add node.exe and browser executables to allowed apps.',
        'Run browser-runtime-probe before page audits to confirm this is environment-layer, not business logic.',
        blockedTargets.length ? `Blocked executable targets: ${blockedTargets.join(', ')}` : 'Blocked executable targets were not detected in direct spawn probe.',
      ],
      references: [
        'https://playwright.dev/docs/api/class-browsertype',
        'https://nodejs.org/api/errors.html',
        'https://learn.microsoft.com/en-us/defender-endpoint/enable-controlled-folders',
        'https://learn.microsoft.com/en-us/defender-endpoint/customize-controlled-folders',
      ],
    };
  }

  return {
    kind: 'browser_launch_failed',
    code: 'PLAYWRIGHT_BROWSER_LAUNCH_FAILED',
    verdict: 'browser_launch_failed',
    message: 'Browser launch failed, but the error is not a pure spawn EPERM environment blocker.',
    remediations: [
      'Keep raw launchFailures and classify by concrete launcher and error code.',
      'Run scripts/browser-runtime-probe.cjs first, then move to route-level browser audits.',
    ],
  };

}

function runProcessProbe(executablePath, args = ['--version'], timeoutMs = 5000) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let child;

    try {
      child = spawn(executablePath, args, { windowsHide: true });
    } catch (error) {
      resolve({
        status: String(error?.message || '').includes('spawn EPERM') ? 'blocked_eperm' : 'error',
        code: error?.code || null,
        error: String(error?.message || error),
        elapsedMs: Date.now() - startedAt,
      });
      return;
    }

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {}
      resolve({
        status: 'timeout',
        code: 'PROBE_TIMEOUT',
        error: `process probe exceeded ${timeoutMs}ms`,
        elapsedMs: Date.now() - startedAt,
        stdout: normalizeProbeText(stdout),
        stderr: normalizeProbeText(stderr),
      });
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        status: String(error?.message || '').includes('spawn EPERM') ? 'blocked_eperm' : 'error',
        code: error?.code || null,
        error: String(error?.message || error),
        elapsedMs: Date.now() - startedAt,
        stdout: normalizeProbeText(stdout),
        stderr: normalizeProbeText(stderr),
      });
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({
        status: code === 0 ? 'ok' : 'nonzero_exit',
        code,
        signal: signal || null,
        elapsedMs: Date.now() - startedAt,
        stdout: normalizeProbeText(stdout),
        stderr: normalizeProbeText(stderr),
      });
    });
  });
}

async function runSpawnPolicyProbe({ recordStep, timeoutMs = 5000 } = {}) {
  if (process.env.BROWSER_AUDIT_VISIBLE === '1' || process.env.BROWSER_GUARD_SKIP_PROBE === '1') {
    const summary = {
      checkedAt: new Date().toISOString(),
      timeoutMs,
      verdict: 'probe_skipped',
      browserBlockedCount: 0,
      browserOkCount: 0,
      targets: [],
      reason: process.env.BROWSER_AUDIT_VISIBLE === '1'
        ? 'visible manual audit mode skips system browser probes'
        : 'BROWSER_GUARD_SKIP_PROBE=1',
    };
    recordStep?.({
      step: 'browser-spawn-policy-probe',
      result: 'skipped',
      verdict: summary.verdict,
      reason: summary.reason,
    });
    return summary;
  }

  const targets = [
    { name: 'node-self', executablePath: process.execPath, args: ['--version'], exists: true, browserTarget: false },
    { name: 'system-edge', executablePath: EDGE_PATH, args: ['--version'], exists: fs.existsSync(EDGE_PATH), browserTarget: true },
    { name: 'system-chrome', executablePath: CHROME_PATH, args: ['--version'], exists: fs.existsSync(CHROME_PATH), browserTarget: true },
  ];

  const results = [];
  for (const target of targets) {
    if (!target.exists) {
      results.push({
        name: target.name,
        executablePath: target.executablePath,
        browserTarget: target.browserTarget,
        status: 'missing',
        error: 'executable not found',
      });
      continue;
    }

    const probe = await runProcessProbe(target.executablePath, target.args, timeoutMs);
    results.push({
      name: target.name,
      executablePath: target.executablePath,
      browserTarget: target.browserTarget,
      ...probe,
    });
  }

  const browserTargets = results.filter((target) => target.browserTarget && target.status !== 'missing');
  const browserBlockedCount = browserTargets.filter((target) => target.status === 'blocked_eperm').length;
  const browserOkCount = browserTargets.filter((target) => target.status === 'ok').length;
  const nodeSelf = results.find((target) => target.name === 'node-self');

  let verdict = 'spawn_policy_unclear';
  if (nodeSelf?.status === 'blocked_eperm') verdict = 'runtime_spawn_blocked';
  else if (!browserTargets.length) verdict = 'no_system_browser_detected';
  else if (browserBlockedCount === browserTargets.length) verdict = 'browser_executable_blocked';
  else if (browserOkCount > 0) verdict = 'browser_spawn_ok';

  const summary = {
    checkedAt: new Date().toISOString(),
    timeoutMs,
    verdict,
    browserBlockedCount,
    browserOkCount,
    targets: results,
  };

  recordStep?.({
    step: 'browser-spawn-policy-probe',
    result: verdict === 'browser_spawn_ok' || verdict === 'no_system_browser_detected' ? 'passed' : 'failed',
    verdict,
    browserBlockedCount,
    browserOkCount,
    targets: results.map((target) => ({ name: target.name, status: target.status, code: target.code || null })),
  });

  return summary;
}

async function launchBrowserWithGuard({ recordStep, retryLimit = 1, waitMs = 1200 } = {}) {
  const strategies = buildLaunchStrategies();
  const failures = [];
  const spawnPolicyProbe = await runSpawnPolicyProbe({ recordStep }).catch((error) => ({
    checkedAt: new Date().toISOString(),
    verdict: 'probe_failed',
    error: String(error?.message || error),
    targets: [],
  }));

  for (const strategy of strategies) {
    for (let attempt = 1; attempt <= retryLimit; attempt += 1) {
      recordStep?.({
        step: 'browser-launch-attempt',
        result: 'running',
        launcher: strategy.name,
        attempt,
      });

      try {
        const browser = await chromium.launch(strategy.options);
        recordStep?.({
          step: 'browser-launch-attempt',
          result: 'passed',
          launcher: strategy.name,
          attempt,
        });
        return { browser, launcher: strategy.name, spawnPolicyProbe };
      } catch (error) {
        const entry = {
          launcher: strategy.name,
          attempt,
          error: String(error.message || error),
        };
        failures.push(entry);
        recordStep?.({
          step: 'browser-launch-attempt',
          result: 'failed',
          ...entry,
        });

        if (attempt < retryLimit) {
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
      }
    }
  }

  const classification = classifyLaunchFailure(failures, spawnPolicyProbe);
  const error = new Error(classification.message);
  error.auditKind = classification.kind;
  error.auditCode = classification.code;
  error.auditVerdict = classification.verdict;
  error.auditRemediations = classification.remediations || [];
  error.auditReferences = classification.references || [];
  error.auditSpawnPolicyProbe = spawnPolicyProbe;
  error.launchFailures = failures;
  throw error;
}

function markReportFromLaunchError(report, error) {
  report.status = error?.auditKind === 'environment_blocker' ? 'blocked_env' : 'failed';
  report.error = String(error?.message || error);
  if (error?.auditCode) report.blockerCode = error.auditCode;
  if (error?.auditKind) report.blockerKind = error.auditKind;
  if (error?.auditVerdict) report.blockerVerdict = error.auditVerdict;
  if (Array.isArray(error?.auditRemediations)) report.remediations = error.auditRemediations;
  if (Array.isArray(error?.auditReferences)) report.references = error.auditReferences;
  if (error?.auditSpawnPolicyProbe) report.spawnPolicyProbe = error.auditSpawnPolicyProbe;
  if (Array.isArray(error?.launchFailures)) report.launchFailures = error.launchFailures;
}

module.exports = {
  EDGE_PATH,
  CHROME_PATH,
  buildLaunchStrategies,
  runSpawnPolicyProbe,
  launchBrowserWithGuard,
  markReportFromLaunchError,
};
