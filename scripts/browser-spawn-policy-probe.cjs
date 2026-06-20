const fs = require('fs');
const path = require('path');
const { runSpawnPolicyProbe } = require('./lib/browser-launch-guard.cjs');

const OUTPUT_DIR = path.join(process.cwd(), 'output', 'playwright');
const REPORT_PATH = path.join(OUTPUT_DIR, 'browser-spawn-policy-probe-report.json');

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function buildRemediations(report) {
  if (report.verdict === 'runtime_spawn_blocked') {
    return [
      'Current runtime blocks Node child_process.spawn globally (sandbox/policy layer).',
      'Run browser audits in a local terminal session where Node can spawn child processes.',
      'Use API audits in this environment for continuous validation until browser runtime is available.',
    ];
  }
  if (report.verdict !== 'browser_executable_blocked') return [];
  return [
    'Environment policy is blocking browser process spawn (EPERM).',
    'Add allow-list entries for node.exe, msedge.exe/chrome.exe, and %LOCALAPPDATA%\\ms-playwright\\**.',
    'If Defender Controlled Folder Access is enabled, allow node.exe and browser executables.',
    'Re-run this probe before any route-level browser audit.',
  ];
}

async function main() {
  ensureDir(OUTPUT_DIR);

  const report = {
    name: 'Browser Spawn Policy Probe',
    startedAt: new Date().toISOString(),
    status: 'running',
    steps: [],
  };

  try {
    const summary = await runSpawnPolicyProbe({
      timeoutMs: 5000,
      recordStep: (entry) => {
        report.steps.push({ at: new Date().toISOString(), ...entry });
      },
    });
    report.status = summary.verdict === 'browser_executable_blocked' || summary.verdict === 'runtime_spawn_blocked'
      ? 'blocked_env'
      : 'passed';
    report.probe = summary;
    report.remediations = buildRemediations(summary);
  } catch (error) {
    report.status = 'failed';
    report.error = String(error?.message || error);
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  }

  if (report.status === 'blocked_env') {
    console.error(`Browser spawn policy blocked. Report: ${REPORT_PATH}`);
    process.exit(1);
  }

  if (report.status === 'failed') {
    console.error(`Browser spawn policy probe failed. Report: ${REPORT_PATH}`);
    process.exit(1);
  }

  console.log(`Browser spawn policy probe passed. Report: ${REPORT_PATH}`);
}

main();
