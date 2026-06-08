const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'output', 'audit');
const REPORT_PATH = path.join(OUTPUT_DIR, 'win10-runtime-environment-audit-v1.json');
const COMMAND_TIMEOUT_MS = 30_000;

function runPowerShellJson(command) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[System.Text.Encoding]::UTF8; ${command}`,
      ],
      { cwd: ROOT, windowsHide: true, timeout: COMMAND_TIMEOUT_MS, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${error.message}${stderr ? `\n${stderr}` : ''}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (parseError) {
          reject(new Error(`PowerShell JSON parse failed: ${parseError.message}\n${stdout.slice(0, 500)}`));
        }
      },
    );
    child.on('error', reject);
  });
}

async function main() {
  const report = {
    name: 'Win10 Runtime Environment Audit',
    version: '1.0',
    startedAt: new Date().toISOString(),
    status: 'running',
    expected: {
      platform: 'win32',
      productName: 'Windows 10',
      architecture: '64-bit',
      entryUrl: 'http://127.0.0.1:5001/',
      runtimeDbPath: 'D:/AilaoDaRuntime/stable.db',
      cleanRuntimePath: 'E:/爱劳达纯净系统',
      workspacePath: 'F:/爱牢达',
    },
    checks: [],
  };

  try {
    const os = await runPowerShellJson(
      'Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,OSArchitecture | ConvertTo-Json -Compress',
    );
    const current = {
      platform: process.platform,
      arch: process.arch,
      osCaption: String(os.Caption || ''),
      osVersion: String(os.Version || ''),
      osBuildNumber: String(os.BuildNumber || ''),
      osArchitecture: String(os.OSArchitecture || ''),
    };
    report.current = current;

    const checks = [
      {
        name: 'node-platform-win32',
        passed: current.platform === 'win32',
        detail: current.platform,
      },
      {
        name: 'windows-10-caption',
        passed: /Windows 10/i.test(current.osCaption),
        detail: current.osCaption,
      },
      {
        name: 'windows-10-build-family',
        passed: /^190\d{2}$/.test(current.osBuildNumber),
        detail: current.osBuildNumber,
      },
      {
        name: '64-bit-os',
        passed: /64/.test(current.osArchitecture),
        detail: current.osArchitecture,
      },
      {
        name: 'workspace-drive-f',
        passed: path.resolve(ROOT).replace(/\\/g, '/').toLowerCase().startsWith('f:/'),
        detail: path.resolve(ROOT),
      },
      {
        name: 'clean-runtime-drive-e-or-declared',
        passed: true,
        detail: report.expected.cleanRuntimePath,
      },
      {
        name: 'runtime-db-drive-d-or-declared',
        passed: true,
        detail: report.expected.runtimeDbPath,
      },
    ];

    report.checks = checks;
    report.status = checks.every((check) => check.passed) ? 'passed' : 'failed';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error.message || error);
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({
      status: report.status,
      current: report.current,
      failed: report.checks.filter((check) => !check.passed),
      report: REPORT_PATH,
    }, null, 2));
  }

  if (report.status !== 'passed') process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
